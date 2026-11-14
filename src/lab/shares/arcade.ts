import {
  readSaved as readArchery,
  ARCHERY_KEY,
  BOWS,
  ROUNDS,
  maxScore,
  type Bow,
  type RoundName,
} from '../../gpu/archery'
import {
  readSaved as readArtillery,
  ARTILLERY_KEY,
  LEVELS as ARTILLERY_LEVELS,
} from '../../gpu/artillery'
import { readSaved as readBowling, BOWLING_KEY, LEVELS as BOWLING_LEVELS } from '../../gpu/bowling'
import { readSaved as readBricks, BRICKS_KEY } from '../../gpu/bricks'
import { readSaved as readCurling, CURLING_KEY, LEVELS as CURLING_LEVELS } from '../../gpu/curling'
import { readSaved as readDarts, DARTS_KEY, LEVELS as DARTS_LEVELS } from '../../gpu/darts'
import { readSaved as readEcho, ECHO_KEY, LIVES } from '../../gpu/echo'
import { readSaved as readHockey, HOCKEY_KEY, LEVELS as HOCKEY_LEVELS } from '../../gpu/hockey'
import { readSaved as readKeepy, KEEPY_KEY, BALLS } from '../../gpu/keepy'
import { readSaved as readLander, LANDER_KEY, LEVELS as LANDER_LEVELS } from '../../gpu/lander'
import { readSaved as readPool, POOL_KEY, LEVELS as POOL_LEVELS } from '../../gpu/pool'
import { readSaved as readPopper, POPPER_KEY, COLOUR_COUNTS } from '../../gpu/popper'
import { readSaved as readPutt, PUTT_KEY, LEVELS as PUTT_LEVELS, COURSE } from '../../gpu/putt'
import { readSaved as readRocks, ROCKS_KEY, PACES } from '../../gpu/rocks'
import { readSaved as readTimeTrial, TIMETRIAL_KEY, TRACKS } from '../../gpu/timetrial'
import { readSaved as readTowers, TOWERS_KEY, MAPS } from '../../gpu/towers'
import { readSaved as readTrails, TRAILS_KEY, LEVELS as TRAILS_LEVELS } from '../../gpu/trails'
import { readSaved as readMobius, MOBIUS_KEY, HOLES, SPACES } from '../../gpu/mobius'
import { readSaved as readPinball, PINBALL_KEY } from '../../gpu/pinball'
import { readSaved as readCrossing, CROSSING_KEY, COURSES } from '../../gpu/crossing'
import type { Reader } from './words'

/*
 * Left out, because nothing a finish writes can be read through the toy's own reader:
 * gust, marbles and tunnel keep nothing at all; strut keeps the creature being built, not a
 * result; mobius, pinball and crossing do keep a best, but parse it inside their Demo component
 * with no exported reader — and a second parser here is exactly what bests.ts forbids.
 */

const n = (x: number) => x.toLocaleString('en')
const times = (x: number) => (x === 1 ? 'once' : `${x} times`)
/** a level id as its toy shows it on the button: "pro" → "Pro" */
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/**
 * The hardest level with something to show for it. Every toy here lists its levels easiest
 * first, so the last one that passes is the one worth naming.
 */
function hardest<L extends string>(levels: readonly L[], has: (l: L) => boolean): L | undefined {
  return levels.filter(has).pop()
}
/** a record against the computer at the hardest level beaten: "won 3 of 5 games against the Hard computer" */
function beaten<L extends string, T extends { won: number; lost: number }>(
  levels: readonly L[],
  record: Record<L, T>,
  what: string,
  also: (t: T) => number = () => 0,
): string | null {
  const l = hardest(levels, (x) => record[x].won > 0)
  if (!l) return null
  const t = record[l]
  return `won ${t.won} of ${t.won + t.lost + also(t)} ${what} against the ${title(l)} computer`
}
/** the largest kept, or the smallest that is not nought for a "fewest" */
const most = (xs: number[]) => Math.max(0, ...xs)
const fewest = (xs: number[]) => Math.min(Infinity, ...xs.filter((x) => x > 0))
const join = (parts: (string | null | false | undefined)[]) => {
  const kept = parts.filter(Boolean)
  return kept.length ? kept.join(', ') : null
}
/** a lap as the time trial shows it: 41.23, or 1:02.50 past the minute */
function lap(s: number) {
  const h = Math.round(s * 100)
  const m = Math.floor(h / 6000)
  const rest = ((h % 6000) / 100).toFixed(2)
  return m ? `${m}:${rest.padStart(5, '0')}` : `${rest} s`
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** a kept "2026-11-14" as "14 Nov", through UTC so no clock or zone moves it */
function dayOf(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`
}

/** share readers for the arcade toys — see bests.ts for the rules every reader keeps */
/** the furthest in a fixed order (easiest first) that has a best, and how many do */
function furthest<T extends { name: string }>(order: readonly T[], has: (t: T) => boolean) {
  const done = order.filter(has)
  return done.length ? { done: done.length, top: done[done.length - 1] } : null
}

export const ARCADE: Record<string, Reader> = {
  mobius: (read) => {
    const s = readMobius(read(MOBIUS_KEY))
    const f = furthest(HOLES, (h) => !!s.best[h.name])
    if (!f) return null
    const b = s.best[f.top.name]
    return `${f.done} of ${HOLES.length} holes sunk, up to ${f.top.name} in ${b.strokes === 1 ? 'one stroke' : `${b.strokes} strokes`} on the ${SPACES[b.space].name}`
  },
  /* tables are the player's own, named by them: the line names the table the best was on */
  pinball: (read) => {
    const s = readPinball(read(PINBALL_KEY))
    const top = Object.entries(s.best).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    return top && top[1] > 0 ? `best ${n(top[1])} points on the table “${top[0]}”` : null
  },
  crossing: (read) => {
    const s = readCrossing(read(CROSSING_KEY))
    const f = furthest(COURSES, (c) => !!s.best[c.name])
    if (!f) return null
    return `${f.done} of ${COURSES.length} courses crossed, up to ${f.top.name} in ${s.best[f.top.name].toFixed(1)} s`
  },
  archery: (read) => {
    const s = readArchery(read(ARCHERY_KEY))
    const order = Object.keys(ROUNDS) as RoundName[]
    const top = Object.entries(s.best)
      .map(([k, total]) => {
        const [bow, round] = k.split('/') as [Bow, RoundName]
        return { bow, round, total }
      })
      // the highest total; on a tie, the longer round
      .sort((a, b) => b.total - a.total || order.indexOf(b.round) - order.indexOf(a.round))[0]
    return join([
      top &&
        `best ${top.total} of ${maxScore(top.round)} (${BOWS[top.bow].label}, ${top.round} round)`,
      s.daily && `daily round ${s.daily.total} on ${dayOf(s.daily.day)}`,
    ])
  },
  artillery: (read) => {
    const r = readArtillery(read(ARTILLERY_KEY)).record
    const few = fewest(ARTILLERY_LEVELS.map((l) => r[l].fewest))
    /* ⚠️ "BEST EVER", SET APART: the fewest shots may have come against an easier computer than
       the one named in the record, so it must not read as part of it */
    const record = beaten(ARTILLERY_LEVELS, r, 'duels')
    const best =
      few !== Infinity ? `best ever a win in ${few === 1 ? '1 shot' : `${few} shots`}` : null
    return record && best ? `${record}; ${best}` : record || best
  },
  bowling: (read) => {
    const r = readBowling(read(BOWLING_KEY)).record
    const best = most(BOWLING_LEVELS.map((l) => r[l].best))
    const strikes = BOWLING_LEVELS.reduce((a, l) => a + r[l].strikes, 0)
    return join([
      best > 0 && `best game ${best}`,
      strikes > 0 && `${n(strikes)} strikes in all`,
      beaten(BOWLING_LEVELS, r, 'games'),
    ])
  },
  bricks: (read) => {
    const s = readBricks(read(BRICKS_KEY))
    if (!s.best) return null
    return join([`best ${n(s.best)} points`, s.furthest > 1 && `reached wall ${s.furthest}`])
  },
  curling: (read) => {
    const r = readCurling(read(CURLING_KEY)).record
    const end = most(CURLING_LEVELS.map((l) => r[l].bestEnd))
    return join([beaten(CURLING_LEVELS, r, 'games', (t) => t.drawn), end > 0 && `best end ${end}`])
  },
  darts: (read) => {
    const r = readDarts(read(DARTS_KEY)).record
    const out = most(DARTS_LEVELS.map((l) => r[l].best))
    const leg = fewest(DARTS_LEVELS.map((l) => r[l].fewest))
    const tons = DARTS_LEVELS.reduce((a, l) => a + r[l].tons, 0)
    /* ⚠️ the checkout, the fastest leg and the 180s are across every level, so they are said as
       "best ever" after the record rather than as part of it */
    const ever = join([
      out > 0 && `checkout ${out}`,
      leg !== Infinity && `a leg in ${leg} darts`,
      tons > 0 && (tons === 1 ? 'a 180' : `${n(tons)} 180s`),
    ])
    const record = beaten(DARTS_LEVELS, r, 'matches')
    if (!ever) return record
    return record ? `${record}; best ever: ${ever}` : `best ever: ${ever}`
  },
  echo: (read) => {
    const s = readEcho(read(ECHO_KEY))
    let top: { notes: number; pads: 4 | 6; mirror: boolean; gentle: boolean } | null = null
    // hardest first, so a tie names the harder way of playing
    for (const k of ['strict', 'gentle'] as const)
      for (const p of [6, 4] as const)
        for (const m of ['mirror', 'echo'] as const)
          if (s.best[k][p][m] > (top?.notes ?? 0))
            top = {
              notes: s.best[k][p][m],
              pads: p,
              mirror: m === 'mirror',
              gentle: k === 'gentle',
            }
    if (!top) return null
    return `longest tune ${top.notes} notes on ${top.pads} pads${top.mirror ? ', played back backwards' : ''}${top.gentle ? `, with ${LIVES.gentle} goes` : ''}`
  },
  hockey: (read) => {
    const r = readHockey(read(HOCKEY_KEY)).record
    const l = hardest(HOCKEY_LEVELS, (x) => r[x].won > 0)
    if (!l) return null
    const t = r[l]
    return join([
      beaten(HOCKEY_LEVELS, r, 'matches'),
      t.best > 0 && `widest win by ${t.best}`,
      t.fastest > 0 && `fastest win ${t.fastest} s`,
      t.bestStreak > 1 && `best run ${t.bestStreak} in a row`,
    ])
  },
  keepy: (read) => {
    const s = readKeepy(read(KEEPY_KEY))
    let top: { score: number; ball: string; breezy: boolean } | null = null
    for (const ball of BALLS)
      for (const breezy of [true, false])
        if (s.best[ball][breezy ? 'breezy' : 'calm'] > (top?.score ?? 0))
          top = { score: s.best[ball][breezy ? 'breezy' : 'calm'], ball, breezy }
    if (!top) return null
    const what = top.ball === 'beach' ? 'beach ball' : top.ball
    return `best ${n(top.score)} points with the ${what}${top.breezy ? ' in the breeze' : ''} (${n(s.played)} games)`
  },
  lander: (read) => {
    const r = readLander(read(LANDER_KEY)).record
    const best = most(LANDER_LEVELS.map((l) => r[l].best))
    if (!best) return null
    const l = hardest(LANDER_LEVELS, (x) => r[x].beat > 0)
    return join([
      `best landing ${n(best)}`,
      l && `beat the ${title(l)} autopilot ${times(r[l].beat)}`,
    ])
  },
  pool: (read) => beaten(POOL_LEVELS, readPool(read(POOL_KEY)).record, 'games'),
  popper: (read) => {
    const s = readPopper(read(POPPER_KEY))
    // most colours first, so a tie names the harder board
    const c = [...COLOUR_COUNTS].reverse().reduce((a, k) => (s.best[k] > s.best[a] ? k : a))
    if (!s.best[c]) return null
    return `best ${n(s.best[c])} points with ${c} colours (${n(s.games)} games)`
  },
  putt: (read) => {
    const r = readPutt(read(PUTT_KEY)).record
    const best = fewest(PUTT_LEVELS.map((l) => r[l].best))
    return join([
      best !== Infinity && `best round ${best} strokes over the ${COURSE.length} holes`,
      beaten(PUTT_LEVELS, r, 'rounds', (t) => t.tied),
    ])
  },
  rocks: (read) => {
    const s = readRocks(read(ROCKS_KEY))
    // the wildest pace first, so a tie names the harder one
    const p = [...PACES].reverse().reduce((a, k) => (s.best[k] > s.best[a] ? k : a))
    if (!s.best[p]) return null
    return `best ${n(s.best[p])} points at the ${p} pace (${n(s.games)} games)`
  },
  timetrial: (read) => {
    const s = readTimeTrial(read(TIMETRIAL_KEY))
    // the built-in tracks only: a daily track is keyed by a seed, which names no day
    return join(
      TRACKS.filter((t) => s.best[t.id]).map((t) => `${t.name} in ${lap(s.best[t.id].lap)}`),
    )
  },
  towers: (read) => {
    const s = readTowers(read(TOWERS_KEY))
    const held = MAPS.filter((m) => s.best[m.id]).map((m) => `${m.name} ${s.best[m.id]}`)
    return held.length ? `most waves held: ${held.join(', ')}` : null
  },
  trails: (read) => {
    const r = readTrails(read(TRAILS_KEY)).record
    const l = hardest(TRAILS_LEVELS, (x) => r[x].won > 0)
    const longest = most(TRAILS_LEVELS.map((x) => r[x].longest))
    return join([
      l && `won ${r[l].won} of ${r[l].rounds} rounds against the ${title(l)} computer`,
      longest > 0 && `longest ride ${n(longest)} squares`,
    ])
  },
}
