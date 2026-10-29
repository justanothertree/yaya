import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { fetchRecentReviews, setSymbolDesignation, type RecentReview } from '../finance/portfolio'
import { type ReviewTrade } from '../finance/reviewGroups'
import { TradeReview } from './TradeReview'

/**
 * Importing a broker CSV without a terminal.
 *
 * The command-line version worked, but it took: download the file, find it, open a shell, put a
 * SERVICE-ROLE KEY on the command line, dry run, read the output, run again with --commit. The
 * key step alone can fail four ways and reports the same "Invalid API key" for all of them. A
 * process with that many steps doesn't become a monthly habit — which is exactly how the trades
 * and the prices both ended up months stale.
 *
 * Here, being signed in as an admin IS the credential. The relay holds the service key; the
 * browser never sees one.
 *
 * The two steps that matter are kept, because they are what makes the result trustworthy: you
 * see what the file contains BEFORE anything is written, and the ⚠️ collapsed rows — money the
 * parser refused to guess about — are shown in full rather than as a number.
 */

type Summary = {
  name: string
  committed: boolean
  source: string
  dataRows: number
  kept: number
  reinvestments: number
  sells: { count: number; dollars: number }
  adjustments: number
  skips: Record<string, number>
  skippedTotal: number
  netInvested: number
  firstDate: string | null
  lastDate: string | null
  symbols: number
  samples: Record<string, string[]>
  collapsed: Array<{ date: string; symbol: string; units: number; price: number; dollars: number }>
  collapsedDollars: number
  imported?: { inserted: number; skipped: number; total: number }
  split?: { accounts: number; tradesAllocated: number; allocationsCreated: number }
}

const relayBase = () => {
  const raw = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WS_URL
  const ws = raw || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
  return ws.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/$/, '')
}

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

/**
 * One trade still waiting on "was this for the family?".
 *
 * Shared with `src/finance/reviewGroups.ts`, which holds the grouping and the Part… arithmetic
 * so they can be tested without an admin session — `#dev-admin` renders this panel with no
 * token, so every RPC answers nothing and the list is empty.
 */
type Undecided = ReviewTrade

type Health = {
  node: string
  uptimeSeconds: number
  has: Record<string, boolean>
  canImport: boolean
}

export function ImportPanel() {
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [busy, setBusy] = useState<'reading' | 'parsing' | 'importing' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [health, setHealth] = useState<Health | 'old' | null>(null)
  /**
   * The review step. Symbol-level designation is all-or-nothing and timeless, and every
   * allocation error so far came from that: pre-fund history in a family symbol, a split on a
   * partly-owned position, an LCID buy that was 80% theirs. The trade is where the intent
   * actually lives — and right after an import is when Evan still remembers it.
   */
  const [undecided, setUndecided] = useState<Undecided[] | null>(null)
  const [reviewErr, setReviewErr] = useState<string | null>(null)
  /** the last answers, so one can be changed — see `fetchRecentReviews` for why this exists */
  const [recent, setRecent] = useState<RecentReview[] | null>(null)
  /**
   * ⚠️ THE HEADING COUNT COMES FROM THE SERVER, NOT FROM THE LOADED ARRAY. The list is capped
   * at 200, so a backlog deeper than that would have described itself as exactly 200 — a number
   * that looks precise and is a ceiling.
   */
  const [undecidedTotal, setUndecidedTotal] = useState<number | null>(null)

  /**
   * ⚠️ Not gated on having just imported, and deliberately NOT narrowed to one import.
   *
   * It used to return early unless a commit had happened in this session, and then ask only for
   * that import's rows. So the review existed for about two minutes and covered only what had
   * just arrived — anything left unanswered in that window became unreachable, and 106 of them
   * had piled up going back to the day the fund started.
   *
   * Asking for the whole backlog every time means the list has ONE meaning, whether or not a CSV
   * was just pressed. A narrowed variant would have to be described differently on screen from
   * the standing one, and two descriptions of the same list is how a screen starts lying. The
   * sort is newest first, so a fresh import lands at the top regardless.
   */
  const loadUndecided = useCallback(async () => {
    const { data, error } = await getSupabaseClient().rpc('admin_unallocated_trades', {
      p_limit: 200,
      p_imported_since: null,
    })
    if (error) {
      setReviewErr(error.message)
      return
    }
    setUndecided((data ?? []) as Undecided[])
    /* the real depth of the backlog, which the capped list above cannot tell you */
    const { data: att } = await getSupabaseClient().rpc('admin_attention')
    const n = (att as { undecided?: number } | null)?.undecided
    if (typeof n === 'number') setUndecidedTotal(n)
  }, [])

  const loadRecent = useCallback(async () => {
    try {
      setRecent(await fetchRecentReviews(30))
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void loadUndecided()
    void loadRecent()
  }, [loadUndecided, loadRecent])

  /**
   * Answer one trade, or a whole symbol's worth.
   *
   * ⚠️ `admin_set_trade_allocation` REPLACES rather than adds — it deletes the trade's
   * allocations, stamps `reviewed_at` and re-splits — which is why "change an answer" needs no
   * write path of its own. Calling it on an already-answered trade IS the undo.
   *
   * ⚠️ AND THE TRADES GO ONE AT A TIME, IN SEQUENCE. Each call deletes and re-inserts
   * allocations for its own trade; firing fourteen 33-account splits at the same two tables
   * together buys nothing, because a person is waiting either way. Sequential also means a
   * failure halfway leaves a state you can read: everything before it answered, everything after
   * it still waiting. The first failure stops the run and is reported.
   */
  const answerTrades = useCallback(
    async (ids: string[], fraction: number) => {
      setReviewErr(null)
      for (const id of ids) {
        const { error } = await getSupabaseClient().rpc('admin_set_trade_allocation', {
          p_trade: id,
          p_fraction: fraction,
        })
        if (error) throw new Error(error.message)
        setUndecidedTotal((n) => (n == null ? n : Math.max(0, n - 1)))
      }
      void loadRecent()
    },
    [loadRecent],
  )

  /** settle the symbol itself, so the same question does not return on the next import (P3.4) */
  const designateSymbol = useCallback(
    async (symbol: string, platform: string, family: boolean) => {
      await setSymbolDesignation(symbol, platform, family)
      await loadUndecided()
      void loadRecent()
    },
    [loadUndecided, loadRecent],
  )

  /**
   * Ask the relay what it is configured with, before anything is attempted.
   *
   * ⚠️ This is here rather than as something to curl because a browser tab sends no
   * Authorization header — /relay-config is admin-only, so opening it directly can only ever
   * refuse you. The panel has the session token; the address bar does not.
   *
   * ⚠️ And it is NOT /health: Render probes that path after every deploy and needs a 2xx from an
   * unauthenticated request. Putting this behind /health failed every deploy for an evening.
   *
   * 'old' means the relay answered but has no /health route, i.e. it is running a build from
   * before this existed. Worth distinguishing: "the relay is misconfigured" and "the relay has
   * not redeployed yet" are different problems with different fixes.
   */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { data } = await getSupabaseClient().auth.getSession()
        const token = data.session?.access_token
        if (!token) return
        const r = await fetch(`${relayBase()}/relay-config`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const text = await r.text()
        if (!alive) return
        if (text.trim() === 'ok') {
          setHealth('old')
          return
        }
        setHealth(JSON.parse(text) as Health)
      } catch {
        /* the relay may be asleep; the import itself will report properly if so */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  async function post(text: string, name: string, commit: boolean) {
    const { data } = await getSupabaseClient().auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Not signed in.')
    const r = await fetch(`${relayBase()}/import-trades${commit ? '?commit=1' : ''}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: text, name }),
    })
    let body: (Summary & { error?: string }) | null = null
    try {
      body = (await r.json()) as Summary & { error?: string }
    } catch {
      /* a proxy or a cold start can answer with something that isn't JSON */
    }
    if (!r.ok) throw new Error(body?.error || `The relay answered ${r.status} with no explanation.`)
    if (!body) throw new Error('The relay answered, but not with anything readable.')
    return body
  }

  /**
   * ⚠️ Whether a commit actually wrote anything is decided HERE, by the numbers, not by the
   * request having completed.
   *
   * "I pressed the button and I can't tell if it worked" is the failure this is fixing. A 200
   * that inserted nothing looks exactly like a 200 that inserted everything unless something
   * says which.
   */
  const outcome = (m: Summary) => {
    if (!m.committed) return null
    const inserted = m.imported?.inserted ?? 0
    const already = m.imported?.skipped ?? 0
    if (inserted > 0) return { ok: true as const, line: `${inserted} new trades imported.` }
    if (already > 0)
      return {
        ok: true as const,
        line: `Nothing new — all ${already} were already imported. Re-running a file is safe and this is what it looks like.`,
      }
    return {
      ok: false as const,
      line: 'The import reported success but wrote nothing at all. That is not a normal result — tell me before trusting it.',
    }
  }

  async function onPick(file: File) {
    setErr(null)
    setSummary(null)
    setBusy('reading')
    try {
      const text = await file.text()
      setCsv({ name: file.name, text })
      setBusy('parsing')
      setSummary(await post(text, file.name, false))
    } catch (e) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setBusy(null)
    }
  }

  async function doImport() {
    if (!csv) return
    setErr(null)
    setBusy('importing')
    // stamped BEFORE the request, so "what this import added" cannot miss a row that landed
    // while it was running
    try {
      setSummary(await post(csv.text, csv.name, true))
      await loadUndecided()
    } catch (e) {
      setErr(String((e as Error)?.message || e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Drop a Robinhood or Cash App export here. Nothing is written until you say so — the first
        step only reads the file and tells you what&apos;s in it.
      </p>

      {health === 'old' && (
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          The relay is running a build from before this screen existed, so it can&apos;t report its
          configuration yet. It redeploys on push — try again in a minute.
        </p>
      )}
      {health && health !== 'old' && !health.canImport && (
        <div className="import-fail">
          <strong>This relay can read a file but cannot write to the database.</strong>
          <p style={{ margin: '0.3rem 0 0' }}>
            {health.has.SUPABASE_SERVICE_ROLE_KEY
              ? 'SUPABASE_URL is missing from its environment.'
              : 'SUPABASE_SERVICE_ROLE_KEY is missing from its environment.'}{' '}
            Add it in the Render dashboard under the service&apos;s Environment tab, then let it
            restart. No code change needed.
          </p>
        </div>
      )}

      <div className="import-drop">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onPick(f)
          }}
          style={{ display: 'none' }}
        />
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          {busy === 'reading' || busy === 'parsing' ? 'Reading…' : '📄 Choose a CSV'}
        </button>
        {csv && (
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {csv.name}
          </span>
        )}
      </div>

      {/* Loud, and it says what to do next. A red sentence you can scroll past is how a failed
          import gets mistaken for a quiet success. */}
      {err && (
        <div className="import-fail">
          <strong>That didn&apos;t import.</strong>
          <p style={{ margin: '0.3rem 0 0' }}>{err}</p>
          <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.82rem' }}>
            Nothing was written. The file is still loaded — press Import again to retry.
          </p>
        </div>
      )}

      {summary && (
        <div className="card" style={{ marginTop: '0.75rem' }}>
          <div style={{ fontWeight: 700 }}>
            {summary.committed ? 'Imported' : 'Ready to import'} · {summary.source}
          </div>

          {/* ⚠️ First, above everything, and never folded into a count. These are rows the parser
              dropped as duplicates of an earlier one — and in a Robinhood file that can be a real
              second purchase, because their rows carry no transaction id and no time of day. */}
          {summary.collapsed.length > 0 && (
            <div className="import-warn">
              <strong>
                ⚠️ {summary.collapsed.length} row
                {summary.collapsed.length === 1 ? '' : 's'} identical to an earlier one —{' '}
                {usd(summary.collapsedDollars)} NOT imported
              </strong>
              {summary.source === 'robinhood' && (
                <p style={{ margin: '0.3rem 0' }}>
                  Robinhood rows have no transaction id and the date has no time, so a genuine
                  second purchase of the same stock, same day, same price is indistinguishable from
                  a repeated row. Check these against your statement before trusting the totals.
                </p>
              )}
              <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
                {summary.collapsed.slice(0, 10).map((c, i) => (
                  <li key={i}>
                    {c.date} {c.symbol} {c.units} @ {c.price} = {usd(c.dollars)}
                  </li>
                ))}
                {summary.collapsed.length > 10 && (
                  <li>…and {summary.collapsed.length - 10} more</li>
                )}
              </ul>
            </div>
          )}

          <dl className="import-facts">
            <dt>Rows in file</dt>
            <dd>{summary.dataRows}</dd>
            <dt>Kept</dt>
            <dd>
              {summary.kept} buys+sells
              {summary.reinvestments > 0 && `, incl ${summary.reinvestments} reinvestments`}
            </dd>
            {summary.sells.count > 0 && (
              <>
                <dt>Sells</dt>
                <dd>
                  {summary.sells.count} (−{usd(summary.sells.dollars)}) — netted against buys
                </dd>
              </>
            )}
            {summary.adjustments > 0 && (
              <>
                <dt>Adjustments</dt>
                <dd>{summary.adjustments} split / symbol-change corrections</dd>
              </>
            )}
            <dt>Skipped</dt>
            <dd>
              {summary.skippedTotal}{' '}
              <span className="muted">
                (
                {Object.entries(summary.skips)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')}
                )
              </span>
            </dd>
            <dt>Net invested</dt>
            <dd>{usd(summary.netInvested)}</dd>
            <dt>Dates</dt>
            <dd>
              {summary.firstDate ?? '—'} → {summary.lastDate ?? '—'}
            </dd>
            <dt>Symbols</dt>
            <dd>{summary.symbols}</dd>
          </dl>

          {/* The spot-check. A skipped kind you don't recognise is the cheapest possible way to
              catch the parser throwing away something real. */}
          {Object.keys(summary.samples).length > 0 && !summary.committed && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary className="muted" style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                Show a raw example of each skipped kind
              </summary>
              <div className="import-samples">
                {Object.entries(summary.samples).map(([k, list]) => (
                  <div key={k}>
                    <strong>{k}</strong>
                    {list.map((line, i) => (
                      <div key={i} className="muted">
                        {line}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}

          {summary.committed ? (
            <div className={outcome(summary)?.ok ? 'import-done' : 'import-fail'}>
              <strong>{outcome(summary)?.line}</strong>
              <p className="muted" style={{ margin: '0.3rem 0 0', fontSize: '0.84rem' }}>
                {summary.imported?.inserted ?? 0} new · {summary.imported?.skipped ?? 0} already
                present · {summary.imported?.total ?? 0} in the file
                {summary.split &&
                  ` · split ${summary.split.tradesAllocated} trades across ${summary.split.accounts} accounts (${summary.split.allocationsCreated} allocations)`}
              </p>
            </div>
          ) : (
            <div style={{ marginTop: '0.6rem' }}>
              <button className="btn" onClick={() => void doImport()} disabled={!!busy}>
                {busy === 'importing' ? 'Importing…' : `Import these ${summary.kept} trades`}
              </button>
              <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.8rem' }}>
                Safe to repeat — anything already imported comes back as &ldquo;already
                present&rdquo; rather than a second copy.
              </p>
            </div>
          )}
        </div>
      )}

      {/**
       * The review step — a standing list, not a moment.
       *
       * ⚠️ Deliberately OUTSIDE the summary block. It used to hang off `summary.committed`, so it
       * existed only in the minutes after an import and only for that import's rows. A weekly
       * habit doesn't survive that: miss the window and the question is gone, while the trade
       * quietly counts as yours forever.
       *
       * Deliberately three plain answers rather than a number box: "not theirs", "all theirs",
       * "part". Evan said of the partial tool that he didn't fully understand it and he'd be the
       * one using it — so the common two cases are one tap, and the fiddly one only appears when
       * he asks for it.
       */}
      {/**
       * The review, which lives in its own component so something can look at it: ImportPanel
       * reaches for `getSupabaseClient()` directly, and `#dev-admin` has no token, so every RPC
       * answered nothing and this list was always empty. The writes stay here; the screen is
       * `TradeReview`, and the arithmetic is in `src/finance/reviewGroups.ts` with its own tests.
       */}
      {(undecided !== null || recent !== null) && (
        <TradeReview
          trades={undecided ?? []}
          total={undecidedTotal ?? undecided?.length ?? 0}
          recent={recent ?? []}
          error={reviewErr}
          onAnswer={answerTrades}
          onDesignate={designateSymbol}
        />
      )}
    </div>
  )
}
