import { useCallback, useEffect, useRef, useState } from 'react'
import {
  INSTRUMENTS,
  allNotesOff,
  closeSynth,
  knob,
  noteOff,
  noteOn,
  setKnob,
  type InstrumentId,
  type Knob,
} from '../audio/synth'
import { onMixerChange, setVolume, volume } from '../audio/mixer'

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

/** The tracker/DAW layout: home row is white keys, the row above is the black ones. */
const KEY_MAP: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
  ';': 16,
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

/** The four things you can bend about the sound, as sliders rather than a patch editor. */
const KNOBS: Array<[Knob, string, string]> = [
  ['echo', 'Echo', 'How much of the note comes back'],
  ['echoTime', 'Echo time', 'How long before it does'],
  ['space', 'Space', 'The size of the room it is played in'],
  ['vibrato', 'Vibrato', 'A wobble in the pitch, like a singer'],
]
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)
const noteName = (midi: number) => NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)

const INST_KEY = 'instrument_v1'
const OCT_KEY = 'instrument_octave_v1'
const SCALE_KEY = 'instrument_scale_v1'
const ROOT_KEY = 'instrument_root_v1'

/** Two octaves and a bit — as many keys as fit a screen without each one being a sliver. */
const SPAN = 17

/**
 * One effect, as a slider.
 *
 * Reads the synth rather than holding the value, so the knob and the audio can never disagree —
 * and a value restored from a previous visit shows up here without being threaded through.
 */
function KnobRow({ k, label, hint }: { k: Knob; label: string; hint: string }) {
  const [v, setV] = useState(() => knob(k))
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

  const press = useCallback((id: string, midi: number) => {
    noteOn(id, live.current.inst, midi)
    setHeld((h) => (h.includes(midi) ? h : [...h, midi]))
  }, [])

  const lift = useCallback((id: string, midi: number) => {
    noteOff(id)
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
      closeSynth()
    },
    [],
  )

  const keys = Array.from({ length: SPAN }, (_, i) => noteAt(i))
  const label = Object.entries(KEY_MAP).find(([, v]) => v === 0)?.[0]

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
      </div>

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

        {/* A stuck note is the one failure every synth has, and hunting for the key that caused
            it is miserable. One button, always there. */}
        <button
          className="btn"
          onClick={() => {
            allNotesOff()
            setHeld([])
          }}
          title="Silence everything"
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
      <div className="inst-keys" role="group" aria-label="Keyboard">
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
              (held.includes(midi) ? ' is-held' : '')
            }
            aria-label={noteName(midi)}
            onPointerDown={(e) => {
              e.currentTarget.releasePointerCapture?.(e.pointerId)
              press('p:' + midi, midi)
            }}
            onPointerUp={() => lift('p:' + midi, midi)}
            onPointerLeave={() => lift('p:' + midi, midi)}
            onPointerEnter={(e) => {
              if (e.buttons > 0) press('p:' + midi, midi)
            }}
          >
            <span className="inst-key-name">{noteName(midi)}</span>
          </button>
        ))}
      </div>

      <p className="muted inst-note">
        Play with the mouse, or the <kbd>{label}</kbd>–<kbd>;</kbd> rows on your keyboard
        {scale === 'chromatic'
          ? ' — the top row is the black keys'
          : ' — every key is in the scale'}
        . Drag across the keys to slide. Nothing is recorded or sent anywhere.
      </p>
      <p className="muted inst-note">
        Open the <strong>🎚️ Visualiser</strong> and pick <strong>Instrument</strong> as the source
        to watch yourself play — or set the Audio background and it follows you around the site.
      </p>
    </section>
  )
}
