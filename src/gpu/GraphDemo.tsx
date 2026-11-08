import { useEffect, useMemo, useRef, useState } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  GRAPH_KEY,
  LEVELS,
  MATCH,
  MAX_TEXT,
  ParseError,
  SLIDER,
  distance,
  parse,
  readSaved,
  sample,
  stars,
  uses,
  type Saved,
} from './graph'
import { createGraph, type GraphView } from './graphEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** what a thumb cannot easily type: inserted where the cursor is */
const KEYS = ['x', '²', '^', '(', ')', '/', 'sin(', 'cos(', 'abs(', 'sqrt(', 'a', 'b', 'c']

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(GRAPH_KEY))
  } catch {
    return readSaved(null)
  }
}

export function GraphDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<'levels' | 'free'>('levels')
  const [level, setLevel] = useState(() => Math.max(0, LEVELS.findIndex((l) => load().solved[l.name] === undefined))) // prettier-ignore
  const [text, setText] = useState('')
  const [hints, setHints] = useState(0)
  const [sliders, setSliders] = useState(() => {
    const f = load().free
    return { a: f.a, b: f.b, c: f.c }
  })
  const box = useRef<HTMLInputElement | null>(null)
  const l = LEVELS[level]

  useEffect(() => {
    try {
      localStorage.setItem(GRAPH_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  // what the box says, read: a curve, or where it goes wrong
  const read = useMemo(() => {
    if (!text.trim()) return { node: null, error: null }
    try {
      return { node: parse(text), error: null }
    } catch (e) {
      if (e instanceof ParseError) return { node: null, error: e }
      throw e
    }
  }, [text])
  const target = useMemo(() => sample(parse(l.target), { a: 0, b: 0, c: 0 }), [l])
  const yours = useMemo(() => (read.node ? sample(read.node, sliders) : null), [read, sliders])
  const off = yours && mode === 'levels' ? distance(yours, target) : Infinity
  const matched = off < MATCH
  const used = read.node ? uses(read.node) : new Set<string>()

  // a level is solved the first time it matches; the record keeps the fewest hints
  const was = useRef(false)
  const chime = useRef<number[]>([])
  useEffect(() => {
    if (matched && !was.current) {
      setSaved((s) => {
        const prev = s.solved[l.name]
        return prev !== undefined && prev <= hints
          ? s
          : { ...s, solved: { ...s.solved, [l.name]: hints } }
      })
      ;[67, 71, 74, 79].forEach((m, i) => {
        chime.current.push(
          window.setTimeout(() => noteOn(`graph-${m}`, 'bell', m), i * 100),
          window.setTimeout(() => noteOff(`graph-${m}`), i * 100 + 600),
        )
      })
    }
    was.current = matched
  }, [matched, hints, l.name])
  useEffect(
    () => () => {
      for (const t of chime.current) window.clearTimeout(t)
      for (const m of [67, 71, 74, 79]) noteOff(`graph-${m}`)
    },
    [],
  )
  // the free plane keeps what was typed and where the sliders were
  useEffect(() => {
    if (mode !== 'free') return
    setSaved((s) => ({ ...s, free: { text: text.slice(0, MAX_TEXT), ...sliders } }))
  }, [mode, text, sliders])

  const go = (k: number) => {
    setLevel(Math.max(0, Math.min(LEVELS.length - 1, k)))
    setText('')
    setHints(0)
    was.current = false
  }
  const switchTo = (m: 'levels' | 'free') => {
    setMode(m)
    setHints(0)
    was.current = false
    setText(m === 'free' ? saved.free.text : '')
  }
  const type = (s: string) => {
    setText(s.slice(0, MAX_TEXT))
    if (!running) setRunning(true)
  }
  const insert = (k: string) => {
    const el = box.current
    const at = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? at
    const next = text.slice(0, at) + k + text.slice(end)
    type(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(at + k.length, at + k.length)
    })
  }

  /* ── the GPU is given both curves whenever either changes */
  const engine = useRef<GraphView | null>(null)
  const now = useRef({ target, yours, matched, mode })
  now.current = { target, yours, matched, mode }
  useEffect(() => {
    engine.current?.curves(
      mode === 'levels' ? target : new Float32Array(target.length).fill(NaN),
      yours,
    )
  }, [target, yours, mode])

  const hintText = hints === 0 ? null : hints === 1 ? l.hints[0] : hints === 2 ? `${l.hints[0]} ${l.hints[1]}` : `${l.hints[0]} ${l.hints[1]} One answer: y = ${l.target}` // prettier-ignore
  const label =
    mode === 'levels'
      ? `Graph match, level ${level + 1}: ${l.name}. ${read.node ? (matched ? 'Your curve matches.' : `Your curve is ${off.toFixed(2)} squares off on average.`) : 'Type an equation for y.'}` // prettier-ignore
      : `Graph, free: ${read.node ? `y = ${text}` : 'type an equation for y'}.`

  return (
    <div className="lab-keys" aria-label="Graph match">
      <LabStage
        label={label}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createGraph(device, context, format, canvas)
          engine.current = v
          const n = now.current
          v.curves(
            n.mode === 'levels' ? n.target : new Float32Array(n.target.length).fill(NaN),
            n.yours,
          )
          let t = 0
          return {
            frame: (dt: number) => {
              t += dt
              v.frame({ time: t, matched: now.current.matched })
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
            <div className="lab-group" role="group" aria-label="What to do">
              <button
                className="btn btn-ghost"
                aria-pressed={mode === 'levels'}
                onClick={() => switchTo('levels')}
              >
                🎯 Match a curve
              </button>
              <button
                className="btn btn-ghost"
                aria-pressed={mode === 'free'}
                onClick={() => switchTo('free')}
              >
                ✏️ Graph anything
              </button>
            </div>
            {mode === 'levels' && (
              <>
                <button
                  className="btn btn-ghost"
                  aria-label="Previous curve"
                  disabled={level === 0}
                  onClick={() => go(level - 1)}
                >
                  ‹
                </button>
                <label className="studio-pick">
                  <span className="sr-only">Curve to match</span>
                  <select value={level} onChange={(e) => go(Number(e.target.value))}>
                    {LEVELS.map((x, i) => (
                      <option key={x.name} value={i}>
                        {i + 1}. {x.name}
                        {saved.solved[x.name] !== undefined
                          ? ` ${'★'.repeat(stars(saved.solved[x.name]))}`
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn btn-ghost"
                  aria-label="Next curve"
                  disabled={level === LEVELS.length - 1}
                  onClick={() => go(level + 1)}
                >
                  ›
                </button>
              </>
            )}
          </div>
          <label className="graph-eq">
            <span>y =</span>
            <input
              ref={box}
              value={text}
              maxLength={MAX_TEXT}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={!!read.error}
              aria-describedby="graph-said"
              placeholder={mode === 'levels' ? 'type an equation — try 2x + 1' : 'a*sin(b*x) + c'}
              onChange={(e) => type(e.target.value)}
            />
          </label>
          <div className="graph-keys" role="group" aria-label="Insert">
            {KEYS.map((k) => (
              <button
                key={k}
                className="btn btn-ghost"
                onClick={() => insert(k)}
                aria-label={`Insert ${k}`}
              >
                {k}
              </button>
            ))}
          </div>
          {(mode === 'free' || used.size > 0) && (
            <div className="graph-sliders">
              {(['a', 'b', 'c'] as const).map((k) => (
                <label key={k} className="graph-slider" data-unused={!used.has(k) || undefined}>
                  <span>
                    {k} = {sliders[k].toFixed(1)}
                  </span>
                  <input
                    type="range"
                    min={SLIDER.min}
                    max={SLIDER.max}
                    step={0.1}
                    value={sliders[k]}
                    onChange={(e) => setSliders((s) => ({ ...s, [k]: Number(e.target.value) }))}
                  />
                </label>
              ))}
            </div>
          )}
          <p id="graph-said" className="graph-said" aria-live="polite">
            {read.error ? (
              <>
                <span className="graph-bad">
                  {read.error.message[0].toUpperCase() + read.error.message.slice(1)}:
                </span>{' '}
                {/* the parser counts from the start of what was typed, "y =" and all */}
                <code>
                  {text.slice(0, read.error.at)}
                  <mark>{text[read.error.at] ?? ' '}</mark>
                  {text.slice(read.error.at + 1)}
                </code>
              </>
            ) : mode === 'levels' ? (
              read.node ? (
                matched ? (
                  <strong>
                    ✨ A match{hints ? ` — with ${hints} hint${hints === 1 ? '' : 's'}` : ''}.{' '}
                    {'★'.repeat(stars(hints))}
                    {'☆'.repeat(3 - stars(hints))}{' '}
                    {level < LEVELS.length - 1 && (
                      <button className="btn" onClick={() => go(level + 1)}>
                        Next curve ›
                      </button>
                    )}
                  </strong>
                ) : (
                  `${off.toFixed(2)} squares off on average — a match is under ${MATCH}.`
                )
              ) : (
                'Make the solid line lie on the dashed one.'
              )
            ) : read.node ? (
              `y = ${text}${used.size ? ` — move the slider${used.size === 1 ? '' : 's'} to see what ${[...used].join(', ')} ${used.size === 1 ? 'does' : 'do'}` : ''}`
            ) : (
              'Type any equation in x. Use a, b and c for numbers you can slide.'
            )}
          </p>
          {mode === 'levels' && (
            <p className="muted lab-hint">
              {hintText && <strong>{hintText} </strong>}
              {!matched && hints < 3 && (
                <>
                  <button className="btn btn-ghost" onClick={() => setHints((h) => h + 1)}>
                    💡 {hints === 2 ? 'Show an answer' : 'Hint'}
                  </button>{' '}
                </>
              )}
              Write y in terms of x: 2x + 1, x², (x − 2)², abs(x), sin(x), sqrt(x), 1/x. Times can
              be left out (2x, 3sin(x)). a, b and c become sliders.
            </p>
          )}
        </>
      )}
    </div>
  )
}
