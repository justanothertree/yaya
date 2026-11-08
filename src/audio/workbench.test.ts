import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { benchTroubleText, packWork, readWork, type Bench, type BenchTrouble } from './workbench'
import { loadSong, loopState, type Layer } from './looper'
import { TAKE_MAX_SECONDS } from './takes'
import type { Fx } from './synth'

/**
 * What you were working on, across a refresh.
 *
 * ⚠️ THE BUG THIS IS FOR WAS AN ABSENCE, NOT A FAULT. Nothing ever wrote the looper's state
 * anywhere, so an arrangement survived walking to another room — the module is never unloaded —
 * and died on reload. Measured 7 Nov 2026: three layers with their gains, mutes, plans and
 * instruments plus a placed recording came back byte for byte from Instrument → Games → Home →
 * Instrument, and came back as nothing after a reload, along with the tempo and the bar count.
 *
 * ⚠️ THE ROUND TRIP IS ONLY WORTH THE FIELDS THE FIXTURE FILLS, which is why every value below
 * is something other than its default: a muted layer rather than an unmuted one, a gain that is
 * not 1, a plan and a mask rather than neither, an instrument that is not `keys`, a tempo that
 * is not 96 and a bar count that is not 2. A fixture sitting on defaults passes with the field
 * deleted, which is the trap CLAUDE.md names twice — and the way this file was checked is the
 * way it says to: each field dropped in turn, watching this go red.
 */

const fx: Fx = { echo: 0.5, echoTime: 0.3, space: 0.2, vibrato: 0.1, glide: 0.4, tone: 0.8 }

const layer = (over: Partial<Layer> = {}): Layer => ({
  id: '1700000000000-0-beat:boombap',
  instrument: 'drums',
  len: 2.5,
  muted: true,
  gain: 1.8,
  play: [true, false, true, true],
  plan: [0, null, 1, 0],
  fx,
  events: [
    { t: 0, midi: 36, on: true },
    { t: 0.25, midi: 36, on: false },
    { t: 1, midi: 38, on: true },
    { t: 1.3, midi: 38, on: false },
  ],
  ...over,
})

const bench = (over: Partial<Bench> = {}): Bench => ({
  bpm: 140,
  bars: 4,
  layers: [layer()],
  takes: [
    {
      id: 'take-a',
      at: 3.25,
      muted: true,
      fx: { tone: -0.4, squeeze: 0.7, double: 0.3, echo: 0.2, echoTime: 0.45, space: 0.6 },
      chop: { shape: 'tremolo', rate: 16, amount: 0.65 },
    },
  ],
  ...over,
})

/** The transport as it reads on a page that has just loaded — the fallback, never the answer. */
const cold = { bpm: 96, bars: 2 }

const back = (b: Bench = bench()) => readWork(packWork(b), cold)!

describe('a bench survives a reload', () => {
  it('and comes back with the transport it was left at', () => {
    const w = back()
    expect(w.bpm).toBe(140)
    expect(w.bars).toBe(4)
  })

  it('and every layer field that was not a default', () => {
    const l = back().layers[0]
    expect(l.instrument).toBe('drums')
    expect(l.muted).toBe(true)
    expect(l.gain).toBe(1.8)
    expect(l.len).toBe(2.5)
    expect(l.play).toEqual([true, false, true, true])
    expect(l.plan).toEqual([0, null, 1, 0])
    expect(l.fx).toEqual(fx)
    /* the notes, as pitches and moments rather than as a count */
    expect(l.events.filter((e) => e.on).map((e) => e.midi)).toEqual([36, 38])
    expect(l.events.filter((e) => e.on).map((e) => e.t)).toEqual([0, 1])
  })

  it('and which picker put it there, so the beat button is still lit', () => {
    /* ⚠️ the tag lives on the ID and nowhere else — see songToLayers. Without it a restored
       bench came back with its pickers blank and the next press ADDING a second drum part
       rather than swapping the first. */
    expect(back().layers[0].id).toContain('-beat:boombap')
  })

  it('and every placed recording, with where it sat and what it is put through', () => {
    const t = back().takes[0]
    expect(t.id).toBe('take-a')
    expect(t.at).toBe(3.25)
    expect(t.muted).toBe(true)
    expect(t.fx).toEqual({
      tone: -0.4,
      squeeze: 0.7,
      double: 0.3,
      echo: 0.2,
      echoTime: 0.45,
      space: 0.6,
    })
    expect(t.chop).toEqual({ shape: 'tremolo', rate: 16, amount: 0.65 })
  })

  it('and the tempo comes back when a recording is the whole arrangement', () => {
    /* ⚠️ THE REASON bpm AND bars ARE NOT KEPT INSIDE THE SONG. `readSong` answers null when
       there are no layers, so a bench holding one sung take over nothing would have come back
       at 96/2 — the defaults, which is exactly the shape that hid half of the original bug. */
    const w = back(bench({ layers: [] }))
    expect(w.bpm).toBe(140)
    expect(w.bars).toBe(4)
    expect(w.layers).toHaveLength(0)
    expect(w.takes).toHaveLength(1)
  })

  it('and an empty bench writes nothing but the transport', () => {
    /* what tells `write` there is nothing here, so the key goes rather than lingering */
    const out = packWork(bench({ layers: [], takes: [] }))
    expect(out.song).toBeUndefined()
    expect(out.takes).toBeUndefined()
  })
})

describe('a layer somebody else recorded', () => {
  it('is not written down, so a reload cannot put a peer back in an empty room', () => {
    const out = packWork(bench({ layers: [layer(), layer({ id: 'p-1', from: 'someone' })] }))
    expect(out.song!.l).toHaveLength(1)
    expect(readWork(out, cold)!.layers).toHaveLength(1)
  })

  it('and a bench of nothing but theirs writes no song at all', () => {
    const out = packWork(bench({ layers: [layer({ id: 'p-1', from: 'someone' })], takes: [] }))
    expect(out.song).toBeUndefined()
  })
})

describe('the key is a file like any other', () => {
  it('and anything that is not a bench is refused', () => {
    for (const junk of [null, undefined, 7, 'bench', [], {}, { v: 2 }, { v: '1' }]) {
      expect(readWork(junk, cold)).toBeNull()
    }
  })

  it('and a tempo that is not a number falls back to the room rather than to NaN', () => {
    /* ⚠️ loadSong already clamps the RANGE; what it cannot do is notice `"fast"`, because
       Math.round of that is NaN and NaN comes through Math.max and Math.min untouched. */
    const w = readWork({ v: 1, bpm: 'fast', bars: null }, cold)!
    expect(w.bpm).toBe(96)
    expect(w.bars).toBe(2)
  })

  it('and a tempo out of range is passed on, because loadSong is what owns the range', () => {
    const w = readWork({ v: 1, bpm: 1e9, bars: 400 }, cold)!
    expect(w.bpm).toBe(1e9)
    expect(w.bars).toBe(400)
    /* …and this is the half that makes that safe, asked of the function that does the clamping */
    loadSong(w.bpm, w.bars, [])
    expect(loopState().bpm).toBe(200)
    expect(loopState().bars).toBe(32)
    loadSong(96, 2, [])
  })

  it('and a placement nobody could have made is dropped', () => {
    const takes = [
      { id: 'ok', at: 1 },
      { id: 'nan', at: Number.NaN },
      { id: 'text', at: '3' },
      { id: 'missing' },
      { id: 'before', at: -0.5 },
      { id: 'past-the-end', at: TAKE_MAX_SECONDS + 1 },
      { id: 'x'.repeat(65), at: 1 },
      { id: '', at: 1 },
      { at: 1 },
      'not-a-take',
      null,
      { id: 'edge', at: TAKE_MAX_SECONDS },
    ]
    expect(readWork({ v: 1, bpm: 96, bars: 2, takes }, cold)!.takes.map((t) => t.id)).toEqual([
      'ok',
      'edge',
    ])
  })

  it('and one recording cannot be placed twice', () => {
    /* ⚠️ `placeTake` keys on the id and MOVES an existing placement, so two entries here would
       be two rows in the panel and one take on the loop — a list disagreeing with the room from
       the moment it is restored. */
    const takes = [
      { id: 'a', at: 1 },
      { id: 'a', at: 2 },
      { id: 'b', at: 3 },
    ]
    const out = readWork({ v: 1, bpm: 96, bars: 2, takes }, cold)!.takes
    expect(out.map((t) => [t.id, t.at])).toEqual([
      ['a', 1],
      ['b', 3],
    ])
  })

  it('and the reader is never stricter than the writer about how many there are', () => {
    /* ⚠️ a cap only one side knows about is a silent truncation that reads as a missing part */
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `t-${i}`, at: i * 0.1 }))
    const written = packWork(bench({ takes: many }))
    expect(written.takes!.length).toBe(32)
    expect(readWork(written, cold)!.takes).toHaveLength(written.takes!.length)
  })

  it('and a setting that is not a number is dropped while the rest of it survives', () => {
    /* ⚠️ dropped rather than clamped: takeFx and takeChop merge onto their own defaults, and
       both clamp the RANGE where the value is used. What they cannot catch is a NaN reaching a
       slider, which is the one thing this reader is for. */
    const takes = [
      {
        id: 'a',
        at: 0,
        fx: { tone: Number.NaN, squeeze: 0.7, double: 'loud', echo: 0.2 },
        chop: { shape: 'nope', rate: 7, amount: 0.4 },
      },
    ]
    const t = readWork({ v: 1, bpm: 96, bars: 2, takes }, cold)!.takes[0]
    expect(t.fx).toEqual({ squeeze: 0.7, echo: 0.2 })
    /* shape is not one the room has and 7 is not a division of a bar; the amount is fine */
    expect(t.chop).toEqual({ amount: 0.4 })
  })

  it('and a setting with nothing usable left in it is not carried at all', () => {
    const takes = [{ id: 'a', at: 0, fx: { tone: 'warm' }, chop: { shape: 9 } }]
    const t = readWork({ v: 1, bpm: 96, bars: 2, takes }, cold)!.takes[0]
    expect(t.fx).toBeUndefined()
    expect(t.chop).toBeUndefined()
  })

  it('and a layer out of it still goes through readSong', () => {
    /* the whole point of writing the song form rather than the live one: this key becomes
       oscillators, so a hostile layer meets the same parser a stranger's file does */
    const w = readWork(
      {
        v: 1,
        bpm: 96,
        bars: 2,
        song: {
          v: 2,
          name: 'x',
          bpm: 96,
          bars: 2,
          l: [{ i: 'not-an-instrument', p: -1, d: 2000, f: [], m: 0, n: [0, 900, 500] }],
        },
      },
      cold,
    )!
    /* midi 900 does not exist, so the only note in it is refused and the layer with it */
    expect(w.layers).toHaveLength(0)
  })
})

describe('a placement whose recording would not open', () => {
  const waiting = { id: 'voice-1', at: 2.5, muted: true, fx: { space: 0.6 } }

  it('is still written down, so a bad moment is not a deletion', () => {
    const out = packWork(bench({ takes: [], carried: [waiting] }))
    expect(out.takes).toEqual([waiting])
  })

  it('and is written once when it has since come back onto the loop', () => {
    const out = packWork(bench({ carried: [{ id: 'take-a', at: 9 }] }))
    expect(out.takes!.map((t) => [t.id, t.at])).toEqual([['take-a', 3.25]])
  })

  it('and counts against the same ceiling as the rest, so the reader still agrees', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `c-${i}`, at: 0 }))
    const out = packWork(bench({ carried: many }))
    expect(out.takes).toHaveLength(32)
    expect(readWork(out, cold)!.takes).toHaveLength(32)
  })
})

describe('what the room is told', () => {
  it('says how many recordings did not open, and that their places are kept', () => {
    expect(benchTroubleText({ kind: 'takes', unloaded: 1, gone: 0 })).toBe(
      '1 recording on your loop could not be opened — its place is kept.',
    )
    expect(benchTroubleText({ kind: 'takes', unloaded: 3, gone: 0 })).toBe(
      '3 recordings on your loop could not be opened — their places are kept.',
    )
  })

  it('and says so when one is gone rather than pretending it is still there', () => {
    expect(benchTroubleText({ kind: 'takes', unloaded: 0, gone: 2 })).toBe(
      '2 recordings on your loop are no longer in this browser.',
    )
  })

  it('and never answers a trouble with an empty line', () => {
    const all: BenchTrouble[] = [
      { kind: 'takes', unloaded: 1, gone: 1 },
      { kind: 'unsaved' },
      { kind: 'left' },
    ]
    for (const t of all) expect(benchTroubleText(t).length).toBeGreaterThan(20)
  })
})

/**
 * ⚠️ THE WIRING, ASKED IN NODE — WHICH HAS NO IndexedDB, AND THAT IS THE POINT. A browser whose
 * recordings store will not open (private mode, a blocked setting) is one of the cases this has
 * to be honest about, and node is that browser exactly: `db()` answers null, `placeTake` answers
 * false, and `hasTake` answers null rather than false. Everything else is real — the real looper,
 * the real parser — with only the two browser globals stood in.
 *
 * Each test gets a fresh module graph, because `openWorkbench` restores once per page by design
 * and the page here is the module.
 */
describe('putting a bench back, when something will not cooperate', () => {
  const disk = new Map<string, string>()
  const on: Record<string, () => void> = {}
  let refuseWrites = false

  beforeEach(() => {
    disk.clear()
    refuseWrites = false
    vi.resetModules()
    vi.stubGlobal('window', {
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
      addEventListener: (type: string, f: () => void) => void (on[type] = f),
    })
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (refuseWrites) throw new Error('QuotaExceededError')
        disk.set(k, v)
      },
      removeItem: (k: string) => void disk.delete(k),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  const KEY = 'inst_work_v1'
  /** what the page would have written before the reload */
  const saved = () => JSON.stringify(packWork(bench()))
  const open = async () => {
    const wb = await import('./workbench')
    const lp = await import('./looper')
    const heard: BenchTrouble[] = []
    wb.openWorkbench((t) => heard.push(t))
    return { lp, heard }
  }
  /** the page going away — writes whatever is still settling, without waiting for it */
  const leave = () => on.pagehide?.()
  const settle = () => new Promise((r) => setTimeout(r, 20))

  it('puts the layers and the transport back even when the recordings will not open', async () => {
    disk.set(KEY, saved())
    const { lp } = await open()
    expect(lp.loopState().bpm).toBe(140)
    expect(lp.loopState().bars).toBe(4)
    expect(lp.loopState().layers.map((l) => l.instrument)).toEqual(['drums'])
  })

  it('and says the recording did not open, rather than leaving it silently off the loop', async () => {
    disk.set(KEY, saved())
    const { lp, heard } = await open()
    await settle()
    expect(lp.loopState().takes).toHaveLength(0)
    expect(heard).toEqual([{ kind: 'takes', unloaded: 1, gone: 0 }])
  })

  it('and keeps its place on disk through the next change, so nothing is lost', async () => {
    disk.set(KEY, saved())
    const { lp } = await open()
    await settle()
    lp.setBpm(120)
    leave()
    const after = JSON.parse(disk.get(KEY)!)
    expect(after.bpm).toBe(120)
    expect(after.takes).toEqual(packWork(bench()).takes)
  })

  it('leaves a bench it cannot read exactly as it was, and says so', async () => {
    for (const unreadable of ['{"v":2,"bpm":90}', 'not json at all', '[]']) {
      disk.clear()
      vi.resetModules()
      disk.set(KEY, unreadable)
      const { lp, heard } = await open()
      expect(heard).toEqual([{ kind: 'left' }])
      lp.setBpm(150)
      leave()
      expect(disk.get(KEY)).toBe(unreadable)
    }
  })

  it('and Clear all reaches the disk, so a reload does not put back what was cleared', async () => {
    disk.set(KEY, JSON.stringify(packWork(bench({ takes: [] }))))
    const { lp } = await open()
    expect(lp.loopState().layers).toHaveLength(1)
    lp.clearLayers()
    leave()
    expect(disk.has(KEY)).toBe(false)
  })

  it('and Clear all keeps the place of a recording that would not open, because that is not a layer', async () => {
    disk.set(KEY, saved())
    const { lp } = await open()
    await settle()
    lp.clearLayers()
    leave()
    expect(JSON.parse(disk.get(KEY)!).takes.map((t: { id: string }) => t.id)).toEqual(['take-a'])
  })

  it('will not write over a saved bench it declined to put back', async () => {
    /* nothing on a fresh page can do this today — the guard is for the day something can */
    disk.set(KEY, saved())
    const before = disk.get(KEY)
    const lp = await import('./looper')
    lp.addEmptyLayer('keys')
    const wb = await import('./workbench')
    const heard: BenchTrouble[] = []
    wb.openWorkbench((t) => heard.push(t))
    expect(heard).toEqual([{ kind: 'left' }])
    lp.setBpm(77)
    leave()
    expect(disk.get(KEY)).toBe(before)
  })

  it('says once when a change does not reach the disk, and leaves the last good copy alone', async () => {
    disk.set(KEY, saved())
    const before = disk.get(KEY)
    const { lp, heard } = await open()
    await settle()
    refuseWrites = true
    lp.setBpm(110)
    leave()
    lp.setBpm(100)
    leave()
    expect(heard.filter((t) => t.kind === 'unsaved')).toHaveLength(1)
    expect(disk.get(KEY)).toBe(before)
  })
})
