/**
 * "Share my best": the line a comment can start with when somebody has done well at a toy — their
 * best run, read from what the toy itself keeps in this browser. Pure apart from the reader it is
 * handed, so bests.test.ts can ask it about any saved state without a page.
 *
 * ⚠️ EVERY TOY'S OWN READER, NEVER A SECOND ONE. Each toy already parses its storage defensively
 * (a hand-edited or older shape loses only what is bad); reading the JSON again here would be a
 * second parser to drift from the first. So this calls each toy's readSaved/readBests and only
 * words the result.
 *
 * ⚠️ AND IT CLAIMS ONLY WHAT IS KEPT. A best that is not in storage — a cleared browser, another
 * device — is no best: the line is null and the button does not appear. Nothing is sent anywhere
 * until the person posts the comment themselves.
 */
import { readSaved as readBeams, LEVELS as BEAM_LEVELS, BEAMS_KEY } from '../gpu/beams'
import { readSaved as readBridge, LEVELS as BRIDGE_LEVELS, BRIDGE_KEY } from '../gpu/bridge'
import { readSaved as readGates, LEVELS as GATE_LEVELS, GATES_KEY } from '../gpu/gates'
import { readSaved as readGlide, TASKS, GLIDE_KEY } from '../gpu/glide'
import { readSaved as readGraph, LEVELS as GRAPH_LEVELS, GRAPH_KEY } from '../gpu/graph'
import { readSaved as readIntervals, STAGES, INTERVALS_KEY } from '../gpu/intervals'
import { readBests as readJigsaw, JIGSAW_BESTS_KEY, PICTURES } from '../gpu/jigsaw'
import { readSaved as readMix, TARGETS, MIX_KEY } from '../gpu/mix'
import { readSaved as readNonogram, LEVELS as NONO_LEVELS, NONOGRAM_KEY } from '../gpu/nonogram'
import { readBests as readOrbit, LEVELS as ORBIT_LEVELS, ORBIT_KEY } from '../gpu/orbit'
import { readSaved as readPegdrop, PEGDROP_KEY, START as PEGDROP_START, pts } from '../gpu/pegdrop'
import { readSaved as readSkip, CHALLENGES, SKIP_KEY } from '../gpu/skip'
import { readSaved as readSlide, LEVELS as SLIDE_LEVELS, SLIDE_KEY } from '../gpu/slide'
import { readSaved as readSun, SUN_KEY } from '../gpu/sun'
import { readBest as readTrials, BEST_KEY as TRIALS_KEY } from '../gpu/trials'
import { readSolved as readWaterworks, LEVELS as WATER_LEVELS, SOLVED_KEY } from '../gpu/waterworks'

type Read = (key: string) => string | null

/** seconds as m:ss, or h:mm:ss past the hour */
export function clock(s: number): string {
  const t = Math.round(s)
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "3 of 10 levels solved", or null when none are */
const solved = (n: number, of: number, what = 'levels') =>
  n > 0 ? `${n} of ${of} ${what} solved` : null

const READERS: Record<string, (read: Read) => string | null> = {
  skip: (read) => {
    const s = readSkip(read(SKIP_KEY))
    if (!s.best) return null
    return `best ${s.best} skips, furthest ${s.furthest} m, ${s.done.length} of ${CHALLENGES.length} challenges`
  },
  glide: (read) => {
    const s = readGlide(read(GLIDE_KEY))
    const done = TASKS.filter((t) => s[t.id] !== undefined).map(
      (t) => `${t.name} ${clock(s[t.id])}`,
    )
    return done.length ? done.join(', ') : null
  },
  sun: (read) => {
    const s = readSun(read(SUN_KEY))
    return s.best ? `Where’s the sun? best ${s.best} of 500` : null
  },
  trials: (read) => {
    const frames = readTrials(read(TRIALS_KEY))
    return frames === null ? null : `best time ${(frames / 60).toFixed(2)} s`
  },
  orbit: (read) => solved(Object.keys(readOrbit(read(ORBIT_KEY))).length, ORBIT_LEVELS.length),
  slide: (read) => {
    const s = readSlide(read(SLIDE_KEY))
    const endless = s.endless.easy + s.endless.medium + s.endless.hard
    const levels = solved(Object.keys(s.best).length, SLIDE_LEVELS.length)
    const parts = [levels, endless ? `${endless} endless boards` : null].filter(Boolean)
    return parts.length ? parts.join(', ') : null
  },
  beams: (read) => solved(Object.keys(readBeams(read(BEAMS_KEY)).best).length, BEAM_LEVELS.length),
  bridge: (read) =>
    solved(Object.keys(readBridge(read(BRIDGE_KEY)).best).length, BRIDGE_LEVELS.length),
  gates: (read) => solved(Object.keys(readGates(read(GATES_KEY)).best).length, GATE_LEVELS.length),
  mix: (read) => solved(Object.keys(readMix(read(MIX_KEY)).best).length, TARGETS.length, 'colours'),
  graph: (read) =>
    solved(Object.keys(readGraph(read(GRAPH_KEY)).solved).length, GRAPH_LEVELS.length),
  nonogram: (read) => {
    const s = readNonogram(read(NONOGRAM_KEY))
    const names = new Set(NONO_LEVELS.map((l) => l.name))
    return solved(
      Object.keys(s.solved).filter((k) => names.has(k)).length,
      NONO_LEVELS.length,
      'puzzles',
    )
  },
  intervals: (read) => {
    const s = readIntervals(read(INTERVALS_KEY))
    return s.passed ? `${s.passed} of ${STAGES.length} stages passed` : null
  },
  waterworks: (read) => solved(readWaterworks(read(SOLVED_KEY)).length, WATER_LEVELS.length),
  pegdrop: (read) => {
    const s = readPegdrop(read(PEGDROP_KEY))
    // the bank everybody starts with is no achievement; a best above it is
    if (s.best <= PEGDROP_START) return null
    const hit = s.bigHit ? `, biggest landing ${s.bigHit}×` : ''
    return `most points ever ${pts(s.best)}${hit} (${s.drops} drops)`
  },
  jigsaw: (read) => {
    const b = readJigsaw(read(JIGSAW_BESTS_KEY))
    const runs = Object.entries(b).sort((x, y) => x[1] - y[1])
    if (!runs.length) return null
    const [key, s] = runs[0]
    const [pic, pieces] = key.split(':')
    const name = PICTURES.find((p) => p.id === pic)?.name ?? pic
    return `${name}, ${pieces} pieces in ${clock(s)}`
  },
}

/** which toys can share a best at all */
export const SHARES = new Set(Object.keys(READERS))

/** the comment a best becomes: "🏆 My best at Soaring: Final glide 13:00" — or null */
export function bestLine(id: string, name: string, read: Read): string | null {
  const r = READERS[id]
  if (!r) return null
  let line: string | null = null
  try {
    line = r(read)
  } catch {
    return null
  }
  return line ? `🏆 My best at ${name}: ${line}` : null
}

/** this browser's storage, read the way the toys read it — a private window may refuse */
export const fromStorage: Read = (key) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
