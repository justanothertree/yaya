import {
  MAX_LAYERS,
  changingFromElsewhere,
  loopState,
  restoreArrangement,
  subscribeLoop,
  type Layer,
} from './looper'

/**
 * Undo and redo for the whole room — every change to the layers and the arrangement.
 *
 * ⚠️ EVAN'S ASK, 9 NOV 2026, and the gap was larger than one button. "↶ Undo take" took back
 * the last LAYER, whatever had happened since, and nothing else in the room could be undone: a
 * deleted layer, Clear all, a beat swapped over the one you liked, a bar dragged to the wrong
 * place, a key change that re-laid the chords, a song opened over an hour's work. The room is
 * built for people trying things, and trying things needs a way back.
 *
 * ⚠️ IT WATCHES THE STORE RATHER THAN WRAPPING EVERY EDIT, for the reason jam.ts gives about its
 * own subscription: twenty-odd functions change a layer, and a history hung off each of them is
 * twenty call sites to find again when the twenty-first arrives. Every change goes through
 * `set({ layers: [...] })` with new objects for whatever changed, so comparing references says
 * exactly which layers an edit touched, and a step stores only those — before and after.
 *
 * ⚠️ OWN CHANGES ONLY, IN TWO HALVES (Evan's words: "own changes only in a jam").
 * - What somebody else did is never recorded: the jam applies its messages inside
 *   `fromElsewhere`, and so does the bench being put back on load.
 * - And an undo never overwrites what somebody else did SINCE. A step is taken back layer by
 *   layer, and only where the layer is still exactly as this step left it; a partner who has
 *   muted it since keeps their mute, and that layer is skipped. The same goes for the transport.
 *   So undoing your own change to a partner's part still works — it is yours — and it goes home
 *   to them like any other edit.
 */

/** one layer, before and after a step — null where it did not exist */
type Change = { id: string; at: number; before: Layer | null; after: Layer | null }
type Transport = { bpm: number; bars: number }
type Step = {
  changes: Change[]
  transport: { before: Transport; after: Transport } | null
  /** what changed, for folding a slider drag into one step — see `sameKind` */
  kind: string
  last: number
}

/** a slider dragged for a second is one change, not sixty */
const FOLD_MS = 1000
const MAX_STEPS = 100

let undos: Step[] = []
let redos: Step[] = []
let seen: { layers: readonly Layer[]; bpm: number; bars: number } | null = null
/** set while this module is the one changing the store, so the change is not recorded again */
let applying = false
/**
 * Set from the first step one press writes until the press is over — see `record`.
 *
 * ⚠️ ONE PRESS, ONE STEP. A genre starter lays a beat, chords and a bass and sets the tempo, which
 * is four changes to the store from one click; recorded one by one, Undo took four presses to take
 * back one. Everything a single event handler changes happens in one task, before the browser runs
 * its microtasks, so a flag cleared in a microtask marks exactly "the same press". A fader drag is
 * many events and so many tasks, which is what FOLD_MS is for.
 */
let samePress = false
let started = false
let stop: (() => void) | null = null
const listeners = new Set<() => void>()
let view = { undo: 0, redo: 0 }

const tell = () => {
  view = { undo: undos.length, redo: redos.length }
  for (const fn of listeners) fn()
}

/**
 * Whether two versions of a layer are the same edit.
 *
 * ⚠️ `shared` IS NOT PART OF IT. The jam marks every layer of yours as shared after it sends it
 * (`setLayersShared`), which replaces the object without anybody editing anything — compared by
 * reference, every step taken before joining a jam would read as overwritten and refuse to undo.
 * Every other field is compared by reference, because every edit replaces what it changes.
 */
export function sameLayer(a: Layer | null | undefined, b: Layer | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  keys.delete('shared')
  for (const k of keys)
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
      return false
  return true
}

/** which fields an edit touched, so two moves of one fader fold together and a fader then a mute do not */
function fieldsChanged(a: Layer | null, b: Layer | null): string {
  if (!a || !b) return a ? 'gone' : 'new'
  const out: string[] = []
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  keys.delete('shared')
  for (const k of keys)
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
      out.push(k)
  return out.sort().join(',')
}

/** The step a change of store makes, or null when nothing this history cares about moved. */
export function diff(
  was: { layers: readonly Layer[]; bpm: number; bars: number },
  now: { layers: readonly Layer[]; bpm: number; bars: number },
  at: number,
): Step | null {
  const before = new Map(was.layers.map((l, i) => [l.id, { l, i }]))
  const after = new Map(now.layers.map((l, i) => [l.id, { l, i }]))
  const changes: Change[] = []
  for (const [id, b] of before) {
    const a = after.get(id)
    if (!a) changes.push({ id, at: b.i, before: b.l, after: null })
    else if (!sameLayer(b.l, a.l)) changes.push({ id, at: a.i, before: b.l, after: a.l })
  }
  for (const [id, a] of after)
    if (!before.has(id)) changes.push({ id, at: a.i, before: null, after: a.l })
  const moved = was.bpm !== now.bpm || was.bars !== now.bars
  if (!changes.length && !moved) return null
  return {
    changes,
    transport: moved
      ? { before: { bpm: was.bpm, bars: was.bars }, after: { bpm: now.bpm, bars: now.bars } }
      : null,
    kind:
      changes.map((c) => `${c.id}:${fieldsChanged(c.before, c.after)}`).join('|') +
      (moved ? '|transport' : ''),
    last: at,
  }
}

/**
 * Take a step back (`back`) or forward over the layers as they stand now — or null if nothing in
 * it can be applied.
 *
 * ⚠️ LAYER BY LAYER, AND ONLY WHERE NOTHING ELSE HAS HAPPENED. A layer is put back only if it is
 * still exactly what this step left; anything a partner has changed since is skipped rather than
 * overwritten. A layer the step deleted comes back where it was, and only if there is room.
 */
export function apply(
  layers: readonly Layer[],
  transport: Transport,
  step: Step,
  back: boolean,
  full: (count: number) => boolean,
): { layers: Layer[]; transport: Transport | null } | null {
  const out = [...layers]
  let did = false
  /* deletions put back in the order they stood, so their old positions are true as they land */
  const order = [...step.changes].sort((x, y) => x.at - y.at)
  for (const c of order) {
    const from = back ? c.after : c.before
    const to = back ? c.before : c.after
    const at = out.findIndex((l) => l.id === c.id)
    const here = at === -1 ? null : out[at]
    if (from === null) {
      /* the layer did not exist on this side of the step: put it (back) where it stood */
      if (!here && to && !full(out.length)) {
        out.splice(Math.min(c.at, out.length), 0, to)
        did = true
      }
      continue
    }
    if (!sameLayer(here, from)) continue
    /* a replaced layer keeps the jam's mark as it is now — see sameLayer */
    if (to === null) out.splice(at, 1)
    else out[at] = !!here?.shared === !!to.shared ? to : { ...to, shared: here?.shared }
    did = true
  }
  let t: Transport | null = null
  if (step.transport) {
    const from = back ? step.transport.after : step.transport.before
    const to = back ? step.transport.before : step.transport.after
    if (transport.bpm === from.bpm && transport.bars === from.bars) {
      t = to
      did = true
    }
  }
  return did ? { layers: out, transport: t } : null
}

function record() {
  const now = loopState()
  const was = seen
  if (was && now.layers === was.layers && now.bpm === was.bpm && now.bars === was.bars) return
  seen = { layers: now.layers, bpm: now.bpm, bars: now.bars }
  if (!was || applying || changingFromElsewhere()) return
  const step = diff(was, now, Date.now())
  if (!step) return
  const top = undos[undos.length - 1]
  if (top && samePress) {
    joinInto(top, step)
    return
  }
  samePress = true
  queueMicrotask(() => {
    samePress = false
  })
  /* a fader dragged, a field typed: the same thing changing again within a second is one step */
  if (top && !redos.length && top.kind === step.kind && step.last - top.last < FOLD_MS) {
    for (const c of step.changes) {
      const into = top.changes.find((x) => x.id === c.id)
      if (into) into.after = c.after
    }
    if (top.transport && step.transport) top.transport.after = step.transport.after
    top.last = step.last
    return
  }
  undos.push(step)
  if (undos.length > MAX_STEPS) undos = undos.slice(-MAX_STEPS)
  redos = []
  tell()
}

/** fold a later change from the same press into the step it began — every layer it touched */
function joinInto(top: Step, step: Step) {
  for (const c of step.changes) {
    const into = top.changes.find((x) => x.id === c.id)
    if (into) into.after = c.after
    else top.changes.push(c)
  }
  if (step.transport)
    top.transport = top.transport
      ? { before: top.transport.before, after: step.transport.after }
      : step.transport
  /* a joined step is its own kind, so a fader moved next cannot fold into it */
  top.kind = `${top.kind}+${step.kind}`
  top.last = step.last
}

/**
 * Start keeping the history — once, however many times the room mounts.
 *
 * ⚠️ WHAT IS ON THE BENCH WHEN IT STARTS IS WHERE UNDO STOPS. Nothing before this is a step, so
 * Ctrl+Z can never take the room back past what the page opened with.
 */
export function startHistory() {
  if (started) return
  started = true
  const s = loopState()
  seen = { layers: s.layers, bpm: s.bpm, bars: s.bars }
  stop = subscribeLoop(record)
}

function move(from: Step[], to: Step[], back: boolean): boolean {
  /* a step that has nothing left to give back — all of it overwritten by somebody — is dropped
     and the next one tried, so the button never presses into nothing */
  while (from.length) {
    const step = from.pop()!
    const s = loopState()
    const got = apply(s.layers, { bpm: s.bpm, bars: s.bars }, step, back, (n) => n >= MAX_LAYERS)
    if (!got) continue
    applying = true
    try {
      restoreArrangement(got.layers, got.transport ?? undefined)
    } finally {
      applying = false
    }
    step.last = 0
    to.push(step)
    tell()
    return true
  }
  tell()
  return false
}

export const undo = () => move(undos, redos, true)
export const redo = () => move(redos, undos, false)

export function subscribeHistory(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
/** how many steps each way, for the buttons — a stable object between changes */
export const historyNow = () => view

/** for tests: forget everything and stop listening */
export function resetHistoryForTests() {
  samePress = false
  stop?.()
  stop = null
  undos = []
  redos = []
  seen = null
  started = false
  applying = false
  view = { undo: 0, redo: 0 }
}
