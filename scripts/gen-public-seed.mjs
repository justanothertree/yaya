// Generates src/circuit/publicSeed.ts — the public demo slice of the Circuit — from the LIVE
// database rather than from src/circuit/seed.ts.
//
//   node scripts/gen-public-seed.mjs            # dry run: says what it would write, writes nothing
//   node scripts/gen-public-seed.mjs --write    # actually overwrite src/circuit/publicSeed.ts
//
// ⚠️ WHY IT MOVED OFF seed.ts. seed.ts is a hand-maintained snapshot, and it had drifted: it
// contains the word "kind" zero times, while the live circuit_movies has had categories for
// months (a game, a meal). Regenerating from it could only ever reproduce the drift. And the
// drift is more visible than it used to be — publicData.ts pulls people and logs live from
// circuit_public(), but movies and watchlist ALWAYS come from this bundled file, so the
// signed-out Reviews and Pool are exactly as old as the last time somebody edited seed.ts by
// hand. Sourcing them from the table is the only way they stop rotting.
//
// ⚠️ THE WHOLE POINT OF THIS FILE IS WHAT IT LEAVES OUT. The public bundle must carry one
// person's slice and nobody else's, so the filter is explicit and then ASSERTED before a byte is
// written — see check() below. Every object is built field by field rather than spread, so a
// column added to a table later cannot quietly start shipping to every visitor.
//
// Needs the service role key, because it reads rows RLS would hide. It is a local authoring tool:
// the key never reaches the app, and nothing it writes contains one.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

/** The person the public demo is OF. Their account id — set PUBLIC_SEED_USER_ID in .env.local. */
const USER = envOf('PUBLIC_SEED_USER_ID') ?? argOf('--user')
/**
 * ⚠️ A CONSTANT, NEVER THE ACCOUNT ID. The emitted person and every rating key is '2', the id the
 * demo has always used. Ratings are keyed by account in the database, so mapping them onto a
 * made-up local id is what keeps a real uuid out of the public bundle — and it is also what the
 * sandbox expects, since ratersIn falls back to person.id when there is no account behind it.
 */
const LOCAL_ID = '2'

function envOf(key) {
  for (const f of ['.env.local', '.env']) {
    if (!existsSync(f)) continue
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      // tolerate a stray PowerShell `$env:` prefix, which .env.local currently has
      const m = line.match(/^\s*(?:\$env:)?([A-Z0-9_]+)\s*=\s*(.*)$/i)
      if (m && m[1] === key) return m[2].trim().replace(/^['"]|['"]$/g, '')
    }
  }
  return process.env[key]
}
const argOf = (flag) => {
  const hit = process.argv.find((a) => a === flag || a.startsWith(flag + '='))
  if (!hit) return undefined
  return hit.includes('=')
    ? hit.split('=').slice(1).join('=')
    : process.argv[process.argv.indexOf(hit) + 1]
}

const URL = envOf('VITE_SUPABASE_URL')
const KEY = envOf('SUPABASE_SERVICE_ROLE_KEY')
if (!URL || !KEY) fail('Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
if (!USER)
  fail(
    'Need the account id of the person the demo is of.\n' +
      '  Add PUBLIC_SEED_USER_ID=<uuid> to .env.local, or pass --user <uuid>.\n' +
      '  (Deliberately not hardcoded: this repository is public.)',
  )

function fail(msg) {
  console.error('\n' + msg + '\n')
  process.exit(1)
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } })
const grab = async (table, cols) => {
  const { data, error } = await sb.from(table).select(cols)
  if (error) fail(`reading ${table}: ${error.message}`)
  return data ?? []
}

// ── read ────────────────────────────────────────────────────────────────────
const peopleRows = await grab(
  'circuit_people',
  'id,name,color,goal,exercises,col_labels,owner_user_id',
)
const mine = peopleRows.filter((p) => p.owner_user_id === USER)
if (mine.length === 0) fail(`No circuit_people row is owned by ${USER}.`)
/* more than one person row can point at one account — the one with the history is the person,
   which is the same rule ratersIn applies when it dedupes columns on the board */
const logRows = await grab('circuit_logs', 'id,person_id,date,entries')
const countFor = (pid) => logRows.filter((l) => l.person_id === pid).length
const me = mine.sort((a, b) => countFor(b.id) - countFor(a.id))[0]

const ratingRows = await grab('circuit_ratings', 'movie_id,user_id,score,icons,review')
const myRatings = ratingRows.filter((r) => r.user_id === USER)
const ratedIds = new Set(myRatings.map((r) => r.movie_id))
const movieRows = await grab('circuit_movies', 'id,title,kind,date,rt')
const wlRows = await grab('circuit_watchlist', 'id,title,rt,kind')

// ── filter, field by field ──────────────────────────────────────────────────
const byMovie = new Map(myRatings.map((r) => [r.movie_id, r]))
const publicSeed = {
  people: [
    {
      id: LOCAL_ID,
      name: me.name,
      color: me.color ?? '#888',
      goal: me.goal ?? 100,
      exercises: me.exercises ?? [],
      colLabels: me.col_labels ?? [],
    },
  ],
  logs: logRows
    .filter((l) => l.person_id === me.id)
    .map((l) => ({
      id: l.id,
      personId: LOCAL_ID,
      date: typeof l.date === 'string' ? l.date.slice(0, 10) : l.date,
      entries: l.entries ?? [],
    })),
  // only films this person rated, carrying only this person's score
  movies: movieRows
    .filter((m) => ratedIds.has(m.id))
    .map((m) => {
      const r = byMovie.get(m.id)
      return {
        id: m.id,
        title: m.title,
        kind: m.kind ?? 'movie',
        ...(m.date ? { date: m.date } : {}),
        ...(m.rt ? { rt: m.rt } : {}),
        ratings: { [LOCAL_ID]: { score: r.score, icons: r.icons ?? [], review: r.review ?? null } },
      }
    }),
  /* ⚠️ Titles only, and deliberately the whole list. Pool options are shared suggestions rather
     than anybody's private data, and the pool is the one demo tab that needs a crowd of options
     to be worth spinning. Votes are dropped rather than filtered: they are rows keyed by account
     now, and the signed-out demo has no accounts for one to belong to. */
  watchlist: wlRows.map((w) => ({
    id: w.id,
    title: w.title,
    ...(w.rt ? { rt: w.rt } : {}),
    kind: w.kind ?? 'movie',
  })),
}

// ── refuse to write anything that carries somebody else ──────────────────────
const json = JSON.stringify(publicSeed, null, 2)
function check() {
  const bad = []
  if (publicSeed.people.length !== 1) bad.push(`expected 1 person, got ${publicSeed.people.length}`)
  if (publicSeed.people[0].id !== LOCAL_ID) bad.push('person id is not the local constant')
  if (publicSeed.logs.some((l) => l.personId !== LOCAL_ID))
    bad.push('a log belongs to someone else')
  for (const m of publicSeed.movies) {
    const keys = Object.keys(m.ratings)
    if (keys.length !== 1 || keys[0] !== LOCAL_ID)
      bad.push(`${m.title}: ratings keys ${keys.join()}`)
  }
  if (json.includes(USER)) bad.push('the account id appears in the output')
  for (const k of ['owner_user_id', 'ownerUserId', 'user_id', 'visibility', 'groupId', 'group_id'])
    if (json.includes(`"${k}"`)) bad.push(`a "${k}" field reached the output`)
  // every other account in the table, by name, must be absent from the ratings
  const others = new Set(ratingRows.map((r) => r.user_id).filter((u) => u !== USER))
  for (const u of others)
    if (json.includes(u)) bad.push(`another account (${u.slice(0, 8)}…) is in the output`)
  return bad
}
const problems = check()

const out = `// AUTO-GENERATED by scripts/gen-public-seed.mjs — do not edit by hand.
// One person's slice of the live Circuit: their board and logs, only the reviews they rated and
// only their own score on each, and the shared pool as titles. This is the public demo data
// shown to signed-out visitors, so it must never carry anybody else — the generator asserts that
// before it writes. Regenerate with: node scripts/gen-public-seed.mjs --write
import type { CircuitState } from './types'

export const publicSeed: CircuitState = ${json}
`

const was = existsSync('src/circuit/publicSeed.ts')
  ? readFileSync('src/circuit/publicSeed.ts', 'utf8')
  : ''
const kinds = {}
for (const m of publicSeed.movies) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1

console.log(`
  person    ${publicSeed.people[0].name} (emitted as id '${LOCAL_ID}')
  logs      ${publicSeed.logs.length}
  reviews   ${publicSeed.movies.length}   ${Object.entries(kinds)
    .map(([k, n]) => `${k}:${n}`)
    .join('  ')}
  pool      ${publicSeed.watchlist.length} titles
  size      ${was.length} -> ${out.length} bytes
  checks    ${problems.length === 0 ? 'all passed' : 'FAILED'}`)

if (problems.length) {
  fail('Refusing to write — the slice is not clean:\n  - ' + problems.join('\n  - '))
}
if (!process.argv.includes('--write')) {
  console.log('\n  dry run — nothing written. Re-run with --write to overwrite publicSeed.ts.\n')
} else {
  writeFileSync('src/circuit/publicSeed.ts', out)
  console.log('\n  wrote src/circuit/publicSeed.ts\n')
}
