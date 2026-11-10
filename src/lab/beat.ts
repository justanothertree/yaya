/**
 * "Beat my run" links: a Stackfall survival or a Ten thousand race, sent to a friend so they can
 * play the SAME luck — the same pieces in the same order, the same dice for the same choices — and
 * see whether they do better. Asynchronous head-to-head, with no server: the link carries the seed
 * and the score to beat, and travels through the comments and chat that already exist.
 *
 * ⚠️ THE LINK IS A CLAIM, NOT A RECORD. Nothing checks that the run in it happened; replaying it
 * would need every key press in the URL. Among friends that is fine, and the page words it as what
 * the link says ("this link says 3:12"), never as a verified score.
 *
 * ⚠️ AND IT CARRIES NO NAME. Snake's beat link puts a display name in the URL; here the person who
 * pastes the link is already shown as its author wherever it is pasted, so a name would only be
 * untrusted text the page has to print. Everything read from a link is a bounded number.
 *
 * Pure apart from `fromHash`, so beat.test.ts can round-trip links and check the deals.
 */
import { seeded } from '../gpu/stack'

export type Beat =
  | { game: 'stack'; seed: number; time: number; lines: number }
  | { game: 'dice'; seed: number; turns: number }

const MAX_SEED = 2 ** 31 - 1

/** a fresh seed for a run that might be shared */
export const newSeed = (rand: () => number = Math.random) => 1 + Math.floor(rand() * (MAX_SEED - 1))

/** the hash part of a link: `#lab?demo=stack&seed=…&t=…&lines=…` */
export function beatHash(b: Beat): string {
  const q = new URLSearchParams({ demo: b.game, seed: String(b.seed) })
  if (b.game === 'stack') {
    q.set('t', b.time.toFixed(1))
    q.set('lines', String(b.lines))
  } else q.set('turns', String(b.turns))
  return `#lab?${q.toString()}`
}

/** a whole link, on this site */
export const beatLink = (b: Beat, base: string) => `${base}${beatHash(b)}`

const int = (v: string | null, lo: number, hi: number) =>
  v !== null && /^\d{1,10}$/.test(v) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null

/** a challenge from a location hash, or null — anything malformed or out of range is no challenge */
export function readBeat(hash: string): Beat | null {
  const m = /^#lab\?(.*)$/.exec(hash)
  if (!m) return null
  const q = new URLSearchParams(m[1])
  const seed = int(q.get('seed'), 1, MAX_SEED)
  if (seed === null) return null
  if (q.get('demo') === 'stack') {
    const t = q.get('t')
    const time = t !== null && /^\d{1,5}(\.\d)?$/.test(t) ? Number(t) : null
    const lines = int(q.get('lines'), 0, 99_999)
    if (time === null || time <= 0 || time > 86_400 || lines === null) return null
    return { game: 'stack', seed, time, lines }
  }
  if (q.get('demo') === 'dice') {
    const turns = int(q.get('turns'), 1, 400)
    return turns === null ? null : { game: 'dice', seed, turns }
  }
  return null
}

/** the challenge in this page's address, if any */
export const fromHash = (): Beat | null => {
  try {
    return readBeat(window.location.hash)
  } catch {
    return null
  }
}

/** leave a challenge: the address goes back to the plain Lab, with no new history entry */
export function dropBeat() {
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}#lab`)
  } catch {
    /* an address that cannot be rewritten keeps its challenge; nothing breaks */
  }
}

/* ---------------------------------------------------------------------------- the dice deal */

/**
 * The random source for one roll of a race: the k-th roll of turn `turn` on deal `seed`. Every die
 * comes from a fresh stream for that (turn, roll), so two people who make the same choices see the
 * same dice, and a choice that leaves fewer dice takes the first few of the same six — the deal
 * never shifts because somebody kept one die more.
 */
export function dealRand(seed: number, turn: number, roll: number): () => number {
  // mix the three numbers into one seed; any fixed, well-spread mix will do
  let h = (seed ^ Math.imul(turn + 1, 0x9e3779b1) ^ Math.imul(roll + 1, 0x85ebca77)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return seeded(h || 1)
}

/* ---------------------------------------------------------------------------- who did better */

/** a Stackfall run beats the link's when it lasts longer; a tie on time goes to more lines */
export const beatsStack = (b: { time: number; lines: number }, time: number, lines: number) =>
  Math.round(time * 10) > Math.round(b.time * 10) ||
  (Math.round(time * 10) === Math.round(b.time * 10) && lines > b.lines)

/** a race beats the link's in fewer turns */
export const beatsDice = (b: { turns: number }, turns: number) => turns < b.turns

/** the sentence copied with a link, so it reads as an invitation wherever it is pasted */
export function beatMessage(b: Beat, link: string): string {
  if (b.game === 'stack') {
    const m = Math.floor(b.time / 60)
    const s = String(Math.floor(b.time % 60)).padStart(2, '0')
    return `🏁 Beat my run at Stackfall: ${m}:${s} with ${b.lines} lines. Same pieces, same order:\n${link}`
  }
  return `🏁 Beat my run at Ten thousand: 10,000 in ${b.turns} turns. Same dice for the same choices:\n${link}`
}
