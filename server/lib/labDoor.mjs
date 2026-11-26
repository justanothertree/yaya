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
 * `vouched` counts SOCKETS, not people: a second tab is a second socket, and the relay's cost is
 * per socket. `rooms` counts only rooms two different people have been let into — see
 * liveRoomsFull.
 *
 * ⚠️ AND NOTHING COUNTS THE SOCKETS AT A TABLE THAT HAVE NOT BEEN LET IN. There was a cap of
 * sixteen, and a knock at sixteen pushed out whichever had said nothing longest — which is only
 * longest among the silent, so a stranger who kept a table at sixteen could answer an arrival with
 * fifteen hellos and push out the friend between their welcome and their auth, every time, and
 * could count everybody at the table by knocking. And it bounded nothing the relay pays for: a
 * code costs nothing to mint, so those sockets go to another table. A socket that never signs in
 * is bounded by the silent-socket timer, which nothing restarts (helloAgain), and by the relay's
 * connection gate; the one count at a table is the door's eight.
 *
 * ⚠️ AND SOME OF THEM ARE PER PERSON, because the relay-wide ones are shared by everybody and a
 * limit one account can fill is a limit that account can take from everybody else. `tables` and
 * `tabs` are how many tables and sockets one account may be let into at once, across the relay
 * (a tab moving tables, and a phone beside a laptop, with room to spare); `personHz` is that
 * account's share of `globalHz`, whatever it sends from — a person plays one seat, so their tabs
 * together send what one client does. See placesFull and charge.
 */
export const LAB = Object.freeze({
  vouchMs: 12_000,
  doorMs: 40_000,
  vouched: 8,
  rooms: 6,
  tables: 2,
  tabs: 4,
  bytes: 4096,
  socketHz: 50,
  personHz: 50,
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
 * A hello, from a socket that has said hello to the Lab table `table` (null if it never has) and
 * that is in some other room now if `inRoom`: null if the hello may go ahead, 'same' if it names
 * that table again (nothing to do), and otherwise the refusal `one-table`.
 *
 * ⚠️ A SOCKET THAT KNOCKS ON A LAB TABLE BELONGS TO THAT TABLE FOR LIFE. The silent-socket timer
 * starts at the hello, and a hello is how a socket moves — so while a socket could go somewhere
 * else and come back, every return started the clock again, and one that never said who it was
 * could hold its place for as long as it kept hopping. A client opens a link per table visit, so
 * an honest one never sends a second hello and loses nothing. `table` is whatever id the socket
 * first knocked with, well-formed or not: a refusal closes the socket, and nothing it says while
 * the close completes may put it in a room.
 *
 * ⚠️ AND A LAB TABLE IS A SOCKET'S FIRST ROOM AS WELL AS ITS ONLY ONE. A socket that has been in a
 * park, a bout or a Snake room carries that room's state on the connection: the park's
 * members-only timer, which went on to tell a socket the Lab had let in that it was refused, and
 * the socket's one auth slot, which a park check still on its way took from the Lab's — so a good
 * token was dropped unasked and closed as silent. Every such thing is per connection, and a Lab
 * room cannot know them all, so it takes no socket that has been anywhere. Moving between rooms
 * that are not Lab tables is none of this door's business.
 */
export function helloAgain(table, want, inRoom = false) {
  if (table === null || table === undefined) return inRoom && looksLab(want) ? 'one-table' : null
  return want === table ? 'same' : 'one-table'
}

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
 * Forget every window in `windows` (key -> times) that holds nothing from the last second, and
 * keep every one that does.
 *
 * ⚠️ A WINDOW GOES WHEN IT IS SPENT, NEVER WHEN ITS OWNER DOES. An account's window used to be
 * forgotten with the account's last socket, which is exactly when it is still full: fifty frames,
 * a close, a new socket — let in at once, since its token, standing and friendships are all
 * remembered — and fifty more inside the same second, so the account's share was the room's. A
 * window that holds nothing is the same as no window, so forgetting that one changes nothing.
 */
export function forgetSpent(windows, now) {
  for (const [key, times] of windows) if (!rate(times, now, 1).times.length) windows.delete(key)
}

/**
 * Whether a frame from `uid`, to sockets let in as `uids` (one per socket), reaches anybody but
 * `uid` — the only kind a Lab room forwards, or charges to any window.
 *
 * ⚠️ ONE PERSON'S TABS ARE NO AUDIENCE, as they are no game (isLive). A frame that reached only the
 * sender's own other tab still reached SOMEBODY, so it was charged to the relay's window, and
 * three members each alone at a table with two tabs spent all of it between their own tabs while
 * a real table's moves were dropped. A frame that does reach somebody else still goes to the
 * sender's other tabs too.
 */
export const reachesAnother = (uid, uids) => uids.some((u) => u !== uid)

/**
 * Every window a frame must fit, at once: `windows` is `[times, perSec]` pairs, and the answer is
 * whether it fits all of them and each window's times afterwards — with `now` added to every one
 * if it fits, and to none if it does not (see rate). The relay and the stub both charge through
 * here, so neither can forget a window or push into one a refused frame never used.
 */
export function charge(windows, now) {
  const kept = windows.map(([times, perSec]) => rate(times, now, perSec))
  const ok = kept.every((k) => k.ok)
  return { ok, times: kept.map((k) => (ok ? [...k.times, now] : k.times)) }
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

/** Whether a room is live: two or more different accounts let in. One person's tabs are no game. */
export const isLive = (uids) => new Set(uids).size >= 2

/**
 * Whether letting `uid` into a room whose let-in accounts are `here` would open or make live a
 * room while the relay already holds as many live rooms as it will. `elsewhere` is the let-in
 * accounts of every OTHER Lab room, one list per room.
 *
 * ⚠️ ONLY ROOMS TWO PEOPLE HAVE BEEN LET INTO COUNT. A room exists from its first hello, before
 * anybody is checked — so counting every room would let anyone who can open sockets fill the cap
 * with codes nobody was sent. And counting every room with ANYBODY let in had the same hole one
 * step further in: a lone member has nobody to be checked against, so the friends question is
 * trivially yes, and one account with six empty tables told every friend on the relay that the
 * server was full. A lone room costs the relay a socket, so it costs this cap nothing.
 *
 * Asked when a room opens as well as when it becomes live, so the first friend at a table learns
 * the relay is full before the others arrive to be told it. A room already live is never refused
 * by this, and nor is another tab of the one person a lone room holds.
 */
export function liveRoomsFull(elsewhere, here, uid) {
  if (isLive(here) || here.includes(uid)) return false
  let live = 0
  for (const uids of elsewhere) if (isLive(uids)) live++
  return live >= LAB.rooms
}

/**
 * Whether `uid` already holds as many places as one account may: LAB.tabs sockets let in across
 * the relay, or — for a table they are not already at — LAB.tables tables. `here` and
 * `elsewhere` are as in liveRoomsFull.
 *
 * ⚠️ PER ACCOUNT, BECAUSE EVERY OTHER LIMIT HERE IS SHARED. A table's eight and the relay's six
 * are counted in sockets and rooms, and an account that can open sockets can fill both: eight
 * tabs of one person filled a table, and one person alone at six tables filled the relay. An
 * account is the one thing here that a stranger cannot make more of by opening another socket.
 */
export function placesFull(uid, elsewhere, here) {
  let tabs = here.filter((u) => u === uid).length
  let tables = 0
  for (const uids of elsewhere) {
    const mine = uids.filter((u) => u === uid).length
    if (mine) tables++
    tabs += mine
  }
  if (tabs >= LAB.tabs) return true
  return !here.includes(uid) && tables >= LAB.tables
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
  'one-table': 'Each table needs a link of its own.',
  'too-many-places': 'You are connected to the game server in too many places already.',
})

/**
 * One room's door: the friends check for an arrival whose token and standing are already good,
 * run one arrival at a time.
 *
 *   check({ uid, vouched, elsewhere, ask, gone, enter }) -> 'admit' | a refusal | null (gone)
 *
 * - `vouched()` the account ids of the sockets let in, one per socket (a second tab twice)
 * - `elsewhere()` the same for every OTHER Lab room on the relay, one list per room (for
 *   liveRoomsFull and placesFull)
 * - `ask(u)` the friends answer for (uid, u)
 * - `gone()` whether the arrival has left, been refused or timed out meanwhile
 * - `enter()` lets them in; called in the same turn as the last read of the room, so nothing can
 *   come between "everyone here is a friend" and "and now so are you"
 *
 * The limits are asked twice: before any question, because a round trip saved is worth having
 * and an arrival with no room has no question worth asking; and again at the end, because the
 * answers took time and other rooms' doors do not queue behind this one's.
 *
 * ⚠️ ONE AT A TIME, PER ROOM. Two arrivals checked side by side are each checked against a room
 * without the other; one after the other, the second is checked against a room the first is in.
 * The relay and the stub both come through here, so neither can forget the chain.
 */
export function doorFor() {
  const queue = serial()
  return {
    check: ({ uid, vouched, elsewhere, ask, gone = () => false, enter }) =>
      queue.run(async () => {
        if (gone()) return null
        const limits = () => {
          const here = vouched()
          if (here.length >= LAB.vouched) return 'lab-full'
          const others = elsewhere()
          if (placesFull(uid, others, here)) return 'too-many-places'
          if (liveRoomsFull(others, here, uid)) return 'lab-busy'
          return null
        }
        const early = limits()
        if (early) return early
        const friends = await friendsAt(uid, vouched, ask)
        if (gone()) return null
        const verdict = verdictOf({ token: 'yes', standing: 'yes', friends })
        if (verdict !== 'admit') return verdict
        const late = limits()
        if (late) return late
        enter()
        return 'admit'
      }),
  }
}
