import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  INTERVALS_KEY,
  PASS,
  ROUND,
  STAGES,
  answerOf,
  byShort,
  noteName,
  question,
  readSaved,
  record,
  unlocked,
  type Direction,
  type Question,
} from './intervals'
import { createIntervals, type IntervalsView } from './intervalsEngine'
import { loadKept, useKept } from './kept'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** a gap between the two notes long enough to hear each, short enough to hold the first in mind */
const GAP = 650
const HOLD = 900
const KEYS = '123456789qwe'
/** "an Octave", "a Tritone" */
const article = (name: string) => `${/^[AEIOU]/.test(name) ? 'an' : 'a'} ${name}`

export function IntervalsDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [saved, setSaved] = useKept(INTERVALS_KEY, readSaved)
  const open = unlocked(saved.passed)
  const [stage, setStage] = useState(() => unlocked(loadKept(INTERVALS_KEY, readSaved).passed))
  const [direction, setDirection] = useState<Direction | 'mixed'>('up')
  const [q, setQ] = useState<Question | null>(null)
  const [n, setN] = useState(0)
  const [score, setScore] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const set = STAGES[stage]

  const engine = useRef<IntervalsView | null>(null)
  const clock = useRef(0)
  const heard = useRef({ first: -9, second: -9 })
  const timers = useRef<number[]>([])
  const playing = useRef(0)
  const now = useRef({ q, picked })
  now.current = { q, picked }

  const quiet = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
    for (let k = 0; k <= playing.current; k++) {
      noteOff(`iv-${k}-a`)
      noteOff(`iv-${k}-b`)
    }
  }
  useEffect(() => quiet, [])

  /** sound two notes: one after the other, or together; the stage's ripples follow the clock */
  const sound = (a: number, b: number, together: boolean) => {
    quiet()
    const k = ++playing.current
    const at = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))
    noteOn(`iv-${k}-a`, 'keys', a)
    heard.current = { first: clock.current, second: together ? clock.current : -9 }
    if (together) noteOn(`iv-${k}-b`, 'keys', b)
    else
      at(GAP, () => {
        noteOn(`iv-${k}-b`, 'keys', b)
        heard.current = { ...heard.current, second: clock.current }
      })
    at(together ? HOLD + 300 : GAP + HOLD, () => {
      noteOff(`iv-${k}-a`)
      noteOff(`iv-${k}-b`)
    })
    if (!running) setRunning(true)
  }
  const play = (x: Question) => sound(x.first, x.second, x.direction === 'together')

  const ask = (round = n, last?: string) => {
    const next = question(set, saved.stats, direction, Math.random, last)
    setQ(next)
    setPicked(null)
    setN(round)
    play(next)
  }
  const start = () => {
    setScore(0)
    setDone(null)
    ask(0)
  }
  const answer = (s: string) => {
    if (!q || picked) return
    const right = s === answerOf(q)
    setPicked(s)
    if (right) setScore((v) => v + 1)
    setSaved((sv) => ({ ...sv, stats: record(sv.stats, answerOf(q), right) }))
  }
  const next = () => {
    if (!q || !picked) return
    if (n + 1 < ROUND) {
      ask(n + 1, q.interval)
      return
    }
    // the round is over
    const total = score
    setQ(null)
    setPicked(null)
    setSaved((sv) => {
      const best = [...sv.best]
      best[stage] = Math.max(best[stage] ?? 0, total)
      const passed = total >= PASS && stage === sv.passed ? sv.passed + 1 : sv.passed
      return { ...sv, best, passed }
    })
    const opens = total >= PASS && stage === saved.passed && stage < STAGES.length - 1
    setDone(
      total >= PASS
        ? `✨ ${total} of ${ROUND}.${opens ? ` Stage ${stage + 2} is open: ${STAGES[stage + 1].filter((s) => !set.includes(s)).map((s) => byShort(s).name).join(', ')} ${STAGES[stage + 1].length - set.length === 1 ? 'joins' : 'join'} in.` : ''}` // prettier-ignore
        : `${total} of ${ROUND} — ${PASS} opens the next stage. The intervals you miss come up more often, so another round is practice where it is needed.`,
    )
  }
  /** after a wrong answer: the interval you chose, from the same first note, to hear the difference */
  const hearYours = () => {
    if (!q || !picked) return
    const semis = byShort(picked).semis
    const second = q.direction === 'down' ? q.first - semis : q.first + semis
    sound(q.first, second, q.direction === 'together')
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const i = KEYS.indexOf(k)
    if (i >= 0 && i < set.length && q && !picked) answer(set[i])
    else if (k === ' ' && q) play(q)
    else if (k === 'enter' && q && picked) next()
    else if (k === 'enter' && !q) start()
    else return
    e.preventDefault()
  }

  const right = q && picked ? picked === answerOf(q) : null
  const truth = q ? byShort(answerOf(q)) : null
  const label = q
    ? `Ear trainer, stage ${stage + 1}, question ${n + 1} of ${ROUND}. ${picked ? `It was ${article(truth!.name)}, ${noteName(q.first)} to ${noteName(q.second)}. ${right ? 'Right.' : `You said ${byShort(picked).name}.`}` : 'Listen, then name the interval.'}` // prettier-ignore
    : `Ear trainer, stage ${stage + 1}. ${done ?? 'Start a round of ten.'}`

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Intervals">
      <LabStage
        label={label}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createIntervals(device, context, format, canvas)
          engine.current = v
          return {
            frame: (dt: number) => {
              clock.current += dt
              const t = clock.current
              const c = now.current
              const h = heard.current
              const x = c.q
              v.frame({
                time: t,
                first: x?.first ?? 60,
                second: x?.second ?? 60,
                sinceFirst: h.first < 0 ? -1 : t - h.first,
                sinceSecond: h.second < 0 ? -1 : t - h.second,
                right: x && c.picked ? c.picked === answerOf(x) : null,
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
      />

      {live && (
        <>
          <div className="lab-controls">
            <label className="studio-pick">
              <span className="sr-only">Stage</span>
              <select
                value={stage}
                disabled={!!q}
                onChange={(e) => setStage(Number(e.target.value))}
              >
                {STAGES.map((st, i) => (
                  <option key={i} value={i} disabled={i > open}>
                    Stage {i + 1}: {st.length} intervals
                    {i > open ? ' 🔒' : saved.best[i] ? ` · best ${saved.best[i]}/${ROUND}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="studio-pick">
              <span className="sr-only">How the notes are played</span>
              <select
                value={direction}
                disabled={!!q}
                onChange={(e) => setDirection(e.target.value as Direction | 'mixed')}
              >
                <option value="up">Rising</option>
                <option value="down">Falling</option>
                <option value="together">Together</option>
                <option value="mixed">Mixed</option>
              </select>
            </label>
            {q ? (
              <button className="btn" onClick={() => play(q)} aria-keyshortcuts="Space">
                🔁 Hear again
              </button>
            ) : (
              <button className="btn" onClick={start} aria-keyshortcuts="Enter">
                ▶ {done ? 'Another round' : 'Start a round'}
              </button>
            )}
            {q && (
              <span className="lab-score" aria-live="off">
                {n + 1} of {ROUND} · {score} right
              </span>
            )}
          </div>
          {/* ⚠️ THE VERDICT SITS ABOVE THE ANSWERS, not in the paragraph under them: on a phone the
              site's floating audio pill (it appears as soon as a note plays) covered the Next button
              there. */}
          {q && picked && (
            <div className="lab-controls iv-verdict" aria-live="polite">
              <strong>
                {right ? '✓ Right — ' : '✗ '}
                {right ? '' : `It was ${article(truth!.name)}, `}
                {noteName(q.first)} to {noteName(q.second)}.
              </strong>
              {!right && (
                <>
                  <button className="btn btn-ghost" onClick={hearYours}>
                    ▶ Hear yours, {article(byShort(picked).name)}
                  </button>
                  <button className="btn btn-ghost" onClick={() => play(q)}>
                    ▶ Hear it again
                  </button>
                </>
              )}
              <button className="btn" onClick={next} aria-keyshortcuts="Enter">
                {n + 1 < ROUND ? 'Next ›' : 'See the score'}
              </button>
            </div>
          )}
          {q && (
            <div className="iv-answers" role="group" aria-label="Which interval">
              {set.map((s, i) => {
                const iv = byShort(s)
                const state = picked
                  ? s === answerOf(q)
                    ? 'right'
                    : s === picked
                      ? 'wrong'
                      : undefined
                  : undefined
                return (
                  <button
                    key={s}
                    className="btn iv-answer"
                    data-state={state}
                    disabled={!!picked}
                    aria-keyshortcuts={KEYS[i]}
                    onClick={() => answer(s)}
                  >
                    <strong>{iv.name}</strong>
                    <span className="iv-sound">{iv.sound}</span>
                  </button>
                )
              })}
            </div>
          )}
          <p className="muted lab-hint" aria-live="polite">
            {done && <strong>{done} </strong>}
            Two notes play; name the distance between them. Each stage adds intervals that are
            harder to tell apart, and opens with {PASS} of {ROUND} right. Turn the sound up. Keys:
            1–9, Q, W, E answer, Space hear again, Enter next.
          </p>
        </>
      )}
    </div>
  )
}
