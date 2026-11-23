/**
 * Every decision the relay makes about a Lab table room, and nothing else.
 *
 * A Lab table is friends on a call playing one game together. Who sits where lives on the call;
 * the game's own messages go over the relay, in a room whose id is a random code only the people
 * on that call were sent. This file is the door of that room: who may stand in it, what they may
 * say, how fast, and what anyone else hears about it — which is nothing.
 *
 * ⚠️ PURE, SO IT CAN BE ASKED. ws-server.js opens a socket at import, and a rule that lives there
 * can only be checked through a running process. Everything here takes its inputs as arguments —
 * the friends question included, as an injected `ask` — so server/lib/labDoor.test.mjs asks each
 * rule directly, and scripts/park-stub-relay.mjs imports this same file rather than keeping a copy:
 * a second copy of a door is a second door, and the first one to drift is the one tested.
 *
 * ⚠️ THREE QUESTIONS, ASKED IN ORDER, EACH ANSWERED 'yes' | 'no' | 'unsure' (supabaseAnswer.mjs):
 * is the token good, is the account in good standing, and is the joiner a friend of every person
 * already let in. Only a DEFINITE no from the friends question may become `not-friends`. Anything
 * Supabase could not answer is `door-unavailable`, because the one sentence this door must never
 * say is "you are not friends" to two people who are.
 */

/**
 * The limits. Sized for eight friends on one call, and against what one honest client sends:
 * the client's own outbox stays under forty a second, so fifty per socket is a ceiling a real
 * table never meets and a console does.
 *
 * `vouched` and `sockets` count SOCKETS, not people: a second tab is a second socket, and the
 * relay's cost is per socket. `rooms` counts only rooms somebody has been let into — see
 * liveRoomsFull.
 */
export const LAB = Object.freeze({
  vouchMs: 12_000,
  doorMs: 40_000,
  vouched: 8,
  sockets: 16,
  rooms: 6,
  bytes: 4096,
  socketHz: 50,
  roomHz: 100,
  globalHz: 150,
  friendTtl: 60_000,
  friendMax: 200,
})

/** A Lab table id: `lab:` and 22 base64url characters, which is 16 random bytes and nothing else. */
export const isLabId = (id) => typeof id === 'string' && /^lab:[A-Za-z0-9_-]{22}$/.test(id)

/**
 * Whether an id is MEANT as a Lab table, well-formed or not.
 *
 * ⚠️ A MALFORMED ONE IS REFUSED, NEVER A SNAKE ROOM. The relay's rule for an id it has no special
 * case for is "Snake, and listed in the lobby" — so without this, `lab:` plus a typo would become
 * a public Snake room carrying the code's prefix, in the one list anybody can read.
 */
export const looksLab = (id) => typeof id === 'string' && id.startsWith('lab:')

/** Whether a room may appear in `list`. A Lab table is found by being told, never by browsing. */
export const listable = (id) => !looksLab(id)

/**
 * The only frames a Lab room accepts from a client. Everything else — Snake's chat, a name, a
 * preview, the park's walk — is dropped before the relay's switch ever sees it, because every one
 * of those handlers broadcasts to the whole room without asking who has been let in.
 */
export const kindAllowed = (type) => type === 'auth' || type === 'lab'

/**
 * A `lab` frame, read: `{d, to}` or null.
 *
 * `d` is the game's message, opaque to the relay, a non-empty string of at most LAB.bytes UTF-8
 * BYTES. `to`, when present, must be the account id of somebody let into this room, and the frame
 * then goes to that person's sockets only.
 *
 * ⚠️ MEASURED IN BYTES, NOT `.length`. `.length` counts UTF-16 code units, so a string of emoji
 * is half as long as it is heavy — a ceiling measured that way lets twice the bytes through.
 *
 * ⚠️ A `to` NAMING NOBODY HERE REFUSES THE WHOLE FRAME rather than sending it to everybody. A
 * private message whose address is wrong must not become a public one.
 */
export function readLab(msg, vouchedUids) {
  if (!msg || typeof msg !== 'object') return null
  const d = msg.d
  if (typeof d !== 'string' || !d) return null
  if (Buffer.byteLength(d, 'utf8') > LAB.bytes) return null
  const to = msg.to
  if (to === undefined || to === null) return { d, to: null }
  if (typeof to !== 'string' || !to) return null
  const here = vouchedUids instanceof Set ? vouchedUids : new Set(vouchedUids)
  return here.has(to) ? { d, to } : null
}

/**
 * A sliding one-second window: the times still inside it, and whether one more fits.
 *
 * ⚠️ THE CALLER PUSHES `now` ONLY IF IT SENDS. A message refused by one window (the room's, say)
 * must not use up a place in the others, or a busy room would quietly throttle a quiet sender.
 */
export function rate(times, now, perSec) {
  const kept = times.filter((t) => now - t < 1000)
  return { ok: kept.length < perSec, times: kept }
}

/**
 * The door's answer, from the three questions in order. Any question not yet asked is left out,
 * and the answer is then null: nothing has failed, and the next question is due.
 *
 * ⚠️ A SUSPENDED ACCOUNT IS TOLD `members-only`, NEVER "suspended". The standing check exists so a
 * suspended account cannot get in, not so the relay can announce a suspension to whoever holds
 * the code.
 *
 * ⚠️ 'unsure' IS NEVER A REFUSAL OF THE PERSON. A friends question Supabase did not answer — a
 * 5xx, a timeout, a NULL from `are_friends`, no config — is `door-unavailable`, which the client
 * retries, and which says the problem is the server's.
 */
export function verdictOf({ token, standing, friends } = {}) {
  for (const [answer, no] of [
    [token, 'members-only'],
    [standing, 'members-only'],
    [friends, 'not-friends'],
  ]) {
    if (answer === undefined || answer === null) return null
    if (answer === 'no') return no
    if (answer !== 'yes') return 'door-unavailable'
  }
  return 'admit'
}

/**
 * A promise chain: `run(fn)` starts fn when everything queued before it has settled, and returns
 * fn's own promise. A failure ends only the fn that failed; the chain goes on.
 */
export function serial() {
  let tail = Promise.resolve()
  return {
    run(fn) {
      const p = tail.then(() => fn())
      tail = p.then(
        () => undefined,
        () => undefined,
      )
      return p
    },
  }
}

/**
 * Whom a joiner must be friends with: everybody let in, once each, except themselves.
 *
 * ⚠️ NOT THEMSELVES, because `are_friends(me, me)` is false — friendship is a row between two
 * accounts — and somebody's second tab would otherwise be refused from their own table.
 */
export function pairsToAsk(joinerUid, vouched) {
  return [...new Set(vouched)].filter((u) => u !== joinerUid)
}

/**
 * The friends answer against the room AS IT STANDS NOW: 'yes' | 'no' | 'unsure', or null when
 * somebody in `after` has not been asked about yet.
 *
 * Somebody who left while the answers were on their way is no longer anybody's business, so an
 * answer about them is ignored. A definite no from anyone present outweighs an unsure about
 * anyone else: that person really is here, and really is not a friend.
 */
export function admitAfter(joinerUid, after, answers) {
  let unsure = false
  for (const u of pairsToAsk(joinerUid, after)) {
    if (!answers.has(u)) return null
    const a = answers.get(u)
    if (a === 'no') return 'no'
    if (a !== 'yes') unsure = true
  }
  return unsure ? 'unsure' : 'yes'
}

/**
 * Ask `ask(u)` about every person let in, in parallel, and then about anybody let in while those
 * answers were on their way — until the room holds nobody unasked. `vouched()` reads the room.
 *
 * ⚠️ THE ROOM IS READ WHEN THE ANSWERS ARRIVE, NOT WHEN THE QUESTION WAS ASKED. "A friend of
 * everyone already in" read at arrival would let two strangers who arrive together both in, each
 * checked against a room the other was not yet in. The serial chain below means nobody else can
 * be let in meanwhile; this re-reading is the second lock on the same door, and its own test
 * shows it holding without the first.
 */
export async function friendsAt(joinerUid, vouched, ask) {
  const answers = new Map()
  /* bounded: the room can only grow by LAB.vouched people, so this asks at most that many times */
  for (let round = 0; round <= LAB.vouched; round++) {
    const now = vouched()
    const verdict = admitAfter(joinerUid, now, answers)
    if (verdict !== null) return verdict
    const need = pairsToAsk(joinerUid, now).filter((u) => !answers.has(u))
    const got = await Promise.all(need.map((u) => Promise.resolve(ask(u)).catch(() => 'unsure')))
    need.forEach((u, i) => answers.set(u, got[i]))
  }
  return 'unsure'
}

/**
 * Whether the relay already has as many LIVE Lab rooms as it will hold, so that this one may not
 * become another. `counts` is how many sockets are let into each Lab room; `mine` is this room's.
 *
 * ⚠️ ONLY ROOMS SOMEBODY HAS BEEN LET INTO COUNT. A room exists from its first hello, before
 * anybody is checked — so counting every room would let anyone who can open sockets fill the cap
 * with codes nobody was sent, and friends would be told the server is full. A room already live
 * is never refused by this: its people are let in or not by the room's own limits.
 */
export function liveRoomsFull(counts, mine) {
  if (mine > 0) return false
  let live = 0
  for (const n of counts) if (n > 0) live++
  return live >= LAB.rooms
}

/**
 * Whether the silent-socket timer may close this socket: only if it never sent `auth` at all.
 *
 * ⚠️ A SOCKET WHOSE CHECK IS RUNNING, OR QUEUED BEHIND SOMEBODY ELSE'S, IS NOT SILENT. Supabase
 * can be slow, and the room's checks run one at a time — so a friend can still be waiting when the
 * timer fires, and closing them then would turn a slow answer into a refusal. Their check has its
 * own deadline (LAB.doorMs), which ends in `door-unavailable` rather than in silence.
 */
export const vouchTimerCloses = (state) => !state?.sentAuth

/** All a socket hears on arriving: its own id. Nothing about the room, and nothing to anyone else. */
export const helloFrames = (id) => [{ type: 'welcome', id }]

/** What the room hears when a socket goes: only if it had been let in, and only by those let in. */
export const leaveFrames = (from, wasVouched) => (wasVouched ? [{ type: 'lab-gone', from }] : [])

/** The door's sentences. The client words its own; these are what a raw socket reads. */
export const SAY = Object.freeze({
  'members-only': 'A Lab table is for friends on a call, signed in on the site.',
  'not-friends': 'Somebody at this table is not your friend on the site.',
  'door-unavailable': 'Could not check who is at this table just now.',
  'lab-full': 'This table already has eight people connected.',
  'lab-busy': 'The game server is full right now.',
  'bad-room': 'That is not a Lab table.',
})

/**
 * One room's door: the friends check for an arrival whose token and standing are already good,
 * run one arrival at a time.
 *
 *   check({ uid, vouched, ask, counts, gone, enter }) -> 'admit' | a refusal | null (gone)
 *
 * - `vouched()` the account ids of the sockets let in, one per socket (a second tab twice)
 * - `ask(u)` the friends answer for (uid, u)
 * - `counts()` let-in sockets per Lab room on the relay, this one included (for liveRoomsFull)
 * - `gone()` whether the arrival has left, been refused or timed out meanwhile
 * - `enter()` lets them in; called in the same turn as the last read of the room, so nothing can
 *   come between "everyone here is a friend" and "and now so are you"
 *
 * ⚠️ ONE AT A TIME, PER ROOM. Two arrivals checked side by side are each checked against a room
 * without the other; one after the other, the second is checked against a room the first is in.
 * The relay and the stub both come through here, so neither can forget the chain.
 */
export function doorFor() {
  const queue = serial()
  return {
    check: ({ uid, vouched, ask, counts, gone = () => false, enter }) =>
      queue.run(async () => {
        if (gone()) return null
        /* full is full before anybody is asked anything, and asking costs a round trip each */
        if (vouched().length >= LAB.vouched) return 'lab-full'
        const friends = await friendsAt(uid, vouched, ask)
        if (gone()) return null
        const verdict = verdictOf({ token: 'yes', standing: 'yes', friends })
        if (verdict !== 'admit') return verdict
        const here = vouched().length
        if (here >= LAB.vouched) return 'lab-full'
        if (liveRoomsFull(counts(), here)) return 'lab-busy'
        enter()
        return 'admit'
      }),
  }
}
