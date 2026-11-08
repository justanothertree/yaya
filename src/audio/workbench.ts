import { CHOP_RATES, CHOP_SHAPES, type Chop, type ChopShape } from './chop'
import {
  loadSong,
  loopState,
  muteTake,
  placeTake,
  subscribeLoop,
  takeChop,
  takeFx,
  type Layer,
  type SongTake,
} from './looper'
import { keptAt } from '../library/kept'
import { packSong, readSong, songToLayers, toSong, type PackedSong } from './songFile'
import { hasTake, TAKE_MAX_SECONDS } from './takes'
import { type VoiceFx } from './takeFx'

/**
 * What you are working on, kept across a refresh.
 *
 * ⚠️ IT WAS NEVER KEPT, AND THAT IS THE BUG THIS FILE IS. The looper's state is a module-level
 * object and nothing wrote it anywhere, so an arrangement survived walking to another room —
 * the module is never unloaded — and died on a reload, which makes a new one. Reproduced on
 * 7 Nov 2026: three layers with their gains, mutes, plans and instruments, plus a placed
 * recording, came back byte for byte after Instrument → Games → Home → Instrument, and came
 * back as **nothing** after pressing reload. The tempo and the bar count went with them, which
 * the first reading missed because 96 and 2 are also the defaults — the measurement only meant
 * something once the same run was done again at 140 and 4.
 *
 * ⚠️ AND THE ROOM ALREADY REMEMBERED NINE OTHER THINGS, which is what made it read as a fault
 * rather than as a limit. Instrument, octave, scale, root, chord, strum, arpeggio, swing and
 * lead-back all come back; so do your saved rigs, your recordings, and the edit history on each
 * recording. Measured in the same run: the take's 264,644 bytes and its two-step history were
 * identical either side of the reload. The one thing that did not survive was the song.
 *
 * ⚠️ THIS IS A CACHE, AND THE LIBRARY IS STILL THE COPY THAT MATTERS. Nothing here may ever
 * stand between somebody and a thing they kept on purpose: every path below either writes this
 * one key or leaves everything alone, and the worst failure available to it is an instrument
 * that behaves exactly as it did before this file existed.
 */

const KEY = 'inst_work_v1'

/**
 * How many placed recordings are carried across.
 *
 * ⚠️ A BOUND ON A PARSER, which is the only reason there is a number here at all. This reads
 * localStorage, and localStorage is editable by anything on this origin — so the list becomes a
 * loop bound and a pile of decoded AudioBuffers, exactly as songFile.ts bounds every count it
 * reads. The same number caps the write, so the reader can never be stricter than the writer: a
 * cap only one side knows about is a silent truncation that shows up as a missing part.
 *
 * Thirty-two is far past anything this room produces — the takes store holds 16MB in all, and a
 * song here is a voice over a few parts rather than a wall of them.
 */
const MAX_PLACED = 32

/** An id out of IndexedDB. Long enough for `${Date.now()}-${random}` and nothing else. */
const MAX_ID = 64

/** How long a burst of changes may settle before it costs a write. */
const SETTLE_MS = 400

/**
 * A placed recording as it comes back off the key.
 *
 * ⚠️ PARTIALS, AND NOT BECAUSE THE READER IS LAZY. `takeFx` merges onto PLAIN_VOICE and
 * `takeChop` merges onto NO_CHOP, so naming only the fields that survived validation is what
 * those two functions are built to be given. Typing it as a whole `VoiceFx` would be a lie
 * about a value with holes in it, and the lie would be believed by whoever reads it next.
 */
export type PlacedTake = {
  id: string
  at: number
  muted?: boolean
  fx?: Partial<VoiceFx>
  chop?: Partial<Chop>
}

/** The live bench — the part of the looper's state that is worth writing down. */
export type Bench = {
  bpm: number
  bars: number
  layers: Layer[]
  takes: SongTake[]
  /**
   * Saved placements that are not on the loop because their recording could not be opened.
   *
   * ⚠️ WRITTEN DOWN ALONGSIDE THE LIVE ONES, OR A BAD MOMENT BECOMES A DELETION. The bench is
   * rewritten from the looper on every change, and a recording that failed to load is not on the
   * looper — so without this, a browser that would not open IndexedDB for one visit (private
   * mode, a blocked setting, a failed transaction) erased the place of every voice take on the
   * next keypress, and the recording would come back on a better day with nowhere to go.
   */
  carried?: PlacedTake[]
}

/** A bench read back off the key, ready to be put onto the looper. */
export type Restored = {
  bpm: number
  bars: number
  layers: Layer[]
  takes: PlacedTake[]
}

/**
 * ⚠️ `bpm` AND `bars` LIVE HERE AND NOT IN THE SONG, although packSong writes a copy of both.
 * A bench with no layers still has a tempo — place a voice take over nothing and that is the
 * whole arrangement — and `readSong` answers null when there are no layers, so the song is the
 * wrong place to keep the transport. Only this pair is ever read; the song's copy is never
 * looked at, so there is nothing for the two to disagree about.
 */
export type StoredWork = {
  v: 1
  bpm: number
  bars: number
  /** the note layers, in the song format — absent when there are none */
  song?: PackedSong
  takes?: PlacedTake[]
}

/**
 * Write down what is on the bench.
 *
 * ⚠️ A LAYER SOMEBODY ELSE RECORDED IS NOT WRITTEN, and `from` is how you tell. The Layer type
 * already says it of a song file — "a song you kept from a jam is yours, and re-opening it
 * should not leave parts belonging to somebody who is not in the room" — and a reload is that
 * argument at its strongest: the call is over, the peer is gone, and putting their bassline
 * back would leave a part on the bench that nobody present can explain or ever hear again.
 */
export function packWork(bench: Bench): StoredWork {
  const mine = bench.layers.filter((l) => !l.from)
  const out: StoredWork = { v: 1, bpm: bench.bpm, bars: bench.bars }
  /* toSong drops `from` and `shared` by listing the fields it writes; the filter above decides
     which layers go at all, which is a different question and not one toSong is asked. */
  if (mine.length) out.song = packSong(toSong('', bench.bpm, bench.bars, mine))
  /* the loop's own placements first, then whatever is still waiting for its recording — and a
     carried one that has since been placed is the loop's, so it is not written twice */
  const live = new Set(bench.takes.map((t) => t.id))
  const takes: PlacedTake[] = [
    ...bench.takes,
    ...(bench.carried ?? []).filter((t) => !live.has(t.id)),
  ]
  if (takes.length) {
    out.takes = takes.slice(0, MAX_PLACED).map((t) => ({
      id: t.id,
      at: t.at,
      ...(t.muted ? { muted: true } : {}),
      ...(t.fx ? { fx: t.fx } : {}),
      ...(t.chop ? { chop: t.chop } : {}),
    }))
  }
  return out
}

/** Finite, or nothing — never a default, so the caller decides what a missing number means. */
const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * ⚠️ FIELDS ARE DROPPED RATHER THAN CLAMPED, and that is not laziness about ranges. Both of
 * these settings are already clamped totally where they are used: `voiceTargets` in takeFx.ts
 * pulls all six of a VoiceFx into range in the audio thread and says out loud that it is total,
 * and chop.ts runs `amount` through clamp01 everywhere it reads it. Writing those ranges again
 * here would be a second copy of a rule that is free to drift from the first, which is how a
 * control ends up offering a value the signal refuses.
 *
 * What neither of them can do is notice a value that is not a number at all. That one reaches a
 * slider and renders as NaN, which no clamp downstream ever sees — so the question asked here is
 * only "is this a number", and the ranges stay where they belong.
 */
function readVoiceFx(v: unknown): Partial<VoiceFx> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const out: Partial<VoiceFx> = {}
  for (const k of ['tone', 'squeeze', 'double', 'echo', 'echoTime', 'space'] as const) {
    const n = fin(o[k])
    if (n !== null) out[k] = n
  }
  return Object.keys(out).length ? out : undefined
}

function readChop(v: unknown): Partial<Chop> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const out: Partial<Chop> = {}
  if (typeof o.shape === 'string' && CHOP_SHAPES.includes(o.shape as ChopShape))
    out.shape = o.shape as ChopShape
  const rate = fin(o.rate)
  if (rate !== null && CHOP_RATES.includes(rate)) out.rate = rate
  const amount = fin(o.amount)
  if (amount !== null) out.amount = amount
  return Object.keys(out).length ? out : undefined
}

function readTakes(v: unknown): PlacedTake[] {
  if (!Array.isArray(v)) return []
  const out: PlacedTake[] = []
  const seen = new Set<string>()
  for (const raw of v.slice(0, MAX_PLACED)) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id || o.id.length > MAX_ID) continue
    /* ⚠️ one placement per recording, because one is all the looper can hold: `placeTake` keys
       on the id and MOVES an existing placement rather than adding a second. Two entries for one
       id would read as two takes here and be one take on the loop — a list that disagrees with
       the room from the moment it is put back. */
    if (seen.has(o.id)) continue
    const at = fin(o.at)
    /* a take is at most TAKE_MAX_SECONDS long, so nothing sensible starts further in than that */
    if (at === null || at < 0 || at > TAKE_MAX_SECONDS) continue
    seen.add(o.id)
    const fx = readVoiceFx(o.fx)
    const chop = readChop(o.chop)
    out.push({
      id: o.id,
      at,
      ...(o.muted === true ? { muted: true } : {}),
      ...(fx ? { fx } : {}),
      ...(chop ? { chop } : {}),
    })
  }
  return out
}

/**
 * Read a bench back.
 *
 * ⚠️ IT GOES THROUGH readSong LIKE EVERY OTHER WAY INTO THE SYNTH. This key is localStorage,
 * which is editable by anything running on this origin and by the person themselves, and what
 * comes out of it becomes oscillators — the same sentence library.ts writes about the library,
 * and it gets the same answer: the parser is the security boundary and this does not go round it.
 *
 * ⚠️ THE TRANSPORT IS NOT CLAMPED HERE, ON PURPOSE. `loadSong` already pulls bpm into 40..200
 * and bars into 1..MAX_BARS, and it is the only way either reaches the looper — so a clamp here
 * would be the same rule written twice, and the copy that drifts is always the one nothing runs.
 * What loadSong cannot do is notice `"fast"`: `Math.round` of that is NaN, and NaN comes through
 * Math.max and Math.min untouched. So this answers the question loadSong cannot, and leaves the
 * range to the function that owns it.
 *
 * @param now what the transport reads now, for a stored value that was not a number at all.
 */
export function readWork(raw: unknown, now: { bpm: number; bars: number }): Restored | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return null
  const song = readSong(o.song)
  return {
    bpm: fin(o.bpm) ?? now.bpm,
    bars: fin(o.bars) ?? now.bars,
    layers: song ? songToLayers(song) : [],
    takes: readTakes(o.takes),
  }
}

/* ───────────────────────────────── the wiring ───────────────────────────────── */

/**
 * What went wrong putting the bench back or keeping it written down, for the room to say.
 *
 * ⚠️ EVERY ONE OF THESE WAS A try/catch THAT SAID NOTHING, and in each case the silence was a
 * lie of a different shape: a voice take that would not load was simply not on the loop, a
 * write that hit a full disk looked exactly like one that landed, and a key this page could not
 * read would have been written over at the next keypress. `keptAt`'s note puts it plainly —
 * somebody told nothing and then losing their work has been misled by the silence.
 */
export type BenchTrouble =
  /** recordings that could not be opened (their places are kept), and ones no longer held */
  | { kind: 'takes'; unloaded: number; gone: number }
  /** a change did not reach this browser's storage */
  | { kind: 'unsaved' }
  /** a saved bench this page could not take, left exactly as it was */
  | { kind: 'left' }

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The sentence for a trouble — short, because it shares a line with "Kept “…”". */
export function benchTroubleText(t: BenchTrouble): string {
  if (t.kind === 'unsaved') return 'Your latest changes could not be saved in this browser.'
  if (t.kind === 'left')
    return 'Saved work here could not be opened, so it was left as it was. New changes will not be saved.'
  const parts: string[] = []
  if (t.unloaded)
    parts.push(
      `${counted(t.unloaded, 'recording', 'recordings')} on your loop could not be opened — ${
        t.unloaded === 1 ? 'its place is' : 'their places are'
      } kept.`,
    )
  if (t.gone)
    parts.push(
      `${counted(t.gone, 'recording', 'recordings')} on your loop ${
        t.gone === 1 ? 'is' : 'are'
      } no longer in this browser.`,
    )
  return parts.join(' ')
}

const disk = keptAt(KEY)
let watching = false
let restored = false
/**
 * This page does not write the key at all.
 *
 * ⚠️ SET WHEN THERE IS A SAVED BENCH THAT THIS PAGE DID NOT TAKE — one it could not read (a
 * newer format from a newer tab, or something hand-edited), or one it declined to restore
 * because the bench already had something on it. Either way the next write would replace a
 * saved arrangement nobody has seen, which is a deletion with extra steps. Not writing costs
 * this visit's changes their trip to disk, exactly as before this file existed, and the room
 * says so; writing over it would cost something nobody was told about.
 */
let frozen = false
/** saved placements waiting on a recording that would not open — see Bench.carried */
let carried: PlacedTake[] = []
/** whoever is listening — the room, while it is mounted */
let tell: ((t: BenchTrouble) => void) | null = null
/** so a disk that stays full says so once, not on every change */
let toldUnsaved = false
let timer = 0
/* ⚠️ IDENTITIES, NOT A SERIALISATION. `set` notifies on every scheduler tick while the loop
   plays, because `position` lives in the same object — so this subscriber runs tens of times a
   second and has to answer "did anything I write down change" without touching the layers. Every
   writer in looper.ts replaces the array rather than mutating it, which makes `===` the exact
   question rather than an approximation of it. */
let lastLayers: Layer[] | null = null
let lastTakes: SongTake[] | null = null
let lastBpm = 0
let lastBars = 0

/**
 * ⚠️ AN EMPTY BENCH IS WRITTEN DOWN TOO, AND REMOVING THE KEY IS HOW IT IS WRITTEN. "Clear all"
 * has to reach this file, or a reload puts back what somebody just deleted — which is a worse
 * bug than the one this fixes. So an empty bench is not "nothing to save", it is a saved
 * emptiness; the key goes rather than holding `{v:1,…}` so that somebody who never touches the
 * looper leaves nothing behind in their storage.
 */
function write() {
  if (frozen) return
  const s = loopState()
  let ok: boolean
  if (!s.layers.some((l) => !l.from) && !s.takes.length && !carried.length) {
    try {
      localStorage.removeItem(KEY)
      ok = true
    } catch {
      ok = false
    }
  } else {
    const bench: Bench = { bpm: s.bpm, bars: s.bars, layers: s.layers, takes: s.takes, carried }
    disk.put(JSON.stringify(packWork(bench)))
    ok = disk.landed()
  }
  if (ok) toldUnsaved = false
  else if (!toldUnsaved) {
    toldUnsaved = true
    tell?.({ kind: 'unsaved' })
  }
}

function schedule() {
  if (frozen) return
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = 0
    write()
  }, SETTLE_MS)
}

function flush() {
  if (!timer) return
  window.clearTimeout(timer)
  timer = 0
  write()
}

/**
 * ⚠️ ONE AT A TIME, AND AFTER THE LAYERS. `placeTake` decodes the recording out of IndexedDB
 * and builds a voice chain for it, so a handful at once is a handful of AudioBuffers arriving
 * together on a phone that has just finished loading a page. Sequencing them costs nothing
 * anybody can perceive — the room is already on screen, because none of this is awaited — and
 * the memory then arrives at the rate it did when the takes were placed by hand.
 *
 * ⚠️ A RECORDING THAT WILL NOT OPEN KEEPS ITS PLACE, AND ONLY ONE THAT IS GONE LOSES IT.
 * `placeTake` answers false for both, and they are opposite cases: a store that would not open
 * or a file this browser cannot decode is a bad moment, and the bytes may be fine tomorrow —
 * while a store that opened, looked, and holds no such row has nothing to come back. `hasTake`
 * tells them apart, and only a definite `false` lets a placement go.
 */
async function putTakesBack(takes: PlacedTake[]) {
  let unloaded = 0
  let gone = 0
  for (const t of takes) {
    if (await placeTake(t.id, t.at)) {
      carried = carried.filter((c) => c.id !== t.id)
      if (t.fx) takeFx(t.id, t.fx)
      if (t.chop) takeChop(t.id, t.chop)
      if (t.muted) muteTake(t.id)
      continue
    }
    if ((await hasTake(t.id)) === false) {
      carried = carried.filter((c) => c.id !== t.id)
      gone++
    } else unloaded++
  }
  /* the looper did not change when a placement was let go, so nothing else would write it */
  if (gone) schedule()
  if (unloaded || gone) tell?.({ kind: 'takes', unloaded, gone })
}

function restore() {
  const now = loopState()
  let raw: string | null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    /* storage will not even read — there is nothing here to protect, and if it will not write
       either, the first write says so */
    return
  }
  if (raw === null) return
  let work: Restored | null = null
  try {
    work = readWork(JSON.parse(raw), now)
  } catch {
    work = null
  }
  if (!work || now.layers.length || now.takes.length) {
    frozen = true
    tell?.({ kind: 'left' })
    return
  }
  loadSong(work.bpm, work.bars, work.layers)
  carried = [...work.takes]
  void putTakesBack(work.takes)
}

/**
 * Keep the bench written down, and put the last one back.
 *
 * ⚠️ IDEMPOTENT, BECAUSE THE ROOM MOUNTS MORE THAN ONCE. StrictMode runs an effect twice in
 * development, the visualiser can put a second copy of the room on the canvas, and walking out
 * and back mounts it again — none of which is a reason to restore a second time over whatever is
 * on the bench by then.
 *
 * ⚠️ AND IT RESTORES ONLY ONTO AN EMPTY BENCH. On a page that has just loaded, nothing but this
 * room can put anything on the looper — the jam is only imported here — so today that is always
 * the case; the guard is for the day it is not, and it freezes rather than overwrites.
 *
 * @returns a cleanup that stops this caller hearing about trouble, for the effect to hand back.
 */
export function openWorkbench(onTrouble?: (t: BenchTrouble) => void): () => void {
  const mine = onTrouble ?? null
  tell = mine
  if (!watching) {
    watching = true
    const at = loopState()
    lastLayers = at.layers
    lastTakes = at.takes
    lastBpm = at.bpm
    lastBars = at.bars
    subscribeLoop(() => {
      const s = loopState()
      if (
        s.layers === lastLayers &&
        s.takes === lastTakes &&
        s.bpm === lastBpm &&
        s.bars === lastBars
      )
        return
      lastLayers = s.layers
      lastTakes = s.takes
      lastBpm = s.bpm
      lastBars = s.bars
      schedule()
    })
    /* ⚠️ pagehide rather than beforeunload, for the reason useVisits gives: it fires when a
       phone puts the browser away, which is the commonest way a session ends there — and a
       settling write that never landed is a part somebody loses. */
    window.addEventListener('pagehide', flush)
  }
  if (!restored) {
    restored = true
    restore()
  }
  return () => {
    if (tell === mine) tell = null
  }
}
