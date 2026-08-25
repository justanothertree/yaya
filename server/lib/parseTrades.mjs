import { createHash } from 'node:crypto'

/**
 * Parsing broker exports into normalized family-fund trades.
 *
 * ⚠️ LIVES UNDER server/ FOR A DEPLOYMENT REASON, not a tidiness one. Render's root directory
 * is `server` — it has its own package.json, lockfile and node_modules, and starts with
 * `node ws-server.js` — so anything outside that folder simply does not exist at runtime. This
 * sat in a top-level shared/ for about ten minutes, which would have taken the relay down on the
 * next deploy, calls and all. The CLI reaches in from ../server/lib/, which is safe because it
 * only ever runs from a full checkout.
 *
 * ⚠️ ONE COPY, ON PURPOSE. This is imported by BOTH the CLI (scripts/import-trades.mjs) and the
 * relay's /import-trades endpoint (server/ws-server.js). Two implementations of "what counts as
 * a buy" would drift, and the entire value of this module is that the numbers can be trusted —
 * a second parser is a second set of answers.
 *
 * Pure: no filesystem, no network, no process.exit, no printing. Give it CSV text, get trades
 * and a summary back as DATA. The CLI formats that for a terminal; the Admin screen renders the
 * same fields as a review page. Neither can disagree with the other about what was found.
 */

// ── tiny RFC-4180 CSV parser ───────────────────────────────────────────────
// Handles quoted commas AND embedded newlines — Robinhood wraps a multi-line
// "Name / CUSIP / Dividend Reinvestment" blob inside the Description field, so a
// naive line-split would shred every such row.
function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * The same parse, but it can say NO.
 *
 * ⚠️ money() returning 0 for something it could not read is how a buy became free shares.
 * A Robinhood row whose Amount is unreadable came back as 0, and classify() reads zero
 * dollars with non-zero units as a corporate action — so the row imported as an adjustment,
 * at zero cost basis, counted as neither a trade nor a skip. Callers handling money must use
 * this one and decide for themselves what an unreadable figure means.
 *
 * ⚠️ AND THE $ COMES OFF BEFORE THE PARENTHESES ARE TESTED. "$(50.00)" is how more than one
 * export writes negative fifty dollars; testing for the parens first missed it, and what
 * reached parseFloat was "(50.00)" — NaN, i.e. zero, i.e. the bug above.
 */
function moneyOrNull(s) {
  if (s == null) return null
  let t = String(s).trim()
  if (!t) return null
  let neg = false
  t = t.replace(/[$,\s]/g, '')
  if (t.startsWith('(') && t.endsWith(')')) {
    neg = true
    t = t.slice(1, -1)
  }
  if (t.startsWith('-')) {
    neg = true
    t = t.slice(1)
  }
  if (t.startsWith('+')) t = t.slice(1)
  if (!/^\d*\.?\d+$/.test(t)) return null
  const n = parseFloat(t)
  return Number.isNaN(n) ? null : neg ? -n : n
}

// "$1,234.56" / "($0.62)" / "-$30.00" → signed number. Zero when unreadable, which is fine
// for a fee or a display figure and NOT fine for the amount of a trade — see moneyOrNull.
function money(s) {
  const n = moneyOrNull(s)
  return n == null ? 0 : n
}

function num(s) {
  if (s == null) return 0
  const n = parseFloat(String(s).replace(/[$,\s]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

const pad = (n) => String(n).padStart(2, '0')

function toISODate(s, source) {
  const t = String(s || '').trim()
  if (!t) return null
  if (source === 'cashapp') return t.split(' ')[0] // "2026-06-30 09:34:12 EDT"
  const [m, d, y] = t.split('/') // robinhood "6/22/2026"
  return y ? `${y}-${pad(m)}-${pad(d)}` : null
}

function headerLookup(header) {
  const map = {}
  header.forEach((h, i) => {
    map[h.trim().toLowerCase()] = i
  })
  return (name) => map[name.toLowerCase()]
}

/**
 * Which of the four things this row actually is.
 *
 * The parser already knows — it sets `reinvestment` for DRIPs and emits corporate actions with
 * no money on either side — but until now that knowledge died at the database boundary, and a
 * dividend-bought share was indistinguishable from one Evan paid for.
 *
 * ⚠️ `reinvestment` is tested FIRST, before the no-money check. A Robinhood SDIV is a dividend
 * paid in shares: it moves units with zero dollars, so it looks exactly like a split — but it is
 * a DRIP. The holding earned it. Calling it an adjustment gives the right answer for "what did
 * Evan contribute" by luck (neither counts) and the wrong one for "what have dividends earned
 * me", which is a question worth being able to ask later.
 *
 * A real corporate action is what's left: units move, no money, and nothing earned it.
 */
function classify(t) {
  if (t.reinvestment) return 'drip'
  if (t.dollars === 0 && t.units !== 0) return 'adjustment'
  return t.dollars < 0 ? 'sell' : 'buy'
}

function makeTrade(t, externalId) {
  // Stable key for de-duping across re-imports. Cash App rows carry a Transaction ID —
  // use it so two genuinely identical buys (same day/price/amount, e.g. recurring
  // purchases) aren't collapsed. Robinhood has no id, so hash the identifying fields.
  const importKey = createHash('sha1')
    .update(
      externalId
        ? `${t.platform}|id|${externalId}`
        : [t.platform, t.date, t.symbol, t.units, t.price, t.dollars].join('|'),
    )
    .digest('hex')
  // `kind` is NOT part of importKey — it describes the row, it doesn't identify it. Folding it
  // in would change the key of everything already imported and make re-imports insert copies.
  return { ...t, kind: classify(t), importKey }
}

// Shared per-file bookkeeping: skip counts, one raw sample row per skip reason (for
// diagnosing formats we haven't seen), and in-window sells (warned about, not imported).
function makeStats() {
  return {
    trades: [],
    skips: {},
    samples: {},
    // ⚠️ no running sells/adjustments counters here on purpose: they were incremented inside
    // the row loop while kept/netInvested were measured after de-duplication, so one summary
    // described two different imports. Both are derived from `trades` at the end now.
    dataRows: 0,
  }
}
function skip(stats, reason, row) {
  stats.skips[reason] = (stats.skips[reason] || 0) + 1
  const list = (stats.samples[reason] ||= [])
  if (list.length < 3) list.push(row.join(' | ').slice(0, 220))
}

// ── Robinhood: Activity Date, Instrument, Description, Trans Code, Quantity, Price, Amount
function fromRobinhood(rows, since) {
  const at = headerLookup(rows[0])
  const s = makeStats()
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.every((c) => c.trim() === '')) continue
    s.dataRows++
    const date = toISODate(row[at('Activity Date')], 'robinhood')
    /**
     * ⚠️ AN UNPARSEABLE DATE IS A SKIP, NOT A PASS.
     *
     * The --since filter was written `if (since && date && date < since)`, so a null date fell
     * through it as though it had been checked — a "just the new rows" run imported undated
     * history the operator believed was excluded. And the row that landed had date: null, which
     * poisons every date-dependent answer built on it: the holding-period and wash-sale work,
     * account_ledger walking a date order, the crossing calendar. importKey folds the date in
     * with .join(), which stringifies null to empty, so undated rows also collapse against each
     * other on symbol/units/price alone.
     */
    if (!date) {
      skip(s, 'unreadable date', row)
      continue
    }
    if (since && date < since) {
      s.skips[`before ${since}`] = (s.skips[`before ${since}`] || 0) + 1
      continue
    }
    const code = (row[at('Trans Code')] || '').trim()
    const symbol = (row[at('Instrument')] || '').trim()
    const units = num(row[at('Quantity')])
    if (code === 'Sell' && symbol && units > 0) {
      const amount = moneyOrNull(row[at('Amount')])
      if (amount == null || Math.abs(amount) <= 0) {
        skip(s, 'sell with unreadable amount', row)
        continue
      }
      let sellPrice = moneyOrNull(row[at('Price')])
      if (sellPrice == null || sellPrice <= 0) sellPrice = Math.abs(amount) / units
      s.trades.push(
        makeTrade({
          platform: 'robinhood',
          date,
          symbol,
          assetType: 'stock',
          units: -units,
          price: sellPrice,
          dollars: -Math.abs(amount),
          fee: 0,
          reinvestment: false,
          note: (row[at('Description')] || '').replace(/\s+/g, ' ').trim(),
        }),
      )
      continue
    }
    // unit-only share events (no cash): SPR/SXCH splits & symbol changes arrive as pairs —
    // "30S" = shares removed, plain "1" = shares added (QNCX 30-for-1 reverse split,
    // CCIV→LCID conversion); SDIV = a dividend paid in shares (always additive).
    if (code === 'SPR' || code === 'SXCH' || code === 'SDIV') {
      const qRaw = (row[at('Quantity')] || '').trim()
      const m = symbol ? qRaw.match(/^([\d.]+)(S?)$/i) : null
      const qty = m ? num(m[1]) : 0
      if (qty > 0) {
        s.trades.push(
          makeTrade({
            platform: 'robinhood',
            date,
            symbol,
            assetType: 'stock',
            units: m[2] ? -qty : qty,
            price: 0,
            dollars: 0,
            fee: 0,
            reinvestment: code === 'SDIV',
            note:
              (row[at('Description')] || '').replace(/\s+/g, ' ').trim() +
              (code === 'SPR'
                ? ' [stock split]'
                : code === 'SDIV'
                  ? ' [share dividend]'
                  : ' [symbol change]'),
          }),
        )
      } else {
        skip(s, `${code} (unparsed)`, row)
      }
      continue
    }
    if (code !== 'Buy' || !symbol || units <= 0) {
      const reason = ['OEXP', 'BTO', 'STO', 'STC', 'BTC', 'OASGN', 'OCA'].includes(code)
        ? 'option'
        : code === 'CDIV'
          ? 'cash dividend'
          : code === 'ACH'
            ? 'deposit'
            : code || 'other'
      skip(s, reason, row)
      continue
    }
    const note = (row[at('Description')] || '').replace(/\s+/g, ' ').trim()
    /**
     * ⚠️ THE MONEY IS CHECKED, not just the code, the symbol and the quantity.
     *
     * Cash App has had this guard all along (see `unparsed ${kind}` below); Robinhood did not,
     * so a Buy whose Amount would not parse — "$(50.00)", an empty cell, "-USD 50.00" — became
     * units at zero dollars, which classify() reads as a corporate action. Ten shares of
     * nothing entered the fund at zero cost basis, reported as neither a trade nor a skip.
     */
    const amount = moneyOrNull(row[at('Amount')])
    if (amount == null || Math.abs(amount) <= 0) {
      skip(s, 'buy with unreadable amount', row)
      continue
    }
    let buyPrice = moneyOrNull(row[at('Price')])
    if (buyPrice == null || buyPrice <= 0) buyPrice = Math.abs(amount) / units
    s.trades.push(
      makeTrade({
        platform: 'robinhood',
        date,
        symbol,
        assetType: 'stock',
        units,
        price: buyPrice,
        dollars: Math.abs(amount),
        fee: 0,
        reinvestment: /reinvest/i.test(note),
        note,
      }),
    )
  }
  return s
}

// ── Cash App: Date, Transaction Type, Amount, Fee, Asset Type, Asset Price, Asset Amount, Notes
// Format quirks seen in real exports (2020→2026):
//   - stock SELLS have an EMPTY Transaction Type; only the note says "$X Sale of <Company>"
//   - old bitcoin rows put the quantity in the note ("purchase of BTC 0.00244915") with the
//     Asset Amount column empty, and carry the total in Net Amount
//   - "Stock Dividends" rows are DRIPs that acquire shares (units + price present)
//   - stock rows have no Transaction ID, so dedupe keys use the full timestamp instead
function fromCashApp(rows, since) {
  const at = headerLookup(rows[0])
  const s = makeStats()
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.every((c) => c.trim() === '')) continue
    s.dataRows++
    const rawTs = (row[at('Date')] || '').trim()
    const date = toISODate(rawTs, 'cashapp')
    // an unreadable date is a skip, not a pass — see fromRobinhood for the full reasoning
    if (!date) {
      skip(s, 'unreadable date', row)
      continue
    }
    if (since && date < since) {
      s.skips[`before ${since}`] = (s.skips[`before ${since}`] || 0) + 1
      continue
    }
    const type = (row[at('Transaction Type')] || '').trim()
    const note = (row[at('Notes')] || '').trim()
    // "Stock Dividends" rows are DRIPs only when reinvested; "Dividend from X" is cash
    if (/stock dividends/i.test(type) && !/reinvested/i.test(note)) {
      skip(s, 'cash dividend', row)
      continue
    }
    const isBitcoin = /bitcoin|btc/i.test(type) || /\bBTC\b/.test(row[at('Asset Type')] || '')
    const symbol = (row[at('Asset Type')] || '').trim() || (isBitcoin ? 'BTC' : '')

    // classify: labeled buys/sells/DRIPs, or unlabeled rows identified by their note
    const kind = /sell/i.test(type)
      ? 'sell'
      : /buy/i.test(type)
        ? 'buy'
        : /stock dividends/i.test(type)
          ? 'buy'
          : !type && /sale of/i.test(note)
            ? 'sell'
            : !type && /purchase of/i.test(note)
              ? 'buy'
              : null
    if (!kind || !symbol) {
      skip(s, type.toLowerCase() || 'unlabeled', row)
      continue
    }

    // units: the Asset Amount column, else the note ("… BTC 0.00244915")
    // ⚠️ MAGNITUDE ONLY. Direction comes from Transaction Type (see `sell` below, which negates
    // it) — so a negative Asset Amount is the same trade written differently. Taking the raw
    // value meant the `units <= 0` guard below rejected such a row as "unparsed", and a sell
    // would vanish into a one-line skip count. Verified against all three shapes a sell arrives
    // in: positive units, negative net amount, and negative units.
    let units = Math.abs(num(row[at('Asset Amount')]))
    if (units <= 0) {
      const m = note.match(/\b(?:BTC|of)\s+([\d.]+)\s*$/i)
      if (m) units = num(m[1])
    }
    // dollars: Net Amount when present (old bitcoin rows), else Amount
    const net = Math.abs(money(row[at('Net Amount')]))
    const dollars = net > 0 ? net : Math.abs(money(row[at('Amount')]))
    let price = money(row[at('Asset Price')])
    if (price <= 0 && units > 0) price = dollars / units
    if (units <= 0 || dollars <= 0 || price <= 0) {
      skip(s, `unparsed ${kind}`, row)
      continue
    }

    // stock rows carry no Transaction ID — the full timestamp keeps two identical
    // same-day purchases distinct instead of collapsing them as duplicates
    const externalId =
      (row[at('Transaction ID')] || '').trim() || `${rawTs}|${symbol}|${units}|${dollars}`
    const sell = kind === 'sell'
    s.trades.push(
      makeTrade(
        {
          platform: 'cashapp',
          date,
          symbol,
          assetType: isBitcoin || symbol.toUpperCase() === 'BTC' ? 'crypto' : 'stock',
          units: sell ? -units : units,
          price,
          dollars: sell ? -dollars : dollars,
          fee: Math.abs(money(row[at('Fee')])),
          reinvestment: /dividend reinvested/i.test(note) || /stock dividends/i.test(type),
          note,
        },
        externalId,
      ),
    )
  }
  return s
}

/** Which broker wrote this file, from its header row. Null when it is neither. */
export function detectSource(rows) {
  const header = (rows[0] || []).map((h) => h.trim().toLowerCase()).join(',')
  if (header.includes('activity date')) return 'robinhood'
  if (header.includes('transaction type')) return 'cashapp'
  return null
}

/**
 * CSV text in, trades and a summary out.
 *
 * The summary is structured rather than pre-formatted, and `collapsed` is returned IN FULL
 * rather than as a count: those are rows dropped as duplicates, and in a Robinhood file they can
 * be real money (see the dedupe note below), so every caller has to be able to put them in front
 * of a human.
 */
export function parseTrades(text, { source: forcedSource = null, since = null } = {}) {
  const rows = parseCSV(text)
  const source = forcedSource || detectSource(rows)
  if (source !== 'robinhood' && source !== 'cashapp') {
    throw new Error(
      'Could not tell which broker this file came from — expected a Robinhood or Cash App export',
    )
  }
  const s = source === 'robinhood' ? fromRobinhood(rows, since) : fromCashApp(rows, since)

  /**
   * De-dupe within the file.
   *
   * ⚠️ COLLAPSED ROWS CAN BE REAL MONEY. Cash App rows carry a Transaction ID, so two genuinely
   * separate identical buys stay distinct. ROBINHOOD ROWS DO NOT — their key is a hash of
   * (date, symbol, units, price, dollars) and Activity Date has no time on it, so three real $20
   * purchases of the same stock on the same day at the same price are indistinguishable from one
   * row listed three times, and collapse to a single $20 trade.
   *
   * Not "fixed" here on purpose: the obvious repair is an occurrence ordinal in the key, but that
   * CHANGES THE KEY OF EVERY ROBINHOOD ROW ALREADY IMPORTED, and since import_key is what makes
   * re-imports idempotent the next run would insert a second copy of the whole history. That
   * needs a migration, not a patch.
   *
   * What this does instead is refuse to let a collapse be a quiet parenthetical.
   */
  const seenKeys = new Set()
  const trades = []
  const collapsed = []
  for (const t of s.trades) {
    if (seenKeys.has(t.importKey)) {
      collapsed.push(t)
      continue
    }
    seenKeys.add(t.importKey)
    trades.push(t)
  }

  const dates = trades
    .map((t) => t.date)
    .filter(Boolean)
    .sort()
  const bySymbol = {}
  for (const t of trades) bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + t.dollars

  return {
    source,
    trades,
    summary: {
      source,
      dataRows: s.dataRows,
      kept: trades.length,
      reinvestments: trades.filter((t) => t.reinvestment).length,
      /**
       * ⚠️ COUNTED AFTER DE-DUPLICATION, like everything else here.
       *
       * These were incremented inside the row loop while `kept` and `netInvested` were
       * measured afterwards, so one summary reported two different imports. Three identical
       * same-day Robinhood sells printed "Sells: 3 (-$33.00)" over a $11 net — the exact
       * collapse the block below exists to make loud, contradicted by the line above it.
       */
      sells: {
        count: trades.filter((t) => t.kind === 'sell').length,
        dollars: trades
          .filter((t) => t.kind === 'sell')
          .reduce((acc, t) => acc + Math.abs(t.dollars), 0),
      },
      adjustments: trades.filter((t) => t.dollars === 0 && t.units !== 0).length,
      skips: s.skips,
      skippedTotal: Object.values(s.skips).reduce((acc, n) => acc + n, 0),
      netInvested: trades.reduce((acc, t) => acc + t.dollars, 0),
      firstDate: dates[0] || null,
      lastDate: dates[dates.length - 1] || null,
      symbols: Object.keys(bySymbol).length,
      samples: s.samples,
      collapsed: collapsed.map((t) => ({
        date: t.date,
        symbol: t.symbol,
        units: t.units,
        price: t.price,
        dollars: t.dollars,
      })),
      collapsedDollars: collapsed.reduce((acc, t) => acc + Math.abs(t.dollars), 0),
    },
  }
}
