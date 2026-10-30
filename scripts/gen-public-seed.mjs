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
// ⚠️ AND THAT SAME SENTENCE IS NOW THE REASON MOVIES AND WATCHLIST ARE EMPTY. "They always
// come from this bundled file" means tightening circuit_public() did nothing for them: the
// server stopped serving a private group's films and this constant kept shipping 74 of them on
// first paint and on every failed fetch. A film belongs to a GROUP, not to whoever rated it.
// People and logs still come from the table; the two list fields are empty and the checks below
// refuse to write a file where they are not.
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
/** include icons and the written review with each score — off by default, see the note below */

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
  /**
   * ⚠️ EMPTY, AND THE REASON IS THE SAME ONE `circuit_public()` LEARNED THE HARD WAY: A FILM
   * BELONGS TO A GROUP, NOT TO WHOEVER RATED IT. This used to emit every film the demo person
   * had rated — 74 of them — on the reasoning that only his own score travelled with each. But
   * the TITLES are the group's: all 74 belong to The Crew, which is eight people, and one of
   * them opting into the public board was publishing the other seven's catalogue in a bundle
   * every visitor downloads. Filtering the ratings was careful about the wrong noun.
   *
   * ⚠️ AND THIS FILE IS WORSE THAN THE RPC, WHICH IS WHY IT IS EMPTY RATHER THAN FILTERED. The
   * server-side board is a query that re-answers the question on every call; this is a constant
   * compiled into the bundle, shown on FIRST PAINT and whenever the fetch fails. Tightening
   * `circuit_public()` and leaving this file alone meant the films kept shipping — just from the
   * other half of the pair.
   *
   * When a group can say it is public, this can come back as "films from groups that are",
   * generated by the same rule the server uses. Until then the honest number is zero.
   */
  movies: [],
  /**
   * ⚠️ EMPTY FOR THE SAME REASON, and this one was argued the other way in writing. The comment
   * that used to sit here called pool options "shared suggestions rather than anybody's private
   * data" and shipped the whole list of 110 deliberately. They are nominations inside private
   * groups, and several of them are members' own first names — which is what a crowd of
   * suggestions looks like when the crowd is somebody's family.
   */
  watchlist: [],
}

// ── refuse to write anything that carries somebody else ──────────────────────
const json = JSON.stringify(publicSeed, null, 2)
function check() {
  const bad = []
  if (publicSeed.people.length !== 1) bad.push(`expected 1 person, got ${publicSeed.people.length}`)
  if (publicSeed.people[0].id !== LOCAL_ID) bad.push('person id is not the local constant')
  if (publicSeed.logs.some((l) => l.personId !== LOCAL_ID))
    bad.push('a log belongs to someone else')
  /**
   * ⚠️ THE TWO ASSERTIONS THAT MATTER MOST, because they are about what is NOT here. A filter
   * that stops being applied leaves an array that looks plausible; an array that must be empty
   * cannot. If films or pool titles ever need to ship again they will need a rule about GROUPS,
   * and whoever writes it will have to delete these two lines on purpose — which is the point.
   */
  if (publicSeed.movies.length !== 0)
    bad.push(`movies must be empty, got ${publicSeed.movies.length} — see the note above it`)
  if (publicSeed.watchlist.length !== 0)
    bad.push(`watchlist must be empty, got ${publicSeed.watchlist.length} — see the note above it`)
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
/* ⚠️ WHAT WAS LEFT OUT IS PRINTED, NOT JUST WHAT WENT IN. An exclusion that reports nothing is
   one nobody notices has stopped happening -- and these two numbers are the whole point of the
   run. They are counted from the live tables, so they also say how much would ship if somebody
   deleted the assertions. */
console.log(`
  person    ${publicSeed.people[0].name} (emitted as id '${LOCAL_ID}')
  logs      ${publicSeed.logs.length}
  reviews   ${publicSeed.movies.length}   (held back: ${movieRows.filter((m) => ratedIds.has(m.id)).length} the demo person rated, of ${movieRows.length} in the table)
  pool      ${publicSeed.watchlist.length} titles   (held back: ${wlRows.length})
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
