#!/usr/bin/env node
// Parse Robinhood / Cash App activity CSVs into normalized family-fund trades.
//
// DRY RUN by default: reads a broker export, keeps only share-acquiring BUYS
// (skips options, cash dividends, and deposits), de-dupes, prints a summary,
// and writes the normalized trades to <input>.parsed.json. Nothing touches the
// database yet — the --commit path (insert + even-split allocation) lands next.
//
// Usage:
//   node scripts/import-trades.mjs <export.csv> [--source robinhood|cashapp]
//                                  [--commit] [--allocate-even]
// Source is auto-detected from the header row when --source is omitted.
// DRY RUN unless --commit is passed. --commit reads SUPABASE_SERVICE_ROLE_KEY
// (and optional SUPABASE_URL / FUND_OWNER_UID) from your environment — those stay
// local and are never printed. --allocate-even additionally splits each imported
// trade evenly across your active family accounts.

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

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
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

// "$1,234.56" / "($0.62)" / "-$30.00" → signed number (parens = negative)
function money(s) {
  if (s == null) return 0
  let t = String(s).trim()
  if (!t) return 0
  let neg = false
  if (t.startsWith('(') && t.endsWith(')')) { neg = true; t = t.slice(1, -1) }
  t = t.replace(/[$,\s]/g, '')
  if (t.startsWith('-')) { neg = true; t = t.slice(1) }
  if (t.startsWith('+')) t = t.slice(1)
  const n = parseFloat(t)
  return Number.isNaN(n) ? 0 : neg ? -n : n
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
  header.forEach((h, i) => { map[h.trim().toLowerCase()] = i })
  return (name) => map[name.toLowerCase()]
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
  return { ...t, importKey }
}

// Shared per-file bookkeeping: skip counts, one raw sample row per skip reason (for
// diagnosing formats we haven't seen), and in-window sells (warned about, not imported).
function makeStats() {
  return {
    trades: [],
    skips: {},
    samples: {},
    sells: { count: 0, dollars: 0 },
    adjustments: 0,
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
    if (since && date && date < since) {
      s.skips[`before ${since}`] = (s.skips[`before ${since}`] || 0) + 1
      continue
    }
    const code = (row[at('Trans Code')] || '').trim()
    const symbol = (row[at('Instrument')] || '').trim()
    const units = num(row[at('Quantity')])
    if (code === 'Sell' && symbol && units > 0) {
      s.sells.count++
      s.sells.dollars += Math.abs(money(row[at('Amount')]))
      s.trades.push(makeTrade({
        platform: 'robinhood',
        date,
        symbol,
        assetType: 'stock',
        units: -units,
        price: money(row[at('Price')]),
        dollars: -Math.abs(money(row[at('Amount')])),
        fee: 0,
        reinvestment: false,
        note: (row[at('Description')] || '').replace(/\s+/g, ' ').trim(),
      }))
      continue
    }
    // splits + symbol changes: unit-only adjustment pairs — "30S" = shares removed,
    // plain "1" = shares added (e.g. QNCX 30-for-1 reverse split, CCIV→LCID conversion)
    if (code === 'SPR' || code === 'SXCH') {
      const qRaw = (row[at('Quantity')] || '').trim()
      const m = symbol ? qRaw.match(/^([\d.]+)(S?)$/i) : null
      const qty = m ? num(m[1]) : 0
      if (qty > 0) {
        s.adjustments++
        s.trades.push(makeTrade({
          platform: 'robinhood',
          date,
          symbol,
          assetType: 'stock',
          units: m[2] ? -qty : qty,
          price: 0,
          dollars: 0,
          fee: 0,
          reinvestment: false,
          note:
            (row[at('Description')] || '').replace(/\s+/g, ' ').trim() +
            (code === 'SPR' ? ' [stock split]' : ' [symbol change]'),
        }))
      } else {
        skip(s, code === 'SPR' ? 'stock split (unparsed)' : 'symbol change (unparsed)', row)
      }
      continue
    }
    if (code !== 'Buy' || !symbol || units <= 0) {
      const reason =
        ['OEXP', 'BTO', 'STO', 'STC', 'BTC', 'OASGN', 'OCA'].includes(code) ? 'option'
        : code === 'CDIV' ? 'cash dividend'
        : code === 'ACH' ? 'deposit'
        : code || 'other'
      skip(s, reason, row)
      continue
    }
    const note = (row[at('Description')] || '').replace(/\s+/g, ' ').trim()
    s.trades.push(makeTrade({
      platform: 'robinhood',
      date,
      symbol,
      assetType: 'stock',
      units,
      price: money(row[at('Price')]),
      dollars: Math.abs(money(row[at('Amount')])),
      fee: 0,
      reinvestment: /reinvest/i.test(note),
      note,
    }))
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
    if (since && date && date < since) {
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
    const isBitcoin = /bitcoin|btc/i.test(type) || /\bBTC\b/.test((row[at('Asset Type')] || ''))
    const symbol = (row[at('Asset Type')] || '').trim() || (isBitcoin ? 'BTC' : '')

    // classify: labeled buys/sells/DRIPs, or unlabeled rows identified by their note
    const kind =
      /sell/i.test(type) ? 'sell'
      : /buy/i.test(type) ? 'buy'
      : /stock dividends/i.test(type) ? 'buy'
      : !type && /sale of/i.test(note) ? 'sell'
      : !type && /purchase of/i.test(note) ? 'buy'
      : null
    if (!kind || !symbol) {
      skip(s, type.toLowerCase() || 'unlabeled', row)
      continue
    }

    // units: the Asset Amount column, else the note ("… BTC 0.00244915")
    let units = num(row[at('Asset Amount')])
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
    if (sell) {
      s.sells.count++
      s.sells.dollars += dollars
    }
    s.trades.push(makeTrade({
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
    }, externalId))
  }
  return s
}

// ── main: the sync ──────────────────────────────────────────────────────────
// One command, now and forever: download fresh exports, run with --commit, done.
// Full history by default (dedupe makes re-runs safe); family/personal is decided
// by the position toggles on the site, not by import flags.
const args = process.argv.slice(2)
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--source' && args[i - 1] !== '--since')
if (files.length === 0) {
  console.error(
    'usage: node scripts/import-trades.mjs <export.csv> [more.csv…] [--commit] [--since YYYY-MM-DD]',
  )
  process.exit(1)
}
const forcedSource = (args.includes('--source') ? args[args.indexOf('--source') + 1] : '').toLowerCase()
// Optional: only trades on/after this date (rarely needed — the sync imports everything).
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('--since must be YYYY-MM-DD')
  process.exit(1)
}
const committing = args.includes('--commit')

function parseFile(file) {
  const rows = parseCSV(readFileSync(file, 'utf8'))
  let source = forcedSource
  if (!source) {
    const header = rows[0].map((h) => h.trim().toLowerCase()).join(',')
    source = header.includes('activity date') ? 'robinhood'
      : header.includes('transaction type') ? 'cashapp' : ''
  }
  if (source !== 'robinhood' && source !== 'cashapp') {
    console.error(`Could not detect source for ${file} — pass --source robinhood|cashapp`)
    process.exit(1)
  }
  const s = source === 'robinhood' ? fromRobinhood(rows, since) : fromCashApp(rows, since)

  // de-dupe within the file
  const seenKeys = new Set()
  const unique = []
  for (const t of s.trades) {
    if (seenKeys.has(t.importKey)) continue
    seenKeys.add(t.importKey)
    unique.push(t)
  }

  const total = unique.reduce((acc, t) => acc + t.dollars, 0)
  const reinv = unique.filter((t) => t.reinvestment).length
  const skippedTotal = Object.values(s.skips).reduce((acc, n) => acc + n, 0)
  const dates = unique.map((t) => t.date).filter(Boolean).sort()
  const bySymbol = {}
  for (const t of unique) bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + t.dollars

  console.log(`\n=== ${source} — ${file}${committing ? '' : ' (DRY RUN)'} ===`)
  console.log(`Rows in file   : ${s.dataRows}${since ? `   (only ${since} and later)` : ''}`)
  console.log(`Kept           : ${unique.length} buys+sells${s.trades.length - unique.length ? ` (after removing ${s.trades.length - unique.length} in-file dupes)` : ''}${reinv ? `, incl ${reinv} dividend reinvestments` : ''}`)
  if (s.sells.count > 0) {
    console.log(`Sells          : ${s.sells.count} (−$${s.sells.dollars.toFixed(2)}) — netted against buys`)
  }
  if (s.adjustments > 0) {
    console.log(`Adjustments    : ${s.adjustments} split/symbol-change unit corrections`)
  }
  console.log(`Skipped        : ${skippedTotal}`)
  for (const [k, v] of Object.entries(s.skips).sort((a, b) => b[1] - a[1])) console.log(`   - ${k}: ${v}`)
  console.log(`Net invested   : $${total.toFixed(2)} (buys minus sells)`)
  console.log(`Date range     : ${dates[0] || '—'} → ${dates[dates.length - 1] || '—'}`)
  console.log(`Symbols        : ${Object.keys(bySymbol).length}`)
  if (Object.keys(s.samples).length) {
    console.log('Raw examples per skipped kind (spot-check that nothing real is skipped):')
    for (const [k, list] of Object.entries(s.samples)) {
      console.log(`   [${k}]`)
      for (const line of list) console.log(`      ${line}`)
    }
  }

  const out = file.replace(/\.csv$/i, '') + '.parsed.json'
  writeFileSync(out, JSON.stringify(unique, null, 2))
  console.log(`Wrote ${unique.length} normalized trades → ${out}`)
  return unique
}

const parsed = files.map(parseFile)

if (!committing) {
  console.log('\nDRY RUN — nothing written. Re-run with --commit to sync.\n')
  process.exit(0)
}

// ── commit: sync into the database via the admin RPCs ───────────────────────
// Uses YOUR service-role key from the environment (never committed, never printed).
// Idempotent: existing trades are skipped, existing allocations untouched, and
// only symbols you haven't toggled to Personal get split across the fund.
const url = process.env.SUPABASE_URL || 'https://lcpyatpktpkiybocyoij.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const owner = process.env.FUND_OWNER_UID || 'e7f2eec5-f4cb-4b1b-bf94-09e4ec1751f7'
if (!key) {
  console.error('\n--commit needs SUPABASE_SERVICE_ROLE_KEY in your environment. Aborting (nothing written).')
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(url, key, { auth: { persistSession: false } })

for (let i = 0; i < files.length; i++) {
  const { data: imp, error: impErr } = await sb.rpc('admin_import_trades', {
    p_user_id: owner,
    p_trades: parsed[i],
  })
  if (impErr) {
    console.error(`Import failed for ${files[i]}:`, impErr.message)
    process.exit(1)
  }
  console.log(`\n${files[i]} → inserted ${imp.inserted}, already present ${imp.skipped} of ${imp.total}.`)
}

const { data: alloc, error: allocErr } = await sb.rpc('admin_even_split_trades', { p_user_id: owner })
if (allocErr) {
  console.error('Allocation failed:', allocErr.message)
  process.exit(1)
}
console.log(
  `Even-split → ${alloc.tradesAllocated} new trades across ${alloc.accounts} active accounts (${alloc.allocationsCreated} allocations; personal-toggled symbols skipped).`,
)
console.log('Synced.\n')
