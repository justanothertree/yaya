// Sweeps current prices for every symbol the family fund holds into finance.price_cache.
// Crypto comes from CoinGecko (keyless). Stocks come from Finnhub when a FINNHUB_API_KEY
// secret is set. Finnhub free allows 60 calls/min, so each run prices at most 55 stocks;
// list_fund_symbols returns stalest-first, so successive runs (or the daily cron) cycle
// through the whole set. All database access goes through service-role-gated RPCs because
// PostgREST does not expose the finance schema directly.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  XRP: 'ripple',
  LTC: 'litecoin',
  ZORA: 'zora',
}

const MAX_STOCKS_PER_RUN = 55

type SymbolRow = { symbol: string; asset_type: string }
type Price = { symbol: string; price: number }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data, error } = await supabase.rpc('list_fund_symbols')
  if (error) return json({ error: error.message }, 500)
  const rows = (data ?? []) as SymbolRow[]

  const prices: Price[] = []
  const summary = {
    crypto: 0,
    stocks: 0,
    deferred: 0,
    skipped: [] as string[],
    errors: [] as string[],
  }

  // ── crypto via CoinGecko (no key) ──
  const cryptos = rows.filter((r) => r.asset_type === 'crypto')
  const known = cryptos.filter((c) => COINGECKO_IDS[c.symbol.toUpperCase()])
  for (const c of cryptos) {
    if (!COINGECKO_IDS[c.symbol.toUpperCase()]) summary.skipped.push(c.symbol)
  }
  if (known.length) {
    const ids = [...new Set(known.map((c) => COINGECKO_IDS[c.symbol.toUpperCase()]))]
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`,
      )
      if (res.ok) {
        const quotes = (await res.json()) as Record<string, { usd?: number }>
        for (const c of known) {
          const usd = quotes[COINGECKO_IDS[c.symbol.toUpperCase()]]?.usd
          if (typeof usd === 'number' && usd > 0) {
            prices.push({ symbol: c.symbol, price: usd })
            summary.crypto++
          } else summary.skipped.push(c.symbol)
        }
      } else summary.errors.push(`coingecko ${res.status}`)
    } catch (e) {
      summary.errors.push(`coingecko ${String(e)}`)
    }
  }

  // ── stocks via Finnhub (free key; stalest-first, capped per run) ──
  const key = Deno.env.get('FINNHUB_API_KEY')
  const stocks = rows.filter((r) => r.asset_type !== 'crypto')
  if (!key) {
    for (const s of stocks) summary.skipped.push(s.symbol)
  } else {
    const batch = stocks.slice(0, MAX_STOCKS_PER_RUN)
    summary.deferred = stocks.length - batch.length
    for (const s of batch) {
      try {
        /**
         * ⚠️ THE KEY GOES IN A HEADER, NOT THE URL.
         *
         * Deno's fetch rejects with a message that embeds the full request URL, and the
         * catch below stringified that straight into `summary.errors`, which is spread into
         * the 200 response body and into the logs. One DNS blip or connection reset and the
         * Finnhub key was published to whoever called this. Finnhub accepts the token as a
         * header, so the URL never carries it.
         */
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s.symbol)}`,
          { headers: { 'X-Finnhub-Token': key } },
        )
        if (res.ok) {
          const q = (await res.json()) as { c?: number }
          if (typeof q.c === 'number' && q.c > 0) {
            prices.push({ symbol: s.symbol, price: q.c })
            summary.stocks++
          } else summary.skipped.push(s.symbol)
        } else if (res.status === 429) {
          summary.errors.push(`${s.symbol}: rate limited`)
          break // let the next run pick these up
        } else summary.errors.push(`${s.symbol}: ${res.status}`)
      } catch (e) {
        // ⚠️ never the raw error: see the note above. A name is enough to debug with and
        // cannot carry a URL, a header or a key.
        summary.errors.push(`${s.symbol}: ${e instanceof Error ? e.name : 'fetch failed'}`)
      }
    }
  }

  let written = 0
  if (prices.length) {
    const { data: n, error: upErr } = await supabase.rpc('upsert_prices', { p_prices: prices })
    if (upErr) return json({ error: upErr.message, summary }, 500)
    written = (n as number) ?? 0
  }

  return json({ ok: true, written, ...summary })
})
