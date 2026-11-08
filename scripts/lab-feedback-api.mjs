/**
 * The Lab's votes and notes asked through the REAL API path: Supabase Auth (GoTrue) issues each
 * session, PostgREST verifies it and runs the draft's functions as that member, exactly as the
 * site's own client would. Nothing here forges a claim or stands in for a server.
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=… LAB_TEST_DB_URL=postgresql://…:54322/… \
 *     node scripts/lab-feedback-api.mjs
 *
 * ⚠️ LOCAL ONLY, AND IT SAYS SO BEFORE IT DOES ANYTHING. It signs accounts up and writes fixture
 * rows (a profile, an age band, a friendship, the admin row, a suspension) with psql — so it
 * refuses any URL that is not this machine. Run it against `supabase start` with
 * supabase/drafts/lab-catalog-and-feedback.sql applied; docs/2026-11-07-lab-catalog-and-feedback.md
 * has the steps. It cleans up the accounts it made, pass or fail.
 *
 * The fixture facts are set in SQL because no API sets them: an age band and the admin row are
 * the owner's to set by design, and a profile is made by the site's own sign-up flow, not by
 * GoTrue. Every call that is UNDER TEST goes through the API with the session GoTrue issued.
 */
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const URL_ = process.env.SUPABASE_URL ?? ''
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
const DB = process.env.LAB_TEST_DB_URL ?? ''
const local = (u) => /^(https?|postgresql):\/\/([^@/]*@)?(127\.0\.0\.1|localhost)[:/]/.test(u)
if (!local(URL_) || !local(DB) || !ANON) {
  console.error(
    'refusing: SUPABASE_URL and LAB_TEST_DB_URL must both be this machine, and SUPABASE_ANON_KEY set',
  )
  process.exit(2)
}

const sql = (text) =>
  execFileSync('psql', [DB, '-qXAt', '-v', 'ON_ERROR_STOP=1', '-c', text], {
    encoding: 'utf8',
  }).trim()
if (sql(`select to_regprocedure('public.lab_catalog()') is not null`) !== 't') {
  console.error('refusing: the draft is not applied to this database')
  process.exit(2)
}

const run = Date.now().toString(36)
const results = []
const ok = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail })
const client = () =>
  createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
/** a PostgREST answer, as data or the error message it carried */
const call = async (c, fn, args) => {
  const { data, error } = await c.rpc(fn, args)
  return error ? { error: error.message, code: error.code } : { data }
}
const made = []

// ⚠️ AFTER A DATABASE RESET POSTGREST RECONNECTS, and its first answer can be "Database client
// error. Retrying the connection." — measured, on the first call of a run. That is the API
// starting, not a rule failing, so wait for it to answer before asking it anything.
for (let k = 0; ; k++) {
  const { error } = await client().rpc('lab_catalog')
  if (!error) break
  if (k > 30) {
    console.error(`refusing: the API never came up — ${error.message}`)
    process.exit(2)
  }
  await new Promise((r) => setTimeout(r, 1000))
}

async function member(key, { age = 'adult', admin = false } = {}) {
  const c = client()
  const email = `lab-${key}-${run}@example.test`
  const { data, error } = await c.auth.signUp({ email, password: `pw-${run}-${key}-x9` })
  if (error || !data.session)
    throw new Error(`sign-up for ${key} gave no session: ${error?.message}`)
  const id = data.user.id
  made.push(id)
  const name = `lab${key}${run}`.slice(0, 30)
  sql(`insert into public.player_registry (player_name) values ('${name}');
       insert into public.profiles (user_id, username, age_band) values ('${id}', '${name}', ${age ? `'${age}'` : 'null'});
       ${admin ? `insert into public.admin_users (user_id) values ('${id}');` : ''}`)
  return { c, id, name, token: data.session.access_token }
}
const befriend = (a, b) =>
  sql(`insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
       values (least('${a.id}'::uuid, '${b.id}'::uuid), greatest('${a.id}'::uuid, '${b.id}'::uuid), '${a.id}', 'accepted', now())`)
const row = (cat, id) => (Array.isArray(cat) ? cat.find((e) => e.id === id) : undefined)

try {
  const owner = await member('owner', { admin: true })
  const adult = await member('adult')
  const friend = await member('friend')
  const minor = await member('minor', { age: 'minor' })
  const unknown = await member('unknown', { age: null })
  const banned = await member('banned')
  befriend(minor, friend)
  ok(
    'every session was issued by Auth and is a real JWT',
    [owner, adult, friend, minor, unknown, banned].every((m) => m.token.split('.').length === 3),
  )

  /* ── a guest: the anon key, no session ── */
  const guest = client()
  const gc = await call(guest, 'lab_catalog')
  ok('a guest gets the catalog', Array.isArray(gc.data) && gc.data.length >= 51, gc.error)
  ok(
    'a guest gets flags and nothing counted',
    Array.isArray(gc.data) &&
      gc.data.every((e) => !('up' in e) && !('down' in e) && !('few' in e) && !('mine' in e)),
  )
  for (const [fn, args] of [
    ['lab_vote', { p_demo: 'swarm', p_value: 1 }],
    ['lab_comments_page', { p_demo: 'swarm' }],
    ['lab_comment_add', { p_demo: 'swarm', p_kind: 'idea', p_body: 'from a guest' }],
    ['admin_lab_reports', {}],
  ])
    ok(`a guest is refused ${fn}`, (await call(guest, fn, args)).error)
  ok(
    'a guest cannot read a lab table through the REST API',
    (await guest.from('lab_votes').select('*')).error,
  )

  /* ── the API itself refuses a token it did not issue ── */
  const forged = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${adult.token.slice(0, -4)}AAAA` } },
  })
  const fr = await call(forged, 'lab_vote', { p_demo: 'swarm', p_value: 1 })
  // PGRST301 is PostgREST's own refusal of a JWT it cannot verify — not any error at all
  ok('PostgREST rejects a token with a bad signature', fr.code === 'PGRST301', JSON.stringify(fr))

  /* ── members cannot reach the tables, only the functions ── */
  for (const t of ['lab_votes', 'lab_comments', 'lab_comment_reports', 'lab_demos']) {
    ok(`a member cannot select ${t}`, (await adult.c.from(t).select('*')).error)
    ok(
      `a member cannot delete from ${t}`,
      (await adult.c.from(t).delete().neq('demo_id', '')).error,
    )
  }
  ok(
    'a member cannot insert a vote directly',
    (await adult.c.from('lab_votes').insert({ user_id: adult.id, demo_id: 'swarm', value: 1 }))
      .error,
  )

  /* ── votes: everyone eligible counts, actual totals at once (no floor), nobody named ── */
  const zero = row((await call(unknown.c, 'lab_catalog')).data, 'fluid')
  ok(
    'an experiment nobody has voted on shows 0 and 0, not nothing',
    zero?.up === 0 && zero?.down === 0 && !('few' in zero),
    JSON.stringify(zero),
  )
  const v1 = await call(adult.c, 'lab_vote', { p_demo: 'life', p_value: 1 })
  ok(
    'a first vote answers with the voter’s own and the actual total: one',
    v1.data?.mine === 1 && v1.data?.up === 1 && v1.data?.down === 0 && !('few' in v1.data),
    JSON.stringify(v1),
  )
  const seenAtOnce = row((await call(friend.c, 'lab_catalog')).data, 'life')
  ok(
    'another member sees that single vote at once',
    seenAtOnce?.up === 1 && seenAtOnce?.down === 0 && !('mine' in seenAtOnce),
    JSON.stringify(seenAtOnce),
  )
  for (const m of [minor, unknown, friend])
    await call(m.c, 'lab_vote', { p_demo: 'life', p_value: 1 })
  const cat = row((await call(owner.c, 'lab_catalog')).data, 'life')
  ok(
    'the minor’s and the unknown age’s votes count: four in the total',
    cat?.up === 4 && cat?.down === 0,
    JSON.stringify(cat),
  )
  const mineMinor = row((await call(minor.c, 'lab_catalog')).data, 'life')
  ok(
    'the minor sees the same total, and their own vote',
    mineMinor?.up === 4 && mineMinor?.mine === 1,
    JSON.stringify(mineMinor),
  )
  for (const m of [adult, minor]) await call(m.c, 'lab_vote', { p_demo: 'fluid', p_value: -1 })
  const fFriend = row((await call(friend.c, 'lab_catalog')).data, 'fluid')
  ok(
    'two votes show as two, to somebody who cast neither',
    fFriend?.up === 0 && fFriend?.down === 2 && !('mine' in fFriend),
    JSON.stringify(fFriend),
  )
  const everything = JSON.stringify((await call(friend.c, 'lab_catalog')).data)
  ok(
    'the catalog names no voter',
    ![adult, minor, unknown, owner].some(
      (m) => everything.includes(m.id) || everything.includes(m.name),
    ),
  )
  // one vote per account per experiment, changed in place — and under a burst of calls
  await Promise.all(
    Array.from({ length: 12 }, (_, k) =>
      call(adult.c, 'lab_vote', { p_demo: 'swarm', p_value: k % 2 ? 1 : -1 }),
    ),
  )
  ok(
    'a burst of votes from one session leaves one row',
    sql(
      `select count(*) from public.lab_votes where user_id = '${adult.id}' and demo_id = 'swarm'`,
    ) === '1',
  )
  await call(adult.c, 'lab_vote', { p_demo: 'swarm', p_value: 0 })
  ok(
    'a vote taken back is gone',
    sql(
      `select count(*) from public.lab_votes where user_id = '${adult.id}' and demo_id = 'swarm'`,
    ) === '0',
  )

  /* ── notes: the ladder, and the admin has no standing access ── */
  const nAdult = (
    await call(adult.c, 'lab_comment_add', {
      p_demo: 'swarm',
      p_kind: 'idea',
      p_body: 'more colours please',
    })
  ).data
  const nMinor = (
    await call(minor.c, 'lab_comment_add', {
      p_demo: 'swarm',
      p_kind: 'more',
      p_body: 'a bigger swarm',
    })
  ).data
  const nUnknown = (
    await call(unknown.c, 'lab_comment_add', { p_demo: 'swarm', p_kind: 'bug', p_body: 'it froze' })
  ).data
  ok('notes were posted through the API', nAdult?.id && nMinor?.id && nUnknown?.id)
  const sees = async (m, n) =>
    !!(await call(m.c, 'lab_comments_page', { p_demo: 'swarm', p_limit: 30 })).data?.items?.some(
      (i) => i.id === n.id,
    )
  for (const [who, m, n, want] of [
    ['the adult', adult, nAdult, true],
    ['the friend', friend, nAdult, true],
    ['the minor', minor, nAdult, true],
    ['the admin', owner, nAdult, true],
    ['the minor', minor, nMinor, true],
    ['the minor’s friend', friend, nMinor, true],
    ['the adult', adult, nMinor, false],
    ['the admin', owner, nMinor, false],
    ['the unknown age', unknown, nUnknown, true],
    ['the adult', adult, nUnknown, false],
    ['the admin', owner, nUnknown, false],
  ])
    ok(
      `${who} ${want ? 'reads' : 'does not read'} ${n === nAdult ? 'the adult' : n === nMinor ? 'the minor' : 'the unknown age'}’s note`,
      (await sees(m, n)) === want,
    )

  /* ── edit and delete: one's own only ── */
  ok(
    'another member cannot edit a note',
    (await call(friend.c, 'lab_comment_edit', { p_id: nAdult.id, p_body: 'hijacked' })).error,
  )
  ok(
    'another member cannot delete a note',
    (await call(friend.c, 'lab_comment_delete', { p_id: nAdult.id })).error,
  )
  const ed = await call(adult.c, 'lab_comment_edit', {
    p_id: nAdult.id,
    p_body: 'more colours, please',
    p_kind: null,
  })
  ok(
    'the author edits their note',
    ed.data?.body === 'more colours, please' && ed.data?.edited,
    JSON.stringify(ed),
  )
  const tmp = (
    await call(adult.c, 'lab_comment_add', {
      p_demo: 'life',
      p_kind: 'idea',
      p_body: 'to be withdrawn',
    })
  ).data
  ok(
    'the author deletes their note',
    (await call(adult.c, 'lab_comment_delete', { p_id: tmp.id })).data === true,
  )
  ok(
    'limits hold through the API: a 501-character note is refused',
    (
      await call(adult.c, 'lab_comment_add', {
        p_demo: 'life',
        p_kind: 'idea',
        p_body: 'y'.repeat(501),
      })
    ).error,
  )

  /* ── reports and moderation ── */
  ok(
    'the admin cannot moderate an unreported note they cannot read',
    (await call(owner.c, 'admin_lab_moderate', { p_id: nUnknown.id, p_action: 'remove' })).error ===
      'no such note',
  )
  ok(
    'a member cannot report a note they cannot read',
    (await call(adult.c, 'lab_comment_report', { p_id: nMinor.id, p_reason: 'unkind' })).error ===
      'no such note',
  )
  ok(
    'the minor’s friend reports the minor’s note',
    (await call(friend.c, 'lab_comment_report', { p_id: nMinor.id, p_reason: 'unsafe' })).data ===
      'reported',
  )
  ok('a member cannot read the report queue', (await call(friend.c, 'admin_lab_reports', {})).error)
  const q = (await call(owner.c, 'admin_lab_reports', {})).data ?? []
  const queued = q.find((e) => e.id === nMinor.id)
  ok(
    'the reported note reaches the admin, through the queue only',
    queued?.body === 'a bigger swarm' && queued?.state === 'open' && !(await sees(owner, nMinor)),
    JSON.stringify(queued),
  )
  ok(
    'the queue holds nothing unreported',
    !q.some((e) => e.id === nUnknown.id || e.id === nAdult.id),
  )
  ok(
    'the queue never names a reporter',
    !JSON.stringify(q).includes(friend.id) && !JSON.stringify(q).includes(friend.name),
  )
  ok(
    'a member cannot moderate',
    (await call(friend.c, 'admin_lab_moderate', { p_id: nMinor.id, p_action: 'remove' })).error,
  )
  const rm = await call(owner.c, 'admin_lab_moderate', { p_id: nMinor.id, p_action: 'remove' })
  ok('the admin removes the reported note', rm.data?.removed === true, JSON.stringify(rm))
  ok('a removed note is gone for the friend', !(await sees(friend, nMinor)))
  const back = (
    await call(minor.c, 'lab_comments_page', { p_demo: 'swarm', p_limit: 30 })
  ).data?.items?.find((i) => i.id === nMinor.id)
  ok(
    'its author still sees it, marked removed',
    back?.removed === true && back?.body === 'a bigger swarm',
  )
  ok(
    'the admin can restore it from the queue',
    (await call(owner.c, 'admin_lab_moderate', { p_id: nMinor.id, p_action: 'restore' })).data
      ?.removed === false,
  )
  ok(
    'a member cannot feature or hide an experiment',
    (await call(adult.c, 'admin_lab_set_demo', { p_demo: 'swarm', p_featured: true })).error,
  )

  /* ── suspended ── */
  sql(`update public.profiles set suspended = true where user_id = '${banned.id}'`)
  const bv = await call(banned.c, 'lab_vote', { p_demo: 'swarm', p_value: 1 })
  ok('a suspended member cannot vote', bv.error === 'this account cannot post', JSON.stringify(bv))
  ok(
    'a suspended member cannot post',
    (
      await call(banned.c, 'lab_comment_add', {
        p_demo: 'swarm',
        p_kind: 'idea',
        p_body: 'still here',
      })
    ).error,
  )
} catch (e) {
  results.push({ name: 'the run finished', pass: false, detail: String(e?.message ?? e) })
} finally {
  if (made.length) {
    const ids = made.map((id) => `'${id}'`).join(',')
    sql(`delete from public.profiles where user_id in (${ids});
         delete from public.player_registry where player_name like 'lab%${run}';
         delete from public.admin_users where user_id in (${ids});
         delete from auth.users where id in (${ids});`)
  }
}

const failed = results.filter((r) => !r.pass)
for (const r of results)
  console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${!r.pass && r.detail ? ` — ${r.detail}` : ''}`)
console.log(
  `\n${results.length - failed.length} of ${results.length} hold through Supabase Auth + PostgREST`,
)
process.exit(failed.length ? 1 : 0)
