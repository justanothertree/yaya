import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import {
  ECHO_KEY,
  LIVES,
  MODES,
  NOTES,
  PAD_COUNTS,
  PALETTES,
  SOUNDS,
  answer,
  gapFor,
  newRun,
  press,
  readSaved,
  roundTune,
  type Run,
  type Saved,
} from './echo'
import { motionReduced } from '../ui/motion'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(ECHO_KEY))
  } catch {
    return readSaved(null)
  }
}
const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const noteName = (m: number) => {
  const pc = [0, 2, 4, 5, 7, 9, 11].indexOf(m % 12)
  return `${NAMES[pc]}${Math.floor(m / 12) - 1}`
}
const COLOURS: Record<Saved['palette'], string[]> = {
  bright: ['#e5484d', '#2f7ff0', '#f5b700', '#30a46c', '#8e4ec6', '#f76b15'],
  pastel: ['#f4a6a8', '#9cc3f7', '#f7dd8a', '#9ed9b5', '#c9a8e8', '#f8bf92'],
  neon: ['#ff3fae', '#2fe6ff', '#fff15a', '#5dff9b', '#b07bff', '#ff9a3c'],
}
const SOUND_NAMES: Record<Saved['sound'], string> = {
  bell: 'Bells',
  keys: 'Piano',
  pluck: 'Plucked',
}
const PALETTE_NAMES: Record<Saved['palette'], string> = {
  bright: 'Bright',
  pastel: 'Pastel',
  neon: 'Neon',
}
type Phase = 'idle' | 'playing' | 'yours' | 'over'

export function EchoDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [run, setRun] = useState<Run | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [lit, setLit] = useState<number | null>(null)
  const [missed, setMissed] = useState<{ pad: number; wanted: number } | null>(null)
  const [line, setLine] = useState(
    'The pads play a tune. Play it back, and it grows by a note. How long can you go?',
  )
  const timers = useRef<number[]>([])
  const stage = useRef<HTMLDivElement | null>(null)
  const voice = useRef(0)
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    try {
      localStorage.setItem(ECHO_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  const hush = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
    for (let k = Math.max(0, voice.current - 8); k <= voice.current; k++) noteOff(`echo-${k}`)
  }
  useEffect(() => hush, [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  const pads = run?.pads ?? saved.pads
  const strictKey = saved.strict ? 'strict' : 'gentle'
  const best = saved.best[strictKey][saved.pads][saved.mode]

  /** sound a pad and light it for a moment */
  const sound = (pad: number, ms: number, notes: number[] = NOTES[pads as 4 | 6]) => {
    const k = ++voice.current
    noteOn(`echo-${k}`, saved.sound, notes[pad])
    setLit(pad)
    later(ms, () => {
      noteOff(`echo-${k}`)
      setLit((l) => (l === pad ? null : l))
    })
  }
  /** the pads play this round's tune, then it is your turn */
  const playTune = (r: Run) => {
    hush()
    setPhase('playing')
    const t = roundTune(r)
    const gap = gapFor(r.length)
    setLine(
      `Listen — ${r.length} note${r.length === 1 ? '' : 's'}${r.mode === 'mirror' ? ', to play back backwards' : ''}.`,
    )
    t.forEach((pad, i) => later(500 + i * gap, () => sound(pad, gap * 0.72, NOTES[r.pads])))
    later(500 + t.length * gap, () => {
      setPhase('yours')
      setLine(
        `Your turn: ${r.length} note${r.length === 1 ? '' : 's'}${r.mode === 'mirror' ? ', backwards' : ''}.`,
      )
    })
  }
  const start = () => {
    hush()
    setMissed(null)
    /* ⚠️ THE SITE'S AUDIO DOCK appears with the first note and stays for six seconds after the last
       one, which is the whole game; on a phone it floats just above the bottom bar, over the
       lower pads. The tune and the pads go to the top of the screen, clear of it. */
    stage.current?.scrollIntoView({
      block: 'start',
      behavior: motionReduced() ? 'auto' : 'smooth',
    })
    const r = newRun(
      (Math.random() * 2 ** 31) >>> 0,
      saved.pads,
      saved.mode,
      saved.strict ? LIVES.strict : LIVES.gentle,
    )
    setRun(r)
    playTune(r)
  }

  const tap = (pad: number) => {
    const r = runRef.current
    if (!r || phase !== 'yours') {
      // between games the pads still play, for trying the sound
      if (phase === 'idle' || phase === 'over') sound(pad, 260)
      return
    }
    const want = answer(roundTune(r), r.mode)[r.pressed.length]
    const v = press(r, pad)
    setRun(v.run)
    sound(pad, 240, NOTES[r.pads])
    if (v.verdict === 'right') return
    if (v.verdict === 'round') {
      setPhase('playing')
      setLine(`✓ ${r.length} note${r.length === 1 ? '' : 's'}. One more…`)
      later(800, () => playTune(v.run))
      return
    }
    setMissed({ pad, wanted: want })
    if (v.verdict === 'wrong') {
      setPhase('playing')
      setLine(
        `Not that one. ${v.run.lives} go${v.run.lives === 1 ? '' : 'es'} left — here it is again.`,
      )
      later(1300, () => {
        setMissed(null)
        playTune(v.run)
      })
      return
    }
    // over
    setPhase('over')
    const score = v.run.best
    const was = saved.best[strictKey][r.pads][r.mode]
    if (score > was)
      setSaved((s) => ({
        ...s,
        best: {
          ...s.best,
          [strictKey]: {
            ...s.best[strictKey],
            [r.pads]: { ...s.best[strictKey][r.pads], [r.mode]: score },
          },
        },
      }))
    setLine(
      score > was
        ? `🏆 ${score} note${score === 1 ? '' : 's'} — your longest yet! The lit pad was the one.`
        : `Game over at ${score} note${score === 1 ? '' : 's'}. Your best is ${was}. The lit pad was the one.`,
    )
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = Number(e.key)
    if (k >= 1 && k <= pads) {
      if (!e.repeat) tap(k - 1)
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (phase === 'idle' || phase === 'over') start()
      else return
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  const colours = COLOURS[saved.palette]
  const notes = NOTES[pads as 4 | 6]
  const busy = phase === 'playing' || phase === 'yours'
  const settings = (f: () => void) => () => {
    if (busy) return
    f()
  }
  return (
    <div className={`lab-keys ec-room is-${saved.palette}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How many pads">
          {PAD_COUNTS.map((n) => (
            <button
              key={n}
              className="btn btn-ghost"
              aria-pressed={saved.pads === n}
              disabled={busy}
              onClick={settings(() => {
                setSaved((s) => ({ ...s, pads: n }))
                setRun(null)
              })}
            >
              {n} pads
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="How to play it back">
          {MODES.map((m) => (
            <button
              key={m}
              className="btn btn-ghost"
              aria-pressed={saved.mode === m}
              disabled={busy}
              onClick={settings(() => setSaved((s) => ({ ...s, mode: m })))}
            >
              {m === 'echo' ? '→ In order' : '← Backwards'}
            </button>
          ))}
        </div>
        <button
          className="btn btn-ghost"
          aria-pressed={!saved.strict}
          disabled={busy}
          onClick={settings(() => setSaved((s) => ({ ...s, strict: !s.strict })))}
        >
          Three goes
        </button>
      </div>
      <div className="dice-scores">
        <div className="dice-score is-up">
          <span>This game</span>
          <strong>{run ? run.best : 0}</strong>
          <span className="muted">
            {run && !run.over && run.lives > 1 ? `${run.lives} goes left` : 'notes played back'}
          </span>
        </div>
        <div className="dice-score">
          <span>Your best</span>
          <strong>{best || '—'}</strong>
          <span className="muted">
            {saved.pads} pads, {saved.mode === 'mirror' ? 'backwards' : 'in order'}
            {saved.strict ? '' : ', three goes'}
          </span>
        </div>
      </div>
      <div className="ec-stage" ref={stage}>
        <div className="lab-controls ec-top">
          <button className="btn ec-go" onClick={start} disabled={busy}>
            {run ? '↻ Again' : '▶ Start'}
          </button>
          <p className="mc-line" aria-live="polite">
            {line}
          </p>
        </div>

        <div
          className={`ec-pads is-${pads}${phase === 'playing' ? ' is-listening' : ''}`}
          role="group"
          aria-label={`The pads. Keys 1 to ${pads} play them; Space starts.`}
          onKeyDown={onKey}
        >
          {notes.map((m, i) => (
            <button
              key={i}
              className={[
                'ec-pad',
                lit === i ? 'is-lit' : '',
                missed?.wanted === i ? 'is-wanted' : '',
                missed?.pad === i && missed.pad !== missed.wanted ? 'is-missed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ ['--ec-c' as string]: colours[i] }}
              aria-label={`Pad ${i + 1}, ${noteName(m)}`}
              onPointerDown={(e) => {
                // the press itself sounds the note: a click would wait for the finger to lift
                e.preventDefault()
                tap(i)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  tap(i)
                }
              }}
            >
              <span aria-hidden>{i + 1}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="fw-panel">
        <section aria-label="Sound and colour">
          <h3 className="fw-h">Sound and colour</h3>
          <div className="lab-controls" role="group" aria-label="Sound">
            {SOUNDS.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={saved.sound === s}
                onClick={() => setSaved((x) => ({ ...x, sound: s }))}
              >
                {SOUND_NAMES[s]}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Colours">
            {PALETTES.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={saved.palette === p}
                onClick={() => setSaved((x) => ({ ...x, palette: p }))}
              >
                {PALETTE_NAMES[p]}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        The pads light and play a tune; play it back by tapping them, or with the number keys. Each
        time you do, the tune grows by a note and plays a little quicker. One wrong pad ends the
        game — or, with Three goes, plays the round again until the third. Backwards is the same,
        played back in reverse. The pads are tuned to a pentatonic scale, so every tune is one worth
        humming; with the sound off, the lights carry it all.
      </p>
    </div>
  )
}
