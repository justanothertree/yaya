/**
 * `lab-move`: the only way a Lab match by turns gets a game or a move.
 *
 * Step 3 of docs/2026-11-14-lab-async-matches-plan.md, deployed with `verify_jwt` on, on top of
 * the matches SQL (migration 20261115002456_lab_matches_and_results). Deploy it as it is in git,
 * this file and core.bundle.js, and then diff `get_edge_function` against both (CLAUDE.md §2).
 *
 * ⚠️ THE API NEVER ACCEPTS A BOARD, ONLY A MOVE. A member can read their match through
 * `lab_match_get` and decline, resign or claim through RPCs, but nothing they can call writes a
 * game. This function is the only caller of the three service-only writes (`lab_match_load`,
 * `lab_match_begin`, `lab_match_commit`), and it writes only what the toy's own rules made of the
 * stored game and the caller's move. So a result in `lab_results` is one the server played.
 *
 *   POST { op: 'accept', match }            the challenged friend starts the game
 *   POST { op: 'move', match, at, move }    a move against the board at seq `at`
 *
 * Both answer with the match as `lab_match_get` shows it, or `{ error }` with a status.
 *
 * ⚠️ WHO IS ASKING is settled by Supabase Auth, from the caller's own token, before anything is
 * read. The service key is then used for the reads and writes, because the writes are
 * service-only by design. Every rule that needs the database (friends, suspension, the timeout,
 * two moves racing for one board, sixty moves a minute) is checked again inside those SQL
 * functions, atomically, so this file refusing early is a courtesy that names the problem. It is
 * not the lock.
 *
 * What it decides is in core.ts, which vitest asks; it arrives here as core.bundle.js (see that
 * file's header for why a bundle).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { decide, readAsk } from './core.bundle.js'

/* the same origins `pictures` allows, for the same reasons (see its notes) */
const ALLOWED = [
  'https://evancook.dev',
  'https://www.evancook.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

/* ⚠️ ECHOED, NOT LISTED: supabase-js sends `apikey` and `x-client-info` as well, and a preflight
   missing any one of them fails before the POST is sent. `pictures` learned this the hard way. */
const corsFor = (origin: string | null, asked?: string | null): Record<string, string> => ({
  'Access-Control-Allow-Origin': origin && ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'Access-Control-Allow-Headers': asked || 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '3600',
  Vary: 'Origin, Access-Control-Request-Headers',
})

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsFor(origin) },
  })

/** a request body bigger than this is not a move: the largest is a chess move and a uuid */
const MAX_BODY = 2048

/**
 * The SQL functions raise with a SQLSTATE and a sentence written for the player. These are the
 * codes they use; anything else is a fault, logged here and reported plainly.
 */
const STATUS_FOR: Record<string, number> = {
  P0002: 404, // no such match
  '28000': 401, // sign in first
  '42501': 403, // not yours to do, or suspended, or no longer friends
  '22023': 409, // the match is not in a state that allows it
  '40001': 409, // the board moved on: two moves raced and the other one landed
  '54000': 429, // sixty moves a minute
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsFor(origin, req.headers.get('Access-Control-Request-Headers')),
    })
  }
  if (req.method !== 'POST') return json({ error: 'post a move' }, 405, origin)

  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'not authenticated' }, 401, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  /* ⚠️ A HEADER IS NOT A PERSON: the publishable key is a valid Authorization value too. Ask Auth
     who the token belongs to, and refuse anything that is not a signed-in member. */
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: who, error: whoErr } = await asCaller.auth.getUser()
  const me = who?.user?.id
  if (whoErr || !me) return json({ error: 'not authenticated' }, 401, origin)

  const text = await req.text()
  if (text.length > MAX_BODY) return json({ error: 'that is not a move' }, 413, origin)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'that was not json' }, 400, origin)
  }
  const asked = readAsk(body)
  if (!asked) return json({ error: 'say accept, move or mine, and which match' }, 400, origin)

  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const fail = (e: { code?: string; message?: string }) => {
    const status = (e.code && STATUS_FOR[e.code]) || 500
    if (status === 500) console.error('lab-move:', e.code, e.message)
    return json(
      { error: status === 500 ? 'the move could not be saved' : e.message },
      status,
      origin,
    )
  }

  const { data: row, error: loadErr } = await service.rpc('lab_match_load', {
    p_match: asked.match,
  })
  if (loadErr) return fail(loadErr)

  const plan = decide(row ?? null, me, asked.ask)
  if (plan.kind === 'refuse') {
    if (plan.status >= 500) console.error('lab-move:', asked.match, plan.error)
    return json({ error: plan.error }, plan.status, origin)
  }
  // a player's own side of what the toy keeps hidden: read, never written
  if (plan.kind === 'mine') return json({ mine: plan.data }, 200, origin)
  const { data, error } =
    plan.kind === 'begin'
      ? await service.rpc('lab_match_begin', {
          p_match: asked.match,
          p_by: me,
          p_state: plan.state,
          p_turn: plan.turn,
          p_secret: plan.secret ?? null,
        })
      : await service.rpc('lab_match_commit', {
          p_match: asked.match,
          p_at_seq: plan.at,
          p_by: me,
          p_move: plan.move,
          p_state: plan.state,
          p_turn: plan.turn,
          p_result: plan.result,
          p_secret: plan.secret ?? null,
        })
  if (error) return fail(error)
  return json(data, 200, origin)
})
