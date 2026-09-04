import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  INSTRUMENTS,
  allNotesOff,
  stopLive,
  closeSynth,
  knob,
  onKnobChange,
  noteOff,
  noteOn,
  setKnob,
  type Fx,
  type InstrumentId,
  type Knob,
  drumName,
} from '../audio/synth'
import { applyFx, captureFx, makeInstKits, type InstKit } from '../audio/instKit'
import { KitBar } from '../ui/KitBar'
import { useTouchOnly } from '../ui/pointerKind'
import {
  healthOn,
  readHealth,
  resetHealth,
  startHealth,
  stopHealth,
  type AudioHealth,
} from '../audio/audioHealth'
import { onMixerChange, setVolume, volume } from '../audio/mixer'
import { PianoRoll } from './PianoRoll'
import { toSong, songNotes, songToLayers } from '../audio/songFile'
import {
  library,
  removeFromLibrary,
  saveToLibrary,
  subscribeLibrary,
  type LibraryItem,
} from '../audio/library'
import { remember } from '../audio/capture'
import { sharedCtx } from '../audio/context'
import { together } from '../party/together'
import { jam } from '../party/jam'
import { hueFor } from '../party/party'
import { useVoiceSession } from '../voice/useVoiceSession'
import {
  armRecord,
  cancelRecord,
  capture,
  clearLayers,
  loopState,
  removeLayer,
  setLayerFx,
  setLayerGain,
  loopLength,
  captureLast,
  loadSong,
  addLayers,
  clearLayerBars,
  addEmptyLayer,
  setBars,
  setBpm,
  setLayerInstrument,
  layerPlan,
  moveLayerBar,
  setMetronome,
  takeBars,
  toggleLayerSlot,
  setQuantize,
  startLoop,
  stopLoop,
  subscribeLoop,
  toggleMute,
  undoLast,
  seekTo,
} from '../audio/looper'

/**
 * Somewhere to play.
 *
 * Solo for now, and built so that playing together is an addition rather than a rewrite: every
 * press goes through `press`/`lift` with an id and a note, which is exactly the payload a peer
 * would send. When the room arrives, a remote note is the same two calls with a different id
 * prefix — see synth.ts on why events travel and audio does not.
 *
 * ⚠️ THE KEYBOARD IS THE INSTRUMENT, not a decoration on a picture of one. Computer keys, mouse
 * and touch all reach the same two functions, and a key that is held stays held: the common
 * shortcut of firing a fixed-length blip on keydown makes every patch sound identical and makes
 * the pad and the pluck indistinguishable, which is most of what a synth has to offer.
 */

/**
 * The FL Studio typing layout — four rows, two octaves.
 *
 * Two piano keyboards stacked: ZXCVBNM is the lower octave's white keys with SDGHJ as its black
 * ones, and QWERTYU sits an octave above with 234567 above that. Anyone who has used FL, Ableton
 * or a tracker already has this in their fingers, which is worth more than a layout I invent.
 *
 * ⚠️ LETTERS AND DIGITS ONLY, and nothing needing a modifier. Browsers own the modifier
 * combinations — ctrl+W closes the tab and no preventDefault can stop it — so a layout using any
 * of them would be a trap rather than a shortcut. The handler already bails on ctrl, meta and
 * alt. Deliberately no slash or apostrophe either: both open quick-find in Firefox.
 */
const KEY_MAP: Record<string, number> = {
  // lower octave — white keys on the bottom row, black keys on the home row
  z: 0,
  s: 1,
  x: 2,
  d: 3,
  c: 4,
  v: 5,
  g: 6,
  b: 7,
  h: 8,
  n: 9,
  j: 10,
  m: 11,
  ',': 12,
  // upper octave — white keys on the QWERTY row, black keys on the number row
  q: 12,
  '2': 13,
  w: 14,
  '3': 15,
  e: 16,
  r: 17,
  '5': 18,
  t: 19,
  '6': 20,
  y: 21,
  '7': 22,
  u: 23,
  i: 24,
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

/**
 * Scale lock — the thing that lets somebody who does not play still sound good.
 *
 * ⚠️ It remaps the KEYS, it does not filter the notes. Greying out the wrong keys would leave
 * gaps and still demand you know which ones to avoid; handing every key the next note of the
 * scale means there is no wrong key left to press. On Pentatonic in particular it is genuinely
 * hard to play something that sounds bad, which is the entire point of offering it.
 *
 * Chromatic is first and is the honest default: every semitone, black keys and all, exactly like
 * a piano. The others are for when you would rather noodle than practise.
 */
const SCALES: Array<[string, string, number[]]> = [
  ['chromatic', 'Chromatic', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
  ['major', 'Major', [0, 2, 4, 5, 7, 9, 11]],
  ['minor', 'Minor', [0, 2, 3, 5, 7, 8, 10]],
  ['penta', 'Pentatonic', [0, 2, 4, 7, 9]],
  ['blues', 'Blues', [0, 3, 5, 6, 7, 10]],
  ['dorian', 'Dorian', [0, 2, 3, 5, 7, 9, 10]],
]

/** The five things you can bend about the sound, as sliders rather than a patch editor. */
const KNOBS: Array<[Knob, string, string]> = [
  ['echo', 'Echo', 'How much of the note comes back'],
  ['echoTime', 'Echo time', 'How long before it does'],
  ['space', 'Space', 'The size of the room it is played in'],
  ['vibrato', 'Vibrato', 'A wobble in the pitch, like a singer'],
  /* the only one that is about PLAYING rather than about the sound, and it applies to all of
     them — see Fx.glide for why it lives with the effects rather than with the instruments */
  ['glide', 'Glide', 'Each note slides from the one before it'],
]
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)
const noteName = (midi: number) => NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)

/**
 * The saved rigs, built with the room's OWN scale list.
 *
 * ⚠️ passed in rather than duplicated inside the audio module. A second copy of SCALES is
 * a copy that goes stale the first time one is added, and a kit naming a scale the check has not
 * heard of quietly becomes Chromatic with nothing said.
 */
const instKits = makeInstKits(SCALES.map(([id]) => id))

const INST_KEY = 'instrument_v1'
const OCT_KEY = 'instrument_octave_v1'
const SCALE_KEY = 'instrument_scale_v1'
const ROOT_KEY = 'instrument_root_v1'

/** Two octaves, matching the four typing rows exactly so every key on screen has a key to press. */
const SPAN = 25

/**
 * One effect, as a slider.
 *
 * Reads the synth rather than holding the value, so the knob and the audio can never disagree —
 * and a value restored from a previous visit shows up here without being threaded through.
 */
function KnobRow({ k, label, hint }: { k: Knob; label: string; hint: string }) {
  const [v, setV] = useState(() => knob(k))
  // a saved rig moves the knobs without touching the slider, so follow the synth rather than
  // assume this control is the only thing that can change it
  useEffect(() => onKnobChange(() => setV(knob(k))), [k])
  return (
    <label className="appearance-slider inst-knob" title={hint}>
      <span className="muted">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={v}
        onChange={(e) => {
          const next = Number(e.target.value)
          setV(next)
          setKnob(k, next)
        }}
      />
      <span className="appearance-slider-val">{Math.round(v * 100)}</span>
    </label>
  )
}

/**
 * A layer's effects in a couple of words.
 *
 * Numbers would be honest and unreadable at this size — four percentages per row, in a list you
 * are scanning to find the bassline. The exact values are in the tooltip; this only has to be
 * enough to tell two layers apart at a glance.
 */
function fxWord(fx: Fx): string {
  const bits: string[] = []
  if (fx.echo > 0.02) bits.push('echo')
  if (fx.space > 0.25) bits.push('room')
  if (fx.vibrato > 0.02) bits.push('wobble')
  if (fx.glide > 0.02) bits.push('slide')
  return bits.length ? bits.join(' + ') : 'dry'
}

/**
 * The audio health strip, when localStorage.audio_debug is '1'.
 *
 * ⚠️ It reports the TWO THINGS THAT SOUND THE SAME AND ARE NOT. Clipping shows as `clip` rising
 * with peak pinned near 1; dropouts show as `late` rising with peak nowhere near it. Both were
 * zero on the machine this was written on while the fault was audible on a phone, which is
 * precisely why it has to run on the phone.
 */
function AudioHealthStrip() {
  const [h, setH] = useState<AudioHealth | null>(null)
  useEffect(() => {
    if (!healthOn()) return
    let alive = true
    void startHealth().then((ok) => {
      if (!ok || !alive) return
      setH(readHealth())
    })
    const t = window.setInterval(() => {
      if (alive) setH(readHealth())
    }, 1000)
    return () => {
      alive = false
      clearInterval(t)
      stopHealth()
    }
  }, [])
  if (!h) return null
  const bad = h.worst !== 'clean'
  return (
    <div className="inst-health" style={bad ? { color: '#f46b6b' } : undefined}>
      <div>
        <strong>{h.worst === 'clean' ? 'clean' : h.worst}</strong> · late {h.droppedTotal} · clip{' '}
        {h.clippedTotal} · peak max {h.peakMax}
        <button
          className="btn"
          onClick={() => {
            resetHealth()
            setH(readHealth())
          }}
          style={{ marginLeft: '0.4rem', padding: '0 0.35rem', fontSize: '0.7rem' }}
        >
          reset
        </button>
      </div>
      <div className="muted">
        buffer {h.bufferMs}ms · now: late {h.dropped} gaps {h.gaps} peak {h.peak} · voices{' '}
        {h.voices} · notes {h.on}/{h.off}
      </div>
    </div>
  )
}

export function InstrumentRoom() {
  const [inst, setInst] = useState<InstrumentId>(() => {
    try {
      const v = localStorage.getItem(INST_KEY)
      return INSTRUMENTS.some(([id]) => id === v) ? (v as InstrumentId) : 'keys'
    } catch {
      return 'keys'
    }
  })
  const [octave, setOctave] = useState(() => {
    const v = Number(localStorage.getItem(OCT_KEY))
    return Number.isFinite(v) && v >= 1 && v <= 6 ? v : 4
  })
  /**
   * ⚠️ WHETHER THE KEYS PLAY IS INVISIBLE, AND IT DECIDES WHAT TYPING DOES.
   *
   * Focus is the difference between a letter playing a note and a letter going into a box, and
   * nothing on screen said which was true — so "the keyboard stopped working" was really "focus
   * is somewhere that eats letters", with no way to tell from looking. It is a small light, and
   * it is the whole explanation.
   *
   * Watched on focusin/focusout at the document rather than on each control, because the answer
   * depends on wherever focus happens to be, including controls nobody has written yet.
   */
  const [keysLive, setKeysLive] = useState(true)
  useEffect(() => {
    const look = () => {
      const t = document.activeElement as HTMLElement | null
      const eats =
        !!t &&
        (t.isContentEditable ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          (t.tagName === 'INPUT' &&
            !['range', 'checkbox', 'radio', 'button', 'submit', 'color'].includes(
              (t as HTMLInputElement).type,
            )))
      setKeysLive(!eats)
    }
    look()
    document.addEventListener('focusin', look)
    document.addEventListener('focusout', look)
    return () => {
      document.removeEventListener('focusin', look)
      document.removeEventListener('focusout', look)
    }
  }, [])

  const [scale, setScale] = useState(() => {
    try {
      const v = localStorage.getItem(SCALE_KEY)
      return SCALES.some(([id]) => id === v) ? v! : 'chromatic'
    } catch {
      return 'chromatic'
    }
  })
  const [root, setRoot] = useState(() => {
    const v = Number(localStorage.getItem(ROOT_KEY))
    return Number.isFinite(v) && v >= 0 && v <= 11 ? v : 0
  })
  const [held, setHeld] = useState<number[]>([])
  const loop = useSyncExternalStore(subscribeLoop, loopState, loopState)
  const [vol, setVol] = useState(() => volume('instrument'))
  useEffect(() => onMixerChange(() => setVol(volume('instrument'))), [])

  /**
   * ⚠️ (octave + 1), not octave.
   *
   * MIDI note 60 — middle C — is named C4, and 60/12 is 5. The offset is the standard oddity of
   * the numbering, and getting it wrong is not subtle: the picker said 4 while every key on
   * screen was labelled C3, so the two controls openly disagreed about what octave you were in.
   */
  const base = (octave + 1) * 12

  /**
   * Which note the nth key plays.
   *
   * On Chromatic this is simply the nth semitone. On any other scale the keys become scale
   * DEGREES: key 0 is the root, key 1 the second note of the scale, and the octave rolls over
   * whenever the pattern runs out — so a five-note scale gives you five keys per octave and more
   * range across the same seventeen keys.
   */
  const degrees = SCALES.find(([id]) => id === scale)?.[2] ?? SCALES[0][2]
  const noteAt = useCallback(
    (i: number) => {
      if (scale === 'chromatic') return base + i
      const oct = Math.floor(i / degrees.length)
      return base + root + oct * 12 + degrees[i % degrees.length]
    },
    [scale, base, root, degrees],
  )
  // ⚠️ a ref as well as state: the key handlers are bound once and would otherwise capture the
  // instrument and octave from the render that installed them, so changing either mid-play would
  // be ignored until something else re-rendered
  const live = useRef({ inst, noteAt })
  live.current = { inst, noteAt }

  useEffect(() => {
    try {
      localStorage.setItem(INST_KEY, inst)
      localStorage.setItem(OCT_KEY, String(octave))
      localStorage.setItem(SCALE_KEY, scale)
      localStorage.setItem(ROOT_KEY, String(root))
    } catch {
      /* private mode — it still plays */
    }
  }, [inst, octave, scale, root])

  /**
   * Every note goes to the synth AND offers itself to the recorder.
   *
   * capture() is a no-op unless a take is running, so there is no "recording mode" branch here
   * and no way for the two to disagree about what you played — the sound you heard and the
   * events stored are produced by the same call.
   */
  /**
   * Jamming rides the call, so the control only exists while you are in one. Rendering a
   * disabled "Jam" button to someone playing alone would advertise a feature whose entry point
   * is somewhere else entirely — the call button, on another page.
   */
  const call = useVoiceSession()
  const jamming = useSyncExternalStore(jam.subscribe, jam.getState, jam.getState)
  useEffect(() => jam.start(), [])
  /**
   * ⚠️ Leaving the page must not leave your friends holding your notes. allNotesOff() silences
   * the synth locally, which does nothing for the note-ons already sitting in everyone else's
   * browser — those are only released by a message, and unmounting sends none.
   */
  useEffect(() => () => jam.setOn(false), [])
  /**
   * ⚠️ APPLIED ON ARRIVAL AS WELL AS ON CHANGE. Leaving this room switches jamming off — the
   * line above, and it is right, because nobody should keep sharing a room they walked out of.
   * That means "share everything" cannot be a thing you turn on once and forget: it has to be
   * re-applied every time you come back, or it would quietly stop being true the first time you
   * went to look at something else.
   */
  useEffect(() => {
    const apply = () => jam.setOn(together.getState().on)
    apply()
    return together.subscribe(apply)
  }, [])

  /** which layer's notes are open in the editor, if any */
  const [editing, setEditing] = useState<string | null>(null)
  /** the bar picked up and waiting to be put down — the touch half of drag and drop */
  const [lifted, setLifted] = useState<{ id: string; bar: number } | null>(null)
  /* a finger cannot start an HTML5 drag, so the tap-to-lift path is the real one on a phone */
  const touch = useTouchOnly()
  /** what Capture just did, shown briefly — it is otherwise a button with no visible effect */
  const [capMsg, setCapMsg] = useState<string | null>(null)
  const [libOpen, setLibOpen] = useState(false)
  const saved = useSyncExternalStore(subscribeLibrary, library, library)

  /**
   * Keeping something.
   *
   * A whole arrangement is a song; one layer is a loop. Same format either way — a loop is a
   * song with one layer — which is what lets a drum pattern you kept last week be dropped under
   * a bassline you are writing now.
   */
  const keep = (kind: 'song' | 'loop', layerId?: string) => {
    const name =
      window.prompt(kind === 'loop' ? 'Name this loop' : 'Name this song', '')?.trim() ?? ''
    if (!name) return
    const item = saveToLibrary(kind, toSong(name, loop.bpm, loop.bars, loop.layers, layerId))
    setCapMsg(item ? `Kept “${item.name}”` : 'Nothing to keep — record something first.')
    window.setTimeout(() => setCapMsg(null), 4000)
    if (item) setLibOpen(true)
  }

  /** midi number → the hue of whoever is holding it, for the keyboard below */
  const theirNotes = new Map<number, number>()
  for (const p of Object.values(jamming.players))
    for (const m of p.held) theirNotes.set(m, hueFor(p.id))

  const press = useCallback((id: string, midi: number) => {
    noteOn(id, live.current.inst, midi)
    capture(midi, true, live.current.inst)
    // ⚠️ the same call site as capture(), for the same reason: a no-op unless you are jamming,
    // so there is no mode branch here and no way for what you heard and what they heard to be
    // produced by different code
    jam.play(midi, true, live.current.inst)
    // …and into the rolling history, so Capture can find it later. Same funnel again: what you
    // heard, what they heard, what was recorded and what can be captured are one call site.
    remember(sharedCtx().currentTime, midi, true, live.current.inst)
    setHeld((h) => (h.includes(midi) ? h : [...h, midi]))
  }, [])

  /**
   * ⚠️ A POINTER OWNS EXACTLY ONE NOTE, and re-entering the key it already owns does
   * nothing.
   *
   * pointerenter used to call press() unconditionally whenever a button was down. That is right
   * for a mouse, which stays where you put it, and wrong for a finger, which does not: a fingertip
   * resting on a phone wobbles a pixel or two, and if it is anywhere near a key edge the browser
   * sends leave/enter/leave/enter for as long as you hold. Every one of those enters restarted the
   * voice. A held note was therefore not held at all — it was being retriggered tens of times a
   * second, which is heard as crackling rather than as repeated notes because each restart is only
   * a few milliseconds from the last.
   *
   * Keyed by pointerId rather than by midi, so two fingers on the same key are two voices and
   * neither steals the other's.
   */
  const owned = useRef(new Map<number, number>())
  const setOwned = useCallback(
    (pointerId: number, midi: number | null) => {
      const now = owned.current.get(pointerId)
      if (now === midi) return // the jitter case: same finger, same key, nothing to do
      if (now !== undefined) lift('p:' + pointerId, now)
      if (midi == null) owned.current.delete(pointerId)
      else {
        owned.current.set(pointerId, midi)
        press('p:' + pointerId, midi)
      }
    },
    // press and lift are stable useCallbacks with no deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /**
   * ⚠️ The end of a press is caught on WINDOW, not on the key.
   *
   * Capture is deliberately released so a press can slide between keys, which also means the
   * pointerup lands on whatever happens to be under the finger — and if that is the gap below the
   * keyboard, the key's own handler never runs and the note sounds forever. Listening at the top
   * means a finger that leaves the keys still ends its note.
   */
  useEffect(() => {
    const end = (e: PointerEvent) => setOwned(e.pointerId, null)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [setOwned])

  const lift = useCallback((id: string, midi: number) => {
    noteOff(id)
    capture(midi, false, live.current.inst)
    jam.play(midi, false, live.current.inst)
    remember(sharedCtx().currentTime, midi, false, live.current.inst)
    setHeld((h) => h.filter((m) => m !== midi))
  }, [])

  /**
   * Computer keyboard.
   *
   * ⚠️ `repeat` is ignored, or holding a key retriggers it forty times a second — which sounds
   * like a machine gun and steals every other voice. And the listener sits on window rather than
   * on a focused element so you can play while looking at the visualiser, but it bails out the
   * moment focus is in a text field, because otherwise typing your name plays a tune.
   */
  useEffect(() => {
    /**
     * ⚠️ "IS IT AN INPUT" WAS TOO BLUNT A QUESTION, and it cost you the keyboard.
     *
     * A range slider is an <input>, so nudging the volume left the keys dead until you clicked
     * the page again — the guard could not tell "somebody is typing words" from "somebody moved
     * a slider". The thing worth protecting against is TEXT ENTRY: typing your name should not
     * play a tune. A slider, a checkbox and a button take arrow keys and space, never letters,
     * so they can hold focus and let you keep playing.
     *
     * A <select> is listed because it does letter type-ahead of its own: pressing S while one is
     * focused jumps it to the next option starting with S, which is how choosing a key and then
     * playing changed the key underneath you.
     */
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) return false
      if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true
      if (t.tagName !== 'INPUT') return false
      const kind = (t as HTMLInputElement).type
      return !['range', 'checkbox', 'radio', 'button', 'submit', 'color'].includes(kind)
    }
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return
      const off = KEY_MAP[e.key.toLowerCase()]
      if (off === undefined) return
      e.preventDefault()
      press('k:' + e.key.toLowerCase(), live.current.noteAt(off))
    }
    const up = (e: KeyboardEvent) => {
      const off = KEY_MAP[e.key.toLowerCase()]
      if (off === undefined) return
      lift('k:' + e.key.toLowerCase(), live.current.noteAt(off))
    }
    // a key still down when the window loses focus never gets its keyup — that is the classic
    // stuck note, and it hangs until you press the same key again
    const blur = () => {
      stopLive()
      setHeld([])
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [press, lift])

  // leaving the page must not leave a note ringing forever
  useEffect(
    () => () => {
      stopLoop()
      closeSynth()
    },
    [],
  )

  const keys = Array.from({ length: SPAN }, (_, i) => noteAt(i))

  return (
    <section className="inst-wrap">
      <AudioHealthStrip />
      <div className="inst-bar">
        <div className="fx-style-row inst-picks">
          {INSTRUMENTS.map(([id, icon, name]) => (
            <button
              key={id}
              className={'fx-style-btn' + (inst === id ? ' is-on' : '')}
              aria-pressed={inst === id}
              onClick={() => {
                // ⚠️ stopLive, not allNotesOff: your held keys must let go of the old sound, but
                // a loop playing underneath is not yours to interrupt
                stopLive()
                setHeld([])
                setInst(id)
              }}
            >
              <span aria-hidden>{icon}</span>
              <span className="fx-style-label">{name}</span>
            </button>
          ))}
        </div>
        {/* ⚠️ NINE SETTINGS, of which the four that were already remembered are the four
            that matter least. The effects decide what an instrument SOUNDS like far more than the
            octave does, and they were the ones thrown away on every visit. A rig keeps all nine,
            so "keys, dry" and "keys, drenched in echo" become two things you can switch between
            rather than one thing you rebuild. */}
        <KitBar
          store={instKits}
          placeholder="Name this rig"
          capture={(name) => ({ name, inst, octave, scale, root, fx: captureFx() })}
          apply={(k: InstKit) => {
            stopLive()
            setHeld([])
            setInst(k.inst)
            setOctave(k.octave)
            setScale(k.scale)
            setRoot(k.root)
            applyFx(k.fx)
          }}
          describe={(k) =>
            [
              INSTRUMENTS.find(([id]) => id === k.inst)?.[2] ?? k.inst,
              SCALES.find(([id]) => id === k.scale)?.[1] ?? k.scale,
              fxWord(k.fx),
            ].join(' · ')
          }
        />
      </div>

      {call.inCall && (
        <div className="inst-row inst-jam">
          <button
            className={'btn' + (jamming.on ? ' is-on' : '')}
            aria-pressed={jamming.on}
            onClick={() => jam.setOn(!jamming.on)}
            title={
              jamming.on
                ? 'Stop sending your notes to the call'
                : 'Play together — everyone in the call hears what you play'
            }
          >
            {jamming.on ? '🎶 Jamming' : '🎶 Jam together'}
          </button>
          {jamming.on &&
            (Object.values(jamming.players).length ? (
              <span className="inst-jam-who">
                {Object.values(jamming.players).map((p) => (
                  <span
                    key={p.id}
                    className="inst-jam-player"
                    style={{ ['--party-hue' as string]: hueFor(p.id) }}
                  >
                    {p.name}
                  </span>
                ))}
              </span>
            ) : (
              <span className="muted">
                Nobody else is playing yet — they need to press Jam too.
              </span>
            ))}
        </div>
      )}

      <div className="inst-row">
        <span className="muted inst-oct">
          Octave
          <button
            className="btn"
            onClick={() => setOctave((o) => Math.max(1, o - 1))}
            disabled={octave <= 1}
            aria-label="Octave down"
          >
            −
          </button>
          <strong>{octave}</strong>
          <button
            className="btn"
            onClick={() => setOctave((o) => Math.min(6, o + 1))}
            disabled={octave >= 6}
            aria-label="Octave up"
          >
            +
          </button>
        </span>

        <label className="appearance-slider">
          <span className="muted">Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={vol}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVol(v)
              setVolume('instrument', v)
            }}
          />
          <span className="appearance-slider-val">{Math.round(vol * 100)}%</span>
        </label>
        {/* ⚠️ says what is true rather than what to do: the light is the explanation for why
            typing sometimes plays and sometimes does not */}
        <span
          className={'inst-keylight' + (keysLive ? ' is-live' : '')}
          title={
            keysLive
              ? 'Your computer keyboard plays notes'
              : 'Typing is going into a control — click the page to play with the keys again'
          }
        >
          <span aria-hidden>⌨</span>
          <span className="muted">{keysLive ? 'keys play' : 'keys off'}</span>
        </span>

        {/**
         * A stuck note is the one failure every synth has, and hunting for the key that caused
         * it is miserable. One button, always there.
         *
         * ⚠️ It STOPS THE LOOP as well as silencing the voices. Panic used to leave the
         * transport running, so the loop immediately scheduled the next repetition and whatever
         * you were panicking about came straight back — you had to hit it, then find Stop, and
         * in between the thing was still playing. "Make it stop" has one meaning.
         */}
        <button
          className="btn"
          onClick={() => {
            stopLoop()
            allNotesOff()
            setHeld([])
          }}
          title="Silence everything and stop the loop"
        >
          ⏹ Panic
        </button>
      </div>

      {/* What the keys mean. Chromatic is a piano; anything else turns the keyboard into scale
          degrees, so there is no wrong note left to press. */}
      <div className="inst-row">
        <label className="inst-pick">
          <span className="muted">Scale</span>
          <select
            value={scale}
            onChange={(e) => {
              stopLive()
              setHeld([])
              setScale(e.target.value)
              e.target.blur()
            }}
          >
            {SCALES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {/* only when it does something — a key picker on Chromatic would be a control that
            visibly changes nothing */}
        {scale !== 'chromatic' && (
          <label className="inst-pick">
            <span className="muted">Key</span>
            <select
              value={root}
              onChange={(e) => {
                stopLive()
                setHeld([])
                setRoot(Number(e.target.value))
                /* ⚠️ hand the keyboard back: a focused select eats letters as type-ahead, so
                   staying here would change the key again the moment you played a note */
                e.target.blur()
              }}
            >
              {NAMES.map((nm, i) => (
                <option key={nm} value={i}>
                  {nm}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* The looper. Play a pass, it repeats; play another, it stacks. */}
      {libOpen && (
        <div className="inst-row inst-library">
          {!saved.length ? (
            <span className="muted">
              Nothing kept yet. Record something, then <strong>Keep song</strong> — or keep a single
              layer with the ⬇ on its row and reuse it in a different song later.
            </span>
          ) : (
            <ul className="inst-lib-list">
              {saved.map((it: LibraryItem) => (
                <li key={it.id}>
                  <span className="inst-lib-name">
                    {it.kind === 'loop' ? '🔁' : '🎵'} {it.name}
                  </span>
                  <span className="muted inst-lib-meta">
                    {it.song.layers.length} layer{it.song.layers.length === 1 ? '' : 's'} ·{' '}
                    {songNotes(it.song)} notes · {it.song.bpm}bpm
                  </span>
                  {/* Two different verbs, and the distinction is the whole point of the library.
                      Open REPLACES what you have; Add brings this part in alongside it. */}
                  <button
                    className="btn"
                    onClick={() => {
                      loadSong(it.song.bpm, it.song.bars, songToLayers(it.song))
                      setEditing(null)
                      // ⚠️ offered, not pushed — see jam.offerSong. A no-op when nobody is jamming.
                      jam.offerSong(it.song)
                    }}
                    title="Open this, replacing what you have now"
                  >
                    Open
                  </button>
                  <button
                    className="btn"
                    onClick={() => addLayers(songToLayers(it.song))}
                    title="Add these layers to what you are working on"
                  >
                    + Add
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      if (window.confirm(`Delete “${it.name}”?`)) removeFromLibrary(it.id)
                    }}
                    title="Delete this"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {capMsg && (
        <p className="muted inst-capture-note" role="status">
          {capMsg}
        </p>
      )}
      <div className="inst-row inst-transport">
        <button
          className={'btn' + (loop.playing ? ' is-on' : '')}
          onClick={() => (loop.playing ? stopLoop() : startLoop())}
          title={loop.playing ? 'Stop the loop' : 'Start the loop'}
        >
          {loop.playing ? '⏹ Stop' : '▶ Play'}
        </button>

        {/**
         * Capture — Josh's idea, and the best one in the transport.
         *
         * ⚠️ It does not start anything. Everything you play is already in a rolling buffer, so
         * this asks "keep what just happened" rather than "start keeping things". The whole
         * value is that you decide AFTER hearing it, which is when you actually know.
         */}
        {/* Start a part by drawing it rather than by playing it. The editor was only reachable
            through a recording, which meant placing four notes by hand required performing them
            first. */}
        <button
          className="btn"
          onClick={() => setEditing(addEmptyLayer(live.current.inst))}
          title="Add an empty layer and draw notes into it"
        >
          ✎ New part
        </button>
        <button
          className={'btn' + (libOpen ? ' is-on' : '')}
          aria-pressed={libOpen}
          onClick={() => setLibOpen((v) => !v)}
          title="Songs and loops you have kept"
        >
          📁 Library{saved.length ? ` · ${saved.length}` : ''}
        </button>
        <button
          className="btn"
          disabled={!loop.layers.length}
          onClick={() => keep('song')}
          title="Keep this whole arrangement"
        >
          ⬇ Keep song
        </button>
        <button
          className="btn"
          onClick={() => {
            const r = captureLast()
            setCapMsg(
              !r.ok
                ? 'Nothing to capture yet — play something first.'
                : r.tempoSet
                  ? `Captured ${r.notes} notes · tempo set to ${r.bpm} from your playing`
                  : `Captured ${r.notes} notes`,
            )
            window.setTimeout(() => setCapMsg(null), 4000)
          }}
          title="Keep the last loop's worth of what you just played — no need to have been recording"
        >
          ⧉ Capture
        </button>
        <button
          className={
            'btn inst-rec' + (loop.recording ? ' is-rec' : loop.waiting ? ' is-armed' : '')
          }
          onClick={() => (loop.waiting || loop.recording ? cancelRecord() : armRecord())}
          title="Record a pass — it starts at the top of the loop"
        >
          {loop.recording
            ? loop.replacing
              ? '⏺ Replacing'
              : '⏺ Recording'
            : loop.waiting
              ? // ⚠️ Only the last bar gets a number, because only the last bar gets clicks.
                // Arming early in a long loop can be eight beats away, and counting "8…7…6" at
                // somebody is not a count-in — it is a wait. The clicks and the digits describe
                // the same four beats.
                loop.countIn && loop.countIn <= 4
                ? `⏳ ${loop.countIn}…`
                : '⏳ Armed…'
              : '⏺ Record'}
        </button>

        <button
          className={'btn' + (loop.metronome ? ' is-on' : '')}
          aria-pressed={loop.metronome}
          onClick={() => setMetronome(!loop.metronome)}
          title="Click on every beat"
        >
          🎯 Click
        </button>

        <label className="inst-pick">
          <span className="muted">BPM</span>
          <input
            className="inst-num"
            type="number"
            min={40}
            max={200}
            value={loop.bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
          />
        </label>

        <label className="inst-pick">
          <span className="muted">Bars</span>
          <input
            className="inst-num"
            type="number"
            min={1}
            max={32}
            value={loop.bars}
            onChange={(e) => setBars(Number(e.target.value))}
          />
        </label>

        {/* Snapping is on by default at eighths. Nobody playing into a loop for fun wants their
            first take to expose exactly how far off the beat they were, and Off is one click
            away for anyone who does. */}
        <label className="inst-pick">
          <span className="muted" title="Snap what you play to the grid">
            Snap
          </span>
          <select value={loop.quantize} onChange={(e) => setQuantize(Number(e.target.value))}>
            <option value={0}>Off</option>
            <option value={4}>1/4</option>
            <option value={8}>1/8</option>
            <option value={16}>1/16</option>
          </select>
        </label>

        {loop.layers.length > 0 && (
          <button className="btn" onClick={undoLast} title="Take back the last thing you recorded">
            ↶ Undo take
          </button>
        )}
      </div>

      {/* the playhead — a bar you can glance at rather than count against */}
      {loop.playing && (
        <div className="inst-playhead" aria-hidden>
          <span style={{ width: `${Math.round(loop.position * 100)}%` }} />
        </div>
      )}

      {jamming.offer && (
        /**
         * ⚠️ A CHOICE, not a notification. Taking it replaces every layer you have, which is
         * the one thing a message from somebody else must never do on its own — so the button
         * says what it will cost and the other one simply makes it go away.
         */
        <p className="inst-offer">
          <strong>{jamming.offer.from === 'me' ? 'You' : jamming.offer.name}</strong> opened “
          {jamming.offer.song.name}” — {jamming.offer.song.layers.length} part
          {jamming.offer.song.layers.length === 1 ? '' : 's'}
          <button
            className="btn"
            onClick={() => {
              const o = jamming.offer
              if (!o) return
              loadSong(o.song.bpm, o.song.bars, songToLayers(o.song))
              jam.clearOffer()
            }}
            title="Replaces the parts you have now"
          >
            Load it
          </button>
          <button className="btn btn-ghost" onClick={() => jam.clearOffer()}>
            No thanks
          </button>
        </p>
      )}

      {/**
       * ⚠️ THE BAR NUMBERS, AND THE WAY TO JUMP TO ONE.
       *
       * The tiles below say which bars a layer plays, but nothing said WHICH bar you were
       * looking at — you counted along the row. This is the same cell width as a tile, so a
       * number sits directly above its column, and clicking one moves the playhead there.
       *
       * Seeking is here rather than on the tiles because a tile already means two things — turn
       * this bar off, or pick it up and move it — and a third would make every click a guess.
       * The ruler has nothing else to do.
       */}
      {loop.layers.length > 0 && loop.bars > 1 && (
        <div className="inst-ruler" role="group" aria-label="Jump to a bar">
          {Array.from({ length: loop.bars }, (_, b) => {
            const at = (loopLength() * b) / Math.max(1, loop.bars)
            const now = Math.floor(loop.position * loop.bars) === b
            return (
              <button
                key={b}
                className={'inst-ruler-cell' + (now && loop.playing ? ' is-now' : '')}
                onClick={() => seekTo(at)}
                title={`Jump to bar ${b + 1}`}
              >
                {(b + 1) % 4 === 1 ? b + 1 : '·'}
              </button>
            )
          })}
        </div>
      )}
      {loop.layers.length > 0 && (
        <ul className="inst-layers">
          {loop.layers.map((l, i) => (
            <li
              key={l.id}
              className={
                (l.muted ? 'is-muted' : '') + (loop.replacing === l.id ? ' is-replacing' : '')
              }
            >
              {/**
               * ⚠️ THE NAME IS THE SWITCH, and there is no pencil any more.
               *
               * Editing a take was behind a ✎ next to five other small buttons, which is a lot of
               * looking for the thing you most want to do with a layer. The row already names the
               * layer and counts its notes — "3. 14 notes" is exactly the handle for "show me
               * those fourteen notes", so it may as well be the control. Pressing the open one
               * again closes it, because a toggle you cannot un-toggle is a trap.
               */}
              <button
                className={'inst-layer-name' + (editing === l.id ? ' is-open' : '')}
                aria-expanded={editing === l.id}
                onClick={() => setEditing((e) => (e === l.id ? null : l.id))}
                title={editing === l.id ? 'Hide these notes' : 'Show these notes'}
              >
                {i + 1}.<span className="muted"> {l.events.filter((e) => e.on).length} notes</span>
              </button>

              {/* Re-voice without replaying: the notes were right, the sound was not. Storing
                  notes rather than audio is what makes this a dropdown instead of a re-take. */}
              <select
                className="inst-layer-inst"
                value={l.instrument}
                onChange={(e) => setLayerInstrument(l.id, e.target.value as InstrumentId)}
                title="Play this take on a different instrument"
              >
                {INSTRUMENTS.map(([id, , name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>

              {/**
               * What this take SOUNDS like, and a way to change your mind.
               *
               * The settings are frozen onto the layer when you commit it, which is the whole
               * point — but frozen with no way back would mean replaying a part you were happy
               * with just to give it more room. This shows what it kept and re-stamps the
               * current knobs onto it, so changing the reverb costs a click rather than a
               * performance.
               */}
              {/**
               * The arrangement: which bars this layer plays in.
               *
               * ⚠️ Every bar is ON until you turn one off, so a take you just recorded behaves
               * exactly as it always did and structure is something you opt into. This is the
               * difference between a stack of loops all playing at once and a track — the
               * tiling underneath already repeats a one-bar drum part across thirty-two bars,
               * so the only thing missing was a way to say "not here".
               */}
              {/**
               * The track: a row of bars you can put in an order.
               *
               * ⚠️ EACH CELL NAMES THE BAR IT PLAYS, not merely whether it plays. That one
               * change is what turns a mute strip into an arrangement — "bar 3 of this take
               * sounds here" can be moved, where "on" can only be switched off.
               *
               * Two ways to move one, because they suit different hands. Dragging is what a
               * mouse expects. On a touchscreen an HTML5 drag never starts, so a tap picks a
               * bar up and a second tap puts it down — which also happens to be easier than
               * dragging on a small screen even where dragging works.
               */}
              <span className="inst-arrange" role="group" aria-label="The bars this layer plays">
                {layerPlan(l).map((src, b) => {
                  /* has this layer actually been rearranged, or is it just playing in order? */
                  const arranged = !!l.plan
                  const held = lifted?.id === l.id && lifted.bar === b
                  return (
                    <button
                      key={b}
                      className={
                        'inst-bar-cell' + (src != null ? ' is-on' : '') + (held ? ' is-lifted' : '')
                      }
                      aria-pressed={src != null}
                      draggable={!touch && src != null}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/bar', String(b))
                        setLifted({ id: l.id, bar: b })
                      }}
                      onDragOver={(e) => {
                        if (e.dataTransfer.types.includes('text/bar')) e.preventDefault()
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        const from = Number(e.dataTransfer.getData('text/bar'))
                        if (Number.isFinite(from)) moveLayerBar(l.id, from, b)
                        setLifted(null)
                      }}
                      onDragEnd={() => setLifted(null)}
                      onClick={() => {
                        if (lifted && lifted.id === l.id) {
                          if (lifted.bar === b) toggleLayerSlot(l.id, b)
                          else moveLayerBar(l.id, lifted.bar, b)
                          setLifted(null)
                        } else if (src == null) {
                          toggleLayerSlot(l.id, b)
                        } else {
                          setLifted({ id: l.id, bar: b })
                        }
                      }}
                      title={
                        src == null
                          ? `Bar ${b + 1}: silent — tap to fill it`
                          : lifted && lifted.id === l.id
                            ? `Put bar ${lifted.bar + 1} here`
                            : `Bar ${b + 1} plays part ${src + 1} of ${takeBars(l)} — tap to pick it up`
                      }
                    >
                      {/**
                       * ⚠️ QUIET UNTIL IT HAS SOMETHING TO SAY. Numbering every cell made the
                       * common case harder to read: a take that plays straight through says
                       * 1 2 3 4, which is four numbers to tell you nothing happened. So a layer
                       * nobody has rearranged looks exactly as it always did — a row of blocks,
                       * on or off — and the numbers appear only once the order stops being the
                       * obvious one, which is the only time they explain anything.
                       */}
                      {arranged ? (src == null ? '·' : src + 1) : ''}
                    </button>
                  )
                })}
                {(l.play || l.plan) && (
                  <button
                    className="btn inst-bar-all"
                    onClick={() => clearLayerBars(l.id)}
                    title="Play in every bar again"
                  >
                    all
                  </button>
                )}
              </span>

              {/* Keeping ONE layer. This is the drum-loop case: a part worth reusing is almost
                  never a whole song, and a library of one-layer loops is what makes the next
                  song faster to start than the last one. */}
              <button
                className="btn"
                onClick={() => keep('loop', l.id)}
                title="Keep this layer as a loop you can reuse"
              >
                ⬇
              </button>

              {/* ⚠️ On the row, not behind a dialog. Balancing parts is done BY EAR, which means
                  moving one while the others play — a slider you have to open something to reach
                  is a slider you use once and then stop using. */}
              <label className="inst-layer-vol" title="How loud this layer is">
                <span className="sr-only">Layer volume</span>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={l.gain ?? 1}
                  onChange={(e) => setLayerGain(l.id, Number(e.target.value))}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </label>
              <button
                className="btn inst-layer-fx"
                onClick={() => setLayerFx(l.id)}
                title={
                  `This layer plays with echo ${Math.round(l.fx.echo * 100)}, ` +
                  `space ${Math.round(l.fx.space * 100)}, ` +
                  `vibrato ${Math.round(l.fx.vibrato * 100)}. ` +
                  'Click to give it the settings you have now.'
                }
              >
                {fxWord(l.fx)}
              </button>

              {/* The third way to fix a take, after undo and re-voice: play it again over the
                  top. The layer keeps its place in the stack rather than jumping to the end. */}
              <button
                className="btn"
                onClick={() => armRecord(l.id)}
                title="Record this layer again, keeping its place"
              >
                ⏺
              </button>
              <button className="btn" onClick={() => toggleMute(l.id)} title="Mute this layer">
                {l.muted ? '🔇' : '🔊'}
              </button>
              <button className="btn" onClick={() => removeLayer(l.id)} title="Delete this layer">
                ✕
              </button>
            </li>
          ))}
          {/* Outside the row it belongs to: a grid this wide inside a flex row would either
              squash the row or overflow it, and it reads better as a panel under the stack
              anyway — the list stays a list. */}
          {editing &&
            (() => {
              const l = loop.layers.find((x) => x.id === editing)
              if (!l) return null
              return (
                <li className="inst-roll-host">
                  <PianoRoll
                    layer={l}
                    bpm={loop.bpm}
                    quantize={loop.quantize}
                    position={loop.position}
                    loopLen={loopLength()}
                    held={held}
                    onClose={() => setEditing(null)}
                  />
                </li>
              )
            })()}
          <li className="inst-layers-all">
            <button className="btn" onClick={clearLayers}>
              Clear all
            </button>
          </li>
        </ul>
      )}

      <div className="inst-row inst-knobs">
        {KNOBS.map(([k, label, hint]) => (
          <KnobRow key={k} k={k} label={label} hint={hint} />
        ))}
      </div>

      {/**
       * ⚠️ Pointer events, not mouse events, and the capture is released immediately.
       *
       * Releasing capture is what lets a press SLIDE from one key to the next — a glissando —
       * because without it the first key keeps receiving every subsequent event and the others
       * never see a pointerenter. touch-action is none in the CSS for the same reason: on a
       * phone the browser would otherwise decide a drag across the keys is a scroll.
       */}
      <div
        className="inst-keys"
        data-kit={inst === 'drums' ? '1' : undefined}
        role="group"
        aria-label={inst === 'drums' ? 'Drum kit' : 'Keyboard'}
      >
        {keys.map((midi) => (
          <button
            key={midi}
            className={
              'inst-key' +
              // ⚠️ Black keys only on Chromatic. Under a scale the keys are degrees, not
              // semitones, so a "black" one would be a shorter key in an arbitrary place —
              // piano furniture on something that is no longer a piano.
              (scale === 'chromatic' && isBlack(midi) ? ' is-black' : '') +
              (scale !== 'chromatic' && midi % 12 === root ? ' is-root' : '') +
              (held.includes(midi) ? ' is-held' : '') +
              (theirNotes.has(midi) ? ' is-theirs' : '')
            }
            style={
              theirNotes.has(midi)
                ? ({ ['--party-hue' as string]: theirNotes.get(midi) } as React.CSSProperties)
                : undefined
            }
            aria-label={inst === 'drums' ? drumName(midi) : noteName(midi)}
            onPointerDown={(e) => {
              /**
               * ⚠️ SOUND FIRST, then let go of the pointer — and the release is wrapped because
               * it can throw.
               *
               * Releasing the implicit capture is what makes a glissando work: without it the
               * first key you touch keeps every subsequent move event and dragging across the
               * keyboard plays one note. But releasePointerCapture throws NotFoundError for a
               * pointer that was never captured, and it used to be the FIRST statement here — so
               * any case where the browser had not captured (and there are several: a
               * pointercancel that already released it, a synthetic event, some pen and
               * assistive input paths) threw before the note was played. The most important
               * interaction in the room was one exception away from silence, for the sake of a
               * convenience.
               */
              setOwned(e.pointerId, midi)
              try {
                e.currentTarget.releasePointerCapture(e.pointerId)
              } catch {
                /* it was never captured; the glissando just works differently for this pointer */
              }
            }}
            onPointerUp={(e) => setOwned(e.pointerId, null)}
            onPointerEnter={(e) => {
              if (e.buttons > 0) setOwned(e.pointerId, midi)
            }}
          >
            {/* ⚠️ Drums say WHICH DRUM, not which note. A twelve-piece kit laid out as
                C4/C#4/D4 is twelve unlabelled buttons — the note name is true and useless,
                because nobody is playing a kick in the key of C. */}
            <span className="inst-key-name">
              {inst === 'drums' ? drumName(midi) : noteName(midi)}
            </span>
          </button>
        ))}
      </div>

      <p className="muted inst-note">
        Play with the mouse, or four rows of your keyboard — <kbd>Z</kbd> and <kbd>Q</kbd> are two
        octaves of white keys, <kbd>S</kbd> and the number row are the black ones
        {scale === 'chromatic' ? '' : ', and every key is in the scale'}. Drag across the keys to
        slide.{' '}
        {jamming.on
          ? 'While Jam is on, the notes you play are sent to everyone in the call — nothing else is.'
          : 'Nothing is recorded or sent anywhere.'}
      </p>
      <p className="muted inst-note">
        Open the <strong>🎚️ Visualiser</strong> and pick <strong>Instrument</strong> as the source
        to watch yourself play — or set the Audio background and it follows you around the site.
      </p>
    </section>
  )
}
