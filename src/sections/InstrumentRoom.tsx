import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  INSTRUMENTS,
  allNotesOff,
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
  loopLength,
  captureLast,
  loadSong,
  addLayers,
  toggleLayerBar,
  clearLayerBars,
  addEmptyLayer,
  setBars,
  setBpm,
  setLayerInstrument,
  setMetronome,
  setQuantize,
  startLoop,
  stopLoop,
  subscribeLoop,
  toggleMute,
  undoLast,
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

  /** which layer's notes are open in the editor, if any */
  const [editing, setEditing] = useState<string | null>(null)
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
    const target = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable
    }
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || target(e)) return
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
      allNotesOff()
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
      <div className="inst-bar">
        <div className="fx-style-row inst-picks">
          {INSTRUMENTS.map(([id, icon, name]) => (
            <button
              key={id}
              className={'fx-style-btn' + (inst === id ? ' is-on' : '')}
              aria-pressed={inst === id}
              onClick={() => {
                allNotesOff()
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
            allNotesOff()
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
              allNotesOff()
              setHeld([])
              setScale(e.target.value)
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
                allNotesOff()
                setHeld([])
                setRoot(Number(e.target.value))
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

      {loop.layers.length > 0 && (
        <ul className="inst-layers">
          {loop.layers.map((l, i) => (
            <li
              key={l.id}
              className={
                (l.muted ? 'is-muted' : '') + (loop.replacing === l.id ? ' is-replacing' : '')
              }
            >
              <span className="inst-layer-name">
                {i + 1}.<span className="muted"> {l.events.filter((e) => e.on).length} notes</span>
              </span>

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
              <span className="inst-arrange" role="group" aria-label="Bars this layer plays in">
                {Array.from({ length: loop.bars }, (_, b) => {
                  const on = l.play?.[b] ?? true
                  return (
                    <button
                      key={b}
                      className={'inst-bar-cell' + (on ? ' is-on' : '')}
                      aria-pressed={on}
                      onClick={() => toggleLayerBar(l.id, b)}
                      title={`Bar ${b + 1}: ${on ? 'playing' : 'silent'}`}
                    >
                      <span className="sr-only">{b + 1}</span>
                    </button>
                  )
                })}
                {l.play && (
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

              {/* Editing what you played rather than playing it again — only possible because a
                  take is stored as notes. See PianoRoll. */}
              <button
                className={'btn' + (editing === l.id ? ' is-on' : '')}
                aria-pressed={editing === l.id}
                onClick={() => setEditing((e) => (e === l.id ? null : l.id))}
                title="Edit this layer's notes"
              >
                ✎
              </button>
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
              press('p:' + midi, midi)
              try {
                e.currentTarget.releasePointerCapture(e.pointerId)
              } catch {
                /* it was never captured; the glissando just works differently for this pointer */
              }
            }}
            onPointerUp={() => lift('p:' + midi, midi)}
            onPointerLeave={() => lift('p:' + midi, midi)}
            onPointerEnter={(e) => {
              if (e.buttons > 0) press('p:' + midi, midi)
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
