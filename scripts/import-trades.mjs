#!/usr/bin/env node
// Parse Robinhood / Cash App activity CSVs into normalized family-fund trades.
//
// DRY RUN by default: reads a broker export, keeps only share-acquiring BUYS
// (skips options, cash dividends, and deposits), de-dupes, prints a summary,
// and writes the normalized trades to <input>.parsed.json. Nothing touches the
// database yet — the --commit path (insert + even-split allocation) lands next.
//
// Usage:
//   node scripts/import-trades.mjs <export.csv> [more.csv…] [--source robinhood|cashapp]
//                                  [--commit] [--since YYYY-MM-DD]
// Pass BOTH broker exports at once — the source is auto-detected per file from its header row,
// so a Robinhood and a Cash App CSV can share one command.
//
// DRY RUN unless --commit is passed; a dry run writes <input>.parsed.json to read before you
// trust it. --commit reads SUPABASE_SERVICE_ROLE_KEY (and optional SUPABASE_URL /
// FUND_OWNER_UID) from your environment — those stay local and are never printed.
//
// Re-running is safe: rows are keyed by import_key and an existing one is reported as "already
// present" rather than inserted again. ⚠️ Which also means a re-run does NOT backfill columns
// added since a row was first imported (`kind`, for one) — skipped is skipped.
//
// The even split across active family accounts happens automatically after every --commit;
// there is no flag for it. (There was a --allocate-even once. It is gone, and this comment
// claimed otherwise for a while.)

import { readFileSync, writeFileSync } from 'node:fs'
// One parser, shared with the relay's /import-trades endpoint — see the note in that file.
import { parseTrades } from '../shared/parseTrades.mjs'

// ── main: the sync ──────────────────────────────────────────────────────────
// One command, now and forever: download fresh exports, run with --commit, done.
// Full history by default (dedupe makes re-runs safe); family/personal is decided
// by the position toggles on the site, not by import flags.
const args = process.argv.slice(2)
const files = args.filter(
  (a, i) => !a.startsWith('--') && args[i - 1] !== '--source' && args[i - 1] !== '--since',
)
if (files.length === 0) {
  console.error(
    'usage: node scripts/import-trades.mjs <export.csv> [more.csv…] [--commit] [--since YYYY-MM-DD]',
  )
  process.exit(1)
}
const forcedSource = (
  args.includes('--source') ? args[args.indexOf('--source') + 1] : ''
).toLowerCase()
// Optional: only trades on/after this date (rarely needed — the sync imports everything).
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('--since must be YYYY-MM-DD')
  process.exit(1)
}
const committing = args.includes('--commit')

function parseFile(file) {
  // The parsing itself lives in shared/parseTrades.mjs so the Admin upload cannot disagree with
  // this command about what a file contains. Everything below is presentation.
  let out
  try {
    out = parseTrades(readFileSync(file, 'utf8'), { source: forcedSource || null, since })
  } catch (err) {
    console.error(`${file}: ${err.message}`)
    console.error('Pass --source robinhood|cashapp if the header row is unusual.')
    process.exit(1)
  }
  const { source, trades, summary: m } = out

  console.log(`
=== ${source} — ${file}${committing ? '' : ' (DRY RUN)'} ===`)
  console.log(`Rows in file   : ${m.dataRows}${since ? `   (only ${since} and later)` : ''}`)
  console.log(
    `Kept           : ${m.kept} buys+sells${m.reinvestments ? `, incl ${m.reinvestments} dividend reinvestments` : ''}`,
  )
  if (m.collapsed.length) {
    console.log(
      `⚠️  COLLAPSED    : ${m.collapsed.length} row${m.collapsed.length === 1 ? '' : 's'} identical to an earlier one — $${m.collapsedDollars.toFixed(2)} NOT imported`,
    )
    if (source === 'robinhood') {
      console.log(
        `                 Robinhood rows have no transaction id and Activity Date has no time,`,
      )
      console.log(
        `                 so a genuine second purchase of the same stock, same day, same price`,
      )
      console.log(
        `                 is indistinguishable from a repeated row. CHECK THESE AGAINST YOUR`,
      )
      console.log(`                 STATEMENT before trusting the totals:`)
    }
    for (const t of m.collapsed.slice(0, 10)) {
      console.log(`                 ${t.date} ${t.symbol} ${t.units} @ ${t.price} = ${t.dollars}`)
    }
    if (m.collapsed.length > 10)
      console.log(`                 …and ${m.collapsed.length - 10} more`)
  }
  if (m.sells.count > 0) {
    console.log(
      `Sells          : ${m.sells.count} (−$${m.sells.dollars.toFixed(2)}) — netted against buys`,
    )
  }
  if (m.adjustments > 0) {
    console.log(`Adjustments    : ${m.adjustments} split/symbol-change unit corrections`)
  }
  console.log(`Skipped        : ${m.skippedTotal}`)
  for (const [k, v] of Object.entries(m.skips).sort((x, y) => y[1] - x[1]))
    console.log(`   - ${k}: ${v}`)
  console.log(`Net invested   : $${m.netInvested.toFixed(2)} (buys minus sells)`)
  console.log(`Date range     : ${m.firstDate || '—'} → ${m.lastDate || '—'}`)
  console.log(`Symbols        : ${m.symbols}`)
  if (Object.keys(m.samples).length) {
    console.log('Raw examples per skipped kind (spot-check that nothing real is skipped):')
    for (const [k, list] of Object.entries(m.samples)) {
      console.log(`   [${k}]`)
      for (const line of list) console.log(`      ${line}`)
    }
  }

  const outFile = file.replace(/\.csv$/i, '') + '.parsed.json'
  writeFileSync(outFile, JSON.stringify(trades, null, 2))
  console.log(`Wrote ${trades.length} normalized trades → ${outFile}`)
  return trades
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
// No hardcoded default: this repo is public, and an account uuid in it is a ready-made target
// for anyone crafting calls against a specific account. Pass FUND_OWNER_UID in the environment.
const owner = process.env.FUND_OWNER_UID
// Report EVERYTHING missing at once. Checking one at a time means you set the first, re-run,
// and get told about the second — two round trips at exactly the moment you are already annoyed
// the import did not just work.
const missing = [
  !owner && 'FUND_OWNER_UID (the account to import trades for)',
  !key && 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean)
if (missing.length) {
  console.error('\n--commit needs these in your environment. Aborting, nothing written:')
  for (const m of missing) console.error(`  - ${m}`)
  console.error('')
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
  console.log(
    `\n${files[i]} → inserted ${imp.inserted}, already present ${imp.skipped} of ${imp.total}.`,
  )
}

const { data: alloc, error: allocErr } = await sb.rpc('admin_even_split_trades', {
  p_user_id: owner,
})
if (allocErr) {
  console.error('Allocation failed:', allocErr.message)
  process.exit(1)
}
console.log(
  `Even-split → ${alloc.tradesAllocated} new trades across ${alloc.accounts} active accounts (${alloc.allocationsCreated} allocations; personal-toggled symbols skipped).`,
)
console.log('Synced.\n')
