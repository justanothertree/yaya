/**
 * Every sentence a live table says (chairs.ts, and the game-server link and the rounds that the
 * next steps add), as pure functions of names and what this browser knows — so liveWords.test.ts
 * can read each one back without a call or a page, and the table (step 6) only lays them out. The
 * wording is the live-tables build plan's, its §1.1 and §1.2, word for word where it gives one;
 * docs/2026-11-23-lab-live-tables.md (step 4) records where this file departs from it, and why.
 * Spades' own sentences (§1.3) and each game's (§1.4–§1.7) come with their games.
 *
 * `{Name}` is a person's name from this browser's call roster, already cut to 40 characters and
 * kept after they go, or "a friend" when this browser never had one. `{toy}` is the toy's name as
 * the Lab shows it.
 *
 * ⚠️ "A FRIEND", NOT busWords' "A FRIEND WHO LEFT". On the bus a name this browser never had is
 * somebody who left before it arrived. At a table it can also be somebody whose `where` has not
 * reached me yet, named in a state that has: the host seated them from its own roster. "A friend"
 * is true either way, and everybody at a table is one (the call's gate, then the relay's door).
 *
 * ⚠️ NOBODY'S PRONOUNS ARE KNOWN HERE. The plan wrote "His rider rides straight on" and "until
 * he's back" about Bo; this file says "their" and "they're" for everybody, which is right whoever
 * Bo is.
 *
 * ⚠️ A COUNT SAYS SOMETHING AT ZERO. Every sentence with a number in it is tested at 0, 1 and 2,
 * because a figure that hides itself at zero is a line nobody notices is missing: "Nobody
 * watching" rather than no line, and a countdown that reaches 0 says what is happening now.
 */

/** what this browser knows that the words read */
export type View = {
  me: string
  /** a person's name from this browser's roster (cut to 40, kept after they go), or null */
  name: (id: string) => string | null
}

/* ── the small words ───────────────────────────────────────────────────────────────────────── */

const A_FRIEND = 'a friend'
/** somebody by name, in the middle of a sentence */
const nameOf = (v: View, id: string) => v.name(id) ?? A_FRIEND
/** somebody at the start of one: "A friend", but a name exactly as its owner wrote it */
const lead = (v: View, id: string) => v.name(id) ?? 'A friend'
/** whole seconds as m:ss — "0:12", "1:09" */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/* ── §1.1 where it sits ────────────────────────────────────────────────────────────────────── */

export const HEADING = 'Play together'
/** under the chairs: everybody on the toy who is not sitting */
export const watchingWords = (n: number) => (n === 0 ? 'Nobody watching' : `${n} watching`)

/* ── §1.2 step 1: the table, and the game server waking ────────────────────────────────────── */

export const OPEN_LINE =
  'Friends on this call can play here together. Take a chair to play; anyone else watches.'
export const EMPTY_CHAIR = 'Empty'
export const SIT = 'Sit'
/** the link line for its first 3 s */
export const CONNECTING = 'Connecting to the game server…'
/** the link line from 3 s, counting up the time since it started */
export const wakingWords = (ms: number) =>
  `Waking the game server — up to a minute on the free plan. ${clock(Math.max(0, Math.floor(ms / 1000)))}`
/** said once, when the count starts */
export const WAKING_SAID = 'Waking the game server. This can take up to a minute.'
/** said once, and then the link line hides */
export const CONNECTED = 'Connected to the game server.'
/** at 70 s, with TRY_AGAIN and ON_YOUR_OWN */
export const UNREACHABLE = "Couldn't reach the game server."
export const TRY_AGAIN = 'Try again'
export const ON_YOUR_OWN = 'Play on your own'

/* ── step 2: sitting down, and who sets the table ──────────────────────────────────────────── */

/**
 * A person's chair: ● once they are in the game server's room, ◌ until then (and if they drop).
 * The mark is apart from the name so the table can hide it from a screen reader, which would read
 * "black circle"; `sr` is what it hears instead.
 */
export const chairName = (v: View, id: string, linked: boolean) => ({
  name: lead(v, id),
  mark: linked ? '●' : '◌',
  sr: linked ? '' : 'connecting',
})
/** said when somebody becomes captain by sitting at an empty table */
export const captainWords = (v: View, id: string) =>
  id === v.me
    ? 'You set this table: you choose the mode and the teams, and you start.'
    : `${lead(v, id)} set this table.`
/* the captain's controls */
export const VERSUS = '⚔️ Versus'
export const TOGETHER = '🤝 Together'
export const ADD_COMPUTER = '+ 🤖 Computer'
export const MOVE = 'Move…'
export const START = '▶ Start'

/* ── step 4: starting ──────────────────────────────────────────────────────────────────────── */

/** under ▶ Start, while somebody seated is not in the game server's room */
export const waitingWords = (v: View, id: string) =>
  id === v.me ? 'Waiting for you to connect…' : `Waiting for ${nameOf(v, id)} to connect…`
/* the toys' own reasons (each toy's canStart) */
export const needsWellsWords = (toy: string) =>
  `${toy} needs two wells: take a chair, or add a computer.`
export const needsCrewWords = (toy: string) => `${toy} needs a pilot and a keeper.`
export const needsTwoWords = (toy: string) => `${toy} needs two players.`
/**
 * The countdown on the line, from the referee's `go`: the digits are `aria-hidden`, because the
 * status region says it once (startingSaid) and a screen reader must not count along
 */
export const startingLine = (s: number) =>
  s >= 1
    ? { before: 'Starting in ', digits: `${s}`, after: '…' }
    : { before: 'Starting…', digits: '', after: '' }
/** said once, as the countdown starts */
export const startingSaid = (s: number) =>
  s <= 0 ? 'Starting now.' : `Starting in ${s} ${s === 1 ? 'second' : 'seconds'}.`

/* ── step 5: the captain goes ──────────────────────────────────────────────────────────────── */

/**
 * Said when the captain leaves (the toy or the call) or stands, and somebody else sat next. With
 * nobody seated there is no captain, and nothing is said: the table's line is OPEN_LINE again.
 */
export function captainGoneWords(
  v: View,
  was: string,
  how: 'left' | 'stood',
  next: string | null,
): string | null {
  if (next === null) return null
  const who = was === v.me ? 'You' : lead(v, was)
  const did = how === 'stood' ? 'stood up' : 'left'
  return next === v.me
    ? `${who} ${did}, so you set the table now.`
    : `${who} ${did}, so ${nameOf(v, next)} sets the table now.`
}

/* ── step 6: watching ──────────────────────────────────────────────────────────────────────── */

export const WATCHING_LINE = "You're watching. Take an empty chair, or a computer's, to play."
export const COMPUTER = '🤖 Computer'
export const TAKE_OVER = 'Take over'
/**
 * A computer's chair: anybody may sit there between rounds; mid-round, only where the toy lets a
 * watcher take a computer's cards over (Spades), and otherwise from the next round
 */
export const computerChair = (on: boolean, takeMidRound: boolean) =>
  !on
    ? { text: COMPUTER, button: SIT }
    : takeMidRound
      ? { text: COMPUTER, button: TAKE_OVER }
      : { text: `${COMPUTER} · next round`, button: null }

/* ── step 7: the captain moves people ──────────────────────────────────────────────────────── */

export const CHOOSE_WHO = 'Choose who to move'
/**
 * A chair's button once somebody is chosen: "Move Bo here" on its face, and named for the chair it
 * is when the chair has a name of its own (`label`, "North"), for a screen reader
 */
export function moveToWords(v: View, id: string, label: string | null) {
  const who = id === v.me ? 'yourself' : nameOf(v, id)
  return { text: `Move ${who} here`, named: label ? `Move ${who} to ${label}` : null }
}
/** said to everyone once it is done */
export function movedWords(v: View, by: string, id: string, label: string | null): string {
  const who = by === v.me ? 'You' : lead(v, by)
  const where = label ? `to ${label}` : 'to another chair'
  if (id === by) return `${who} moved ${where}.`
  return `${who} moved ${id === v.me ? 'you' : nameOf(v, id)} ${where}.`
}

/* ── step 8: somebody drops mid-round, by toy ──────────────────────────────────────────────── */

export const trailsDroppedWords = (v: View, id: string) =>
  `${lead(v, id)} dropped. Their rider rides straight on.`
export const stackDroppedWords = (v: View, id: string) =>
  `${lead(v, id)} dropped. Their well is paused for 30 s.`
export const stackToppedWords = (v: View, id: string) =>
  `${lead(v, id)}'s well counts as topped out.`
export const hockeyDroppedWords = (v: View, id: string) =>
  `${lead(v, id)} dropped. The game is paused for 20 s.`
export const hockeyStandInWords = (v: View, id: string) =>
  `A computer is playing for ${nameOf(v, id)} until the game ends.`
export const crossingDroppedWords = (v: View, id: string) =>
  `${lead(v, id)} dropped. The crossing waits 30 s for them.`
export const crossingEndedWords = (v: View, id: string) =>
  `${lead(v, id)} didn't come back, so the crossing ended.`
/** Spades: counting down the minute before the computer takes the chair, rounded up */
export function spadesWaitWords(v: View, id: string, ms: number): string {
  const s = Math.ceil(ms / 1000)
  return s <= 0
    ? `Waiting for ${nameOf(v, id)}. The computer is taking their chair.`
    : `Waiting for ${nameOf(v, id)}. The computer takes their chair in ${clock(s)}.`
}
export const spadesStandInWords = (v: View, id: string) =>
  `The computer is playing for ${nameOf(v, id)} until they're back.`
/** said when somebody who dropped is back within the round */
export const backWords = (v: View, id: string) => `${lead(v, id)} is back.`

/* ── step 9: the referee ───────────────────────────────────────────────────────────────────── */

/** said only when the referee changes */
export const refereeWords = (v: View, id: string) =>
  id === v.me ? "You're running the game now." : `${lead(v, id)} is running the game now.`
/** the table's footer, in small type */
export const refereeFooter = (v: View, id: string) =>
  id === v.me ? 'Your browser runs this game.' : `${lead(v, id)}'s browser runs this game.`
/** Spades' footer: the relay deals (Evan, 26 Nov 2026: option B) */
export const SERVER_DEALING = 'The game server is dealing.'

/* ── step 10: the game server drops ────────────────────────────────────────────────────────── */

export const LOST = 'Lost the game server — reconnecting…'
export const BACK_ON = 'Back on the game server.'
export const LOST_ROUND =
  "The game server didn't come back, so this round was lost. The table is still here."

/* ── step 11: the door says no ─────────────────────────────────────────────────────────────── */

/** the relay door's refusals (step 3's codes), the connection gate's, and a game body's version */
export type Refusal =
  | 'not-friends'
  | 'door-unavailable'
  | 'lab-full'
  | 'lab-busy'
  | 'members-only'
  | 'rate-limited'
  | 'version'
export const REFUSED: Record<Refusal, string> = {
  'not-friends': "You can't join this table: somebody at it isn't your friend on the site.",
  'door-unavailable': "Couldn't check who's at this table just now. Trying again…",
  'lab-full':
    'This table already has eight people connected, so you can see the call but not the game.',
  'lab-busy': 'The game server is full right now. Try again in a few minutes.',
  'members-only': 'Sign in to play at a table.',
  'rate-limited': 'Too many connections from here. Waiting a minute before trying again.',
  version: 'Somebody at this table is on a newer version of the Lab. Reload to play together.',
}
/** `door-unavailable` after its three tries, with TRY_AGAIN */
export const DOOR_GAVE_UP = "Couldn't check who's at this table."
export const RELOAD = 'Reload'

/* ── steps 12–14 ───────────────────────────────────────────────────────────────────────────── */

/** a stranger joined the call: said, beside the strip's own sentence, with ON_YOUR_OWN */
export const GATE_CLOSED = 'Toys are private in this call now, so the table has closed.'
/** somebody in the game server's room who has left the call: shown, never hidden */
export const offCallWords = (v: View, id: string) =>
  `${lead(v, id)} is connected to this game but isn't on the call.`
export const ROUND_BROKE =
  'Something went wrong in this round, so it stopped. The table is still here.'
