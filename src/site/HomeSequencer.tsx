import { useCallback, useEffect, useRef, useState } from 'react'
import type { InstrumentId } from '../audio/synth'
import { onStopAll, withSynth } from './homeSynth'

/**
 * A little sequencer on the front page: a line already playing, that you can add notes to.
 *
 * ⚠️ THE HERO'S KEYS ARE A HOOK; THIS IS THE OTHER HALF. Twelve keys tell you the site makes
 * sound. They cannot tell you the studio WRITES anything down, which is the actual reason to open
 * it — so this is the grid, with a line in it, moving. A painted row of keys under a real row of
 * keys was the same hook twice and lost the comparison to the thing directly above it.
 *
 * ⚠️ NO SOUND UNTIL A DELIBERATE TAP, the same rule the hero keeps. The playhead runs from the
 * moment the tile is on screen, because a still grid is a picture; the audio only arms when
 * somebody puts a note in. A front page that starts playing music at you is the fastest way there
 * is to lose them.
 *
 * ⚠️ AND IT DISARMS ITSELF. A loop that keeps playing after you have wandered off is the same
 * rudeness arriving late, so the sound stops after QUIET_AFTER with no input. The line keeps
 * moving; it just goes quiet. Tap again and it comes back.
 *
 * ⚠️ ONE setInterval, NOT requestAnimationFrame. The playhead moves once per step — about seven
 * times a second — so a 60Hz loop would do eight times the work to show the same thing, and the
 * audio has to land on the step boundary anyway. It also means the playhead a listener HEARS and
 * the one they SEE are the same clock, rather than two that drift.
 */

/**
 * C major pentatonic, high row first — no wrong notes, which is the hero's rule too.
 *
 * ⚠️ FIVE ROWS AND TWELVE COLUMNS, NOT SEVEN AND SIXTEEN. The finer grid put the tap targets
 * at roughly 19x15px in a narrow tile — under half the size a fingertip can reliably hit, on the
 * device most people arrive on. A sequencer nobody can place a note in is a picture of a
 * sequencer. Coarser cells cost one octave of range, which this is not for.
 */
const PITCHES = [84, 81, 79, 76, 72]
const ROWS = PITCHES.length
const COLS = 12
const STEP_MS = 150
/** silence after this long without a tap */
const QUIET_AFTER = 15000

const INSTRUMENT: InstrumentId = 'marimba'
/** its own part, so this never inherits whatever the instrument room was left set to */
const PART = 'home-seq'
const FX = { echo: 0.18, echoTime: 0.28, space: 0.32, vibrato: 0, glide: 0 }
const GAIN = 0.38

/** where the line starts — a phrase rather than a scatter, so it sounds like something */
const SEED: Array<[number, number]> = [
  [0, 4],
  [2, 2],
  [3, 3],
  [5, 1],
  [6, 4],
  [8, 2],
  [9, 0],
  [11, 1],
]
const keyOf = (c: number, r: number) => c * ROWS + r

/**
 * One note the line just played, in its own terms rather than anybody else's.
 *
 * ⚠️ FRACTIONS, NOT PIXELS OR ROW NUMBERS. The strings above this live in HeroPlay, are a
 * different height, and have a different number of rows — four against five. Handing over grid
 * coordinates would mean this file knowing how that canvas is laid out, and the two going wrong
 * the first time either changes size. `at` is how far across its own width the note sits and
 * `pitch` is how high it is, both 0 to 1; converting those is the listener's business.
 */
export type SeqNote = { at: number; pitch: number }

/**
 * @param onNote told about every note that sounds, so something else can react to it — which is
 * how the hero's strings ring for the sequencer as well as for the keys. Optional: the sequencer
 * is complete on its own and does not care whether anybody is listening.
 */
export function HomeSequencer({ onNote }: { onNote?: (n: SeqNote) => void } = {}) {
  const svg = useRef<SVGSVGElement | null>(null)
  const [notes, setNotes] = useState<Set<number>>(() => new Set(SEED.map(([c, r]) => keyOf(c, r))))
  const [col, setCol] = useState(0)
  const notesRef = useRef(notes)
  notesRef.current = notes
  /** 0 = silent. Otherwise the time of the last tap. */
  const armedAt = useRef(0)
  /**
   * Stop making noise, now, and release whatever is still ringing.
   *
   * ⚠️ A REF SO THE LISTENERS BELOW NEVER GO STALE. They are registered once, for the life of
   * the component, and a closure captured at that moment would be disarming the first render's
   * state forever.
   */
  const hush = useRef(() => {})
  hush.current = () => {
    if (!armedAt.current) return
    armedAt.current = 0
    withSynth((s) => s.allNotesOff())
  }
  const visible = useRef(false)

  const still =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)

  /* ⚠️ A ref, so `play` keeps its empty dependency list and the interval below is never torn
     down and rebuilt just because a parent re-rendered with a new closure. */
  const tell = useRef(onNote)
  tell.current = onNote
  const ring = useCallback(
    (c: number, r: number) => tell.current?.({ at: (c + 0.5) / COLS, pitch: 1 - r / (ROWS - 1) }),
    [],
  )

  const play = useCallback(
    (c: number) => {
      for (let r = 0; r < ROWS; r++) {
        if (!notesRef.current.has(keyOf(c, r))) continue
        ring(c, r)
        const id = `seq:${c}:${r}`
        withSynth((s) => {
          s.noteOn(id, INSTRUMENT, PITCHES[r], undefined, { key: PART, fx: FX, gain: GAIN })
          /* marimba decays on its own, but every voice still has to be released or they pile up */
          window.setTimeout(() => withSynth((t) => t.noteOff(id)), 320)
        })
      }
    },
    [ring],
  )

  useEffect(() => {
    let timer = 0
    const tick = () => {
      setCol((c) => {
        const next = (c + 1) % COLS
        if (armedAt.current && performance.now() - armedAt.current > QUIET_AFTER) {
          armedAt.current = 0
        }
        if (armedAt.current) play(next)
        return next
      })
    }
    const onScreen = () => {
      const el = svg.current
      if (!el || document.hidden) return false
      const r = el.getBoundingClientRect()
      return r.bottom > 0 && r.top < (window.innerHeight || 0) && r.width > 0
    }
    const check = () => {
      /**
       * ⚠️ ARMED BEATS OFF-SCREEN, and that was a real rough edge rather than a nicety. The
       * playhead used to stop the instant this scrolled out of view — so somebody who tapped a
       * few notes, liked it, and scrolled down to read the rest of the page had their music cut
       * off mid-bar by the act of scrolling. The rule was only ever meant to be the one below it:
       * a loop goes quiet after QUIET_AFTER with nobody touching it.
       *
       * ⚠️ And it is what wires the page together. HomeViz draws whatever the synth is
       * playing, three sections down — so a line started up here is still moving that picture
       * when you reach it. That only works if scrolling towards it does not silence it first.
       *
       * ⚠️ A HIDDEN TAB IS DIFFERENT from an off-screen tile: browsers clamp setInterval to a
       * second or more in a background tab, so carrying on there would not be music, it would be a
       * note every second or so. That stops regardless.
       *
       * ⚠️ With motion turned down the line does not creep on its own — but it must still run
       * once somebody has tapped, or their notes would never sound.
       */
      const wanted = !document.hidden && (!!armedAt.current || (onScreen() && !still))
      if (wanted === visible.current) return
      visible.current = wanted
      if (wanted) timer = window.setInterval(tick, STEP_MS)
      else {
        window.clearInterval(timer)
        timer = 0
      }
    }
    check()

    /**
     * ⚠️ THE DOCK'S STOP BUTTON HAD TO REACH IN HERE. stopLive silences the voices that are
     * sounding, which is the whole job for a held key — but this thing plays a fresh note every
     * 150ms, so stopping the sound just made it stutter and carry on. Pressing stop has to stop
     * the PLAYER, not the notes.
     */
    const offStop = onStopAll(() => hush.current())

    /**
     * ⚠️ AND CLICKING ANYWHERE ELSE PUTS IT AWAY. A loop that keeps going while you read the
     * rest of the page is a page that follows you around. Leaving is the ordinary way people stop
     * something, so it is wired to mean that — pointerdown rather than click, so it lands even
     * when the press is on something that swallows the click.
     */
    const elsewhere = (e: Event) => {
      const el = svg.current
      const t = e.target
      if (!el || (t instanceof Node && el.contains(t))) return
      hush.current()
    }
    document.addEventListener('pointerdown', elsewhere, true)

    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    document.addEventListener('visibilitychange', check)
    /* the same belt-and-braces as the snake board: no observer to go quiet on us */
    const poll = window.setInterval(check, 1000)
    return () => {
      offStop()
      document.removeEventListener('pointerdown', elsewhere, true)
      window.clearInterval(timer)
      window.clearInterval(poll)
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
      document.removeEventListener('visibilitychange', check)
      withSynth((s) => s.allNotesOff())
    }
  }, [play, still])

  const tap = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const c = Math.floor(((e.clientX - r.left) / r.width) * COLS)
    const row = Math.floor(((e.clientY - r.top) / r.height) * ROWS)
    if (c < 0 || c >= COLS || row < 0 || row >= ROWS) return
    const k = keyOf(c, row)
    armedAt.current = performance.now()
    setNotes((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else {
        next.add(k)
        /* the note you just placed sounds NOW, rather than whenever the line next comes round —
           a grid that answers a quarter of a second later does not feel connected to your finger */
        ring(c, row)
        const id = `seq:tap:${k}`
        withSynth((s) => {
          s.noteOn(id, INSTRUMENT, PITCHES[row], undefined, { key: PART, fx: FX, gain: GAIN })
          window.setTimeout(() => withSynth((t) => t.noteOff(id)), 320)
        })
      }
      return next
    })
  }

  const CW = 320 / COLS
  const RH = 104 / ROWS
  return (
    <svg
      ref={svg}
      className="hag-art hag-seq"
      viewBox="0 0 320 104"
      preserveAspectRatio="none"
      onPointerDown={tap}
      role="img"
      aria-label="A short tune on a grid — tap a square to add a note"
    >
      {Array.from({ length: ROWS }, (_, r) => (
        <rect
          key={`r${r}`}
          x={0}
          y={r * RH}
          width={320}
          height={RH - 0.7}
          fill="currentColor"
          opacity={r % 2 ? 0.05 : 0.02}
        />
      ))}
      <rect
        className="hag-seq-head"
        x={col * CW}
        y={0}
        width={CW}
        height={104}
        fill="currentColor"
        opacity={0.16}
      />
      {[...notes].map((k) => {
        const c = Math.floor(k / ROWS)
        const r = k % ROWS
        return (
          <rect
            key={k}
            className={'hag-seq-note' + (c === col ? ' is-lit' : '')}
            x={c * CW + 1}
            y={r * RH + 1.5}
            width={CW - 2}
            height={RH - 3}
            rx={2}
          />
        )
      })}
    </svg>
  )
}
