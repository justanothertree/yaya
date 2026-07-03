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
  return { trades: [], skips: {}, samples: {}, sells: { count: 0, dollars: 0 }, dataRows: 0 }
}
function skip(stats, reason, row) {
  stats.skips[reason] = (stats.skips[reason] || 0) + 1
  if (!stats.samples[reason]) stats.samples[reason] = row.join(' | ').slice(0, 220)
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
    if (code === 'Sell') {
      s.sells.count++
      s.sells.dollars += Math.abs(money(row[at('Amount')]))
      skip(s, 'sell (not imported yet)', row)
      continue
    }
    if (code !== 'Buy' || !symbol || units <= 0) {
      const reason =
        ['OEXP', 'BTO', 'STO', 'STC', 'BTC', 'OASGN', 'OCA'].includes(code) ? 'option'
        : code === 'CDIV' ? 'cash dividend'
        : code === 'ACH' ? 'deposit'
        : code === 'SPR' ? 'stock split (heads up — affects share counts)'
        : code === 'SXCH' ? 'symbol change (heads up)'
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
function fromCashApp(rows, since) {
  const at = headerLookup(rows[0])
  const s = makeStats()
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.every((c) => c.trim() === '')) continue
    s.dataRows++
    const date = toISODate(row[at('Date')], 'cashapp')
    if (since && date && date < since) {
      s.skips[`before ${since}`] = (s.skips[`before ${since}`] || 0) + 1
      continue
    }
    const type = (row[at('Transaction Type')] || '').trim()
    const isBitcoin = /bitcoin|btc/i.test(type)
    // bitcoin rows sometimes leave Asset Type blank — the asset is bitcoin itself
    const symbol = (row[at('Asset Type')] || '').trim() || (isBitcoin ? 'BTC' : '')
    const units = num(row[at('Asset Amount')])
    if (/sell/i.test(type)) {
      s.sells.count++
      s.sells.dollars += Math.abs(money(row[at('Amount')]))
      skip(s, 'sell (not imported yet)', row)
      continue
    }
    if (!/buy/i.test(type) || !symbol || units <= 0) {
      skip(s, type.toLowerCase() || 'other', row)
      continue
    }
    s.trades.push(makeTrade({
      platform: 'cashapp',
      date,
      symbol,
      assetType: isBitcoin || symbol.toUpperCase() === 'BTC' ? 'crypto' : 'stock',
      units,
      price: money(row[at('Asset Price')]),
      dollars: Math.abs(money(row[at('Amount')])),
      fee: Math.abs(money(row[at('Fee')])),
      reinvestment: false,
      note: (row[at('Notes')] || '').trim(),
    }, (row[at('Transaction ID')] || '').trim() || undefined))
  }
  return s
}

// ── main ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error(
    'usage: node scripts/import-trades.mjs <export.csv> [--source robinhood|cashapp] [--since YYYY-MM-DD]',
  )
  process.exit(1)
}
let source = (args.includes('--source') ? args[args.indexOf('--source') + 1] : '').toLowerCase()
// Only import trades on/after this date. Full exports go back years — for the family fund
// you almost always want --since 2026-01-01 (the dollar-a-day start).
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('--since must be YYYY-MM-DD')
  process.exit(1)
}

const rows = parseCSV(readFileSync(file, 'utf8'))
if (!source) {
  const header = rows[0].map((h) => h.trim().toLowerCase()).join(',')
  source = header.includes('activity date') ? 'robinhood'
    : header.includes('transaction type') ? 'cashapp' : ''
}
if (source !== 'robinhood' && source !== 'cashapp') {
  console.error('Could not detect source — pass --source robinhood|cashapp')
  process.exit(1)
}

const { trades, skips, samples, sells, dataRows } =
  source === 'robinhood' ? fromRobinhood(rows, since) : fromCashApp(rows, since)

// de-dupe within the file
const seen = new Set()
const unique = []
for (const t of trades) {
  if (seen.has(t.importKey)) continue
  seen.add(t.importKey)
  unique.push(t)
}

const total = unique.reduce((s, t) => s + t.dollars, 0)
const reinv = unique.filter((t) => t.reinvestment).length
const skippedTotal = Object.values(skips).reduce((s, n) => s + n, 0)
const dates = unique.map((t) => t.date).filter(Boolean).sort()
const bySymbol = {}
for (const t of unique) bySymbol[t.symbol] = (bySymbol[t.symbol] || 0) + t.dollars

console.log('\n=== Trade import (DRY RUN) ===')
console.log(`Source         : ${source}`)
console.log(`Since          : ${since || 'ALL HISTORY — for the family fund use --since 2026-01-01'}`)
console.log(`Rows in file   : ${dataRows}`)
console.log(`Kept (buys)    : ${unique.length}${trades.length - unique.length ? ` (after removing ${trades.length - unique.length} in-file dupes)` : ''}${reinv ? `, incl ${reinv} dividend reinvestments` : ''}`)
console.log(`Skipped        : ${skippedTotal}`)
for (const [k, v] of Object.entries(skips).sort((a, b) => b[1] - a[1])) console.log(`   - ${k}: ${v}`)
if (sells.count > 0) {
  console.log(
    `\n⚠ ${sells.count} sell(s) totaling $${sells.dollars.toFixed(2)} in this range were NOT imported —` +
      '\n  sells aren’t supported yet, so holdings/invested will overstate by roughly that much.',
  )
}
console.log(`Invested (cost): $${total.toFixed(2)}`)
console.log(`Date range     : ${dates[0] || '—'} → ${dates[dates.length - 1] || '—'}`)
console.log(`Symbols (${Object.keys(bySymbol).length}):`)
for (const [s, d] of Object.entries(bySymbol).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${s.padEnd(6)} $${d.toFixed(2)}`)
}
if (Object.keys(samples).length) {
  console.log('\nOne raw example per skipped kind (for spot-checking the filter):')
  for (const [k, v] of Object.entries(samples)) console.log(`   [${k}]\n      ${v}`)
}

const out = file.replace(/\.csv$/i, '') + '.parsed.json'
writeFileSync(out, JSON.stringify(unique, null, 2))
console.log(`\nWrote ${unique.length} normalized trades → ${out}`)

if (!args.includes('--commit')) {
  console.log('DRY RUN — nothing written to the database. Re-run with --commit to import.\n')
  process.exit(0)
}

// Guardrail: a full-history export without --since once imported six years of gross buys
// into the fund. Committing pre-fund data now requires saying so explicitly.
if (!since && dates[0] && dates[0] < '2026-01-01' && !args.includes('--all-history')) {
  console.error(
    `\n⛔ Not committing: this export reaches back to ${dates[0]}, before the fund started.` +
      '\n   For the family fund, add:      --since 2026-01-01' +
      '\n   To really import everything:   --all-history\n',
  )
  process.exit(1)
}

// ── --commit: push into the database via the admin import RPC ────────────────
// Runs against your project with YOUR service-role key, read from the environment
// (never committed, never printed). Nothing here can run without that key.
const url = process.env.SUPABASE_URL || 'https://lcpyatpktpkiybocyoij.supabase.co'
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const owner = process.env.FUND_OWNER_UID || 'e7f2eec5-f4cb-4b1b-bf94-09e4ec1751f7'
if (!key) {
  console.error('\n--commit needs SUPABASE_SERVICE_ROLE_KEY in your environment. Aborting (nothing written).')
  process.exit(1)
}

const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(url, key, { auth: { persistSession: false } })

const { data: imp, error: impErr } = await sb.rpc('admin_import_trades', { p_user_id: owner, p_trades: unique })
if (impErr) {
  console.error('Import failed:', impErr.message)
  process.exit(1)
}
console.log(`\nImported → inserted ${imp.inserted}, skipped ${imp.skipped} (already present) of ${imp.total}.`)

if (args.includes('--allocate-even')) {
  const { data: alloc, error: allocErr } = await sb.rpc('admin_even_split_trades', { p_user_id: owner })
  if (allocErr) {
    console.error('Allocation failed:', allocErr.message)
    process.exit(1)
  }
  console.log(`Even-split → ${alloc.tradesAllocated} trades across ${alloc.accounts} active family accounts (${alloc.allocationsCreated} allocations).`)
}
console.log('Done.\n')
