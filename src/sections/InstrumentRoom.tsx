import { useCallback, useEffect, useRef, useState } from 'react'
import {
  INSTRUMENTS,
  allNotesOff,
  closeSynth,
  noteOff,
  noteOn,
  type InstrumentId,
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
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12)
const noteName = (midi: number) => NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1)

const INST_KEY = 'instrument_v1'
const OCT_KEY = 'instrument_octave_v1'

/** Two octaves and a bit — as many keys as fit a screen without each one being a sliver. */
const SPAN = 17

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
  // ⚠️ a ref as well as state: the key handlers are bound once and would otherwise capture the
  // instrument and octave from the render that installed them, so changing either mid-play would
  // be ignored until something else re-rendered
  const live = useRef({ inst, base })
  live.current = { inst, base }

  useEffect(() => {
    try {
      localStorage.setItem(INST_KEY, inst)
      localStorage.setItem(OCT_KEY, String(octave))
    } catch {
      /* private mode — it still plays */
    }
  }, [inst, octave])

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
      press('k:' + e.key.toLowerCase(), live.current.base + off)
    }
    const up = (e: KeyboardEvent) => {
      const off = KEY_MAP[e.key.toLowerCase()]
      if (off === undefined) return
      lift('k:' + e.key.toLowerCase(), live.current.base + off)
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

  const keys = Array.from({ length: SPAN }, (_, i) => base + i)
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
              (isBlack(midi) ? ' is-black' : '') +
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
        Play with the mouse, or the <kbd>{label}</kbd>–<kbd>;</kbd> rows on your keyboard — the top
        row is the black keys. Drag across the keys to slide. Nothing is recorded or sent anywhere.
      </p>
      <p className="muted inst-note">
        Open the <strong>🎚️ Visualiser</strong> and pick <strong>Instrument</strong> as the source
        to watch yourself play — or set the Audio background and it follows you around the site.
      </p>
    </section>
  )
}
