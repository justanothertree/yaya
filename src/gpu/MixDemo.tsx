import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  MATCH,
  MAX_DROPS,
  MIX_KEY,
  PAINTS,
  TARGETS,
  colourOf,
  describe,
  difference,
  fewest,
  hex,
  hintFor,
  readSaved,
  stars,
  targetColour,
  total,
  type Drops,
  type Saved,
} from './mix'
import { createMix, type MixView } from './mixEngine'
import type { Rgb } from './palette'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const EMPTY: Drops = PAINTS.map(() => 0)
/** each paint as it looks on its own, for its button */
const SWATCH = PAINTS.map((_, i) => colourOf(PAINTS.map((__, k) => (k === i ? 1 : 0))))
const ink = (c: Rgb) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.55 ? '#111' : '#fff')

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(MIX_KEY))
  } catch {
    return { best: {} }
  }
}

export function MixDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<'match' | 'free'>('match')
  const [level, setLevel] = useState(() => {
    const s = load()
    return Math.max(
      0,
      TARGETS.findIndex((t) => s.best[t.name] === undefined),
    )
  })
  const [drops, setDrops] = useState<Drops>(EMPTY)
  const [history, setHistory] = useState<Drops[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [sound, setSound] = useState(true)
  const t = TARGETS[level]
  const target = useMemo(() => targetColour(t), [t])
  const par = useMemo(() => fewest(target)?.n ?? 0, [target])
  const n = total(drops)
  const cup = n ? colourOf(drops) : null
  const off = cup ? difference(cup, target) : Infinity
  const matched = mode === 'match' && off < MATCH

  const engine = useRef<MixView | null>(null)
  const clock = useRef(0)
  const lastDrop = useRef({ at: -9, before: null as Rgb | null, paint: SWATCH[0] })
  const timers = useRef<number[]>([])
  const now = useRef({ target, cup, matched, mode })
  now.current = { target, cup, matched, mode }

  useEffect(() => {
    try {
      localStorage.setItem(MIX_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(
    () => () => {
      for (const x of timers.current) window.clearTimeout(x)
      for (const m of [60, 64, 67, 72, 48]) noteOff(`mix-${m}`)
    },
    [],
  )

  const play = (m: number, len: number, voice: 'pluck' | 'bell' = 'pluck') => {
    if (!sound) return
    const id = `mix-${m}`
    noteOn(id, voice, m)
    timers.current.push(window.setTimeout(() => noteOff(id), len))
  }

  const fresh = () => {
    setDrops(EMPTY)
    setHistory([])
    setNote(null)
    lastDrop.current = { at: -9, before: null, paint: SWATCH[0] }
  }
  const go = (k: number) => {
    setLevel(Math.max(0, Math.min(TARGETS.length - 1, k)))
    fresh()
  }

  const add = (p: number) => {
    if (matched) return
    if (n >= MAX_DROPS) {
      setNote(`The cup is full at ${MAX_DROPS} drops — empty it and start again.`)
      return
    }
    const next = drops.map((c, i) => c + (i === p ? 1 : 0))
    lastDrop.current = { at: clock.current, before: cup, paint: SWATCH[p] }
    setHistory((h) => [...h, drops])
    setDrops(next)
    setNote(null)
    play(48, 120)
    if (mode === 'match' && difference(colourOf(next), target) < MATCH) {
      const used = total(next)
      const k = stars(par, used)
      setSaved((s) =>
        s.best[t.name] !== undefined && s.best[t.name] <= used
          ? s
          : { best: { ...s.best, [t.name]: used } },
      )
      setNote(`✨ A match, in ${used} drop${used === 1 ? '' : 's'} — the fewest that will do is ${par}. ${'★'.repeat(k)}${'☆'.repeat(3 - k)}`) // prettier-ignore
      if (sound)
        [60, 64, 67, 72].forEach((m, i) => {
          const id = `mix-${m}`
          timers.current.push(
            window.setTimeout(() => noteOn(id, 'bell', m), 300 + i * 110),
            window.setTimeout(() => noteOff(id), 300 + i * 110 + 700),
          )
        })
    }
    if (!running) setRunning(true)
  }
  const undo = () => {
    if (!history.length) return
    setDrops(history[history.length - 1])
    setHistory((h) => h.slice(0, -1))
    setNote(null)
  }
  const hint = () => {
    const h = hintFor(drops, target)
    if (!h) {
      setNote('Paint cannot be taken out, and there is already too much of something for this one — empty the cup and start again.') // prettier-ignore
      return
    }
    if (h.left === 0) return
    setNote(`Try ${PAINTS[h.paint].name.toLowerCase()} — ${h.left} more drop${h.left === 1 ? '' : 's'} could get there from here.`) // prettier-ignore
  }
  const copy = async () => {
    if (!cup) return
    try {
      await navigator.clipboard.writeText(hex(cup))
      setNote(`Copied ${hex(cup)}.`)
    } catch {
      setNote(`Could not copy — it is ${hex(cup)}.`)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (/^[1-5]$/.test(k)) add(Number(k) - 1)
    else if (k === 'z' || k === 'u') undo()
    else if (k === 'e') fresh()
    else if (k === 'h' && mode === 'match') hint()
    else return
    e.preventDefault()
  }

  const recipe = PAINTS.filter((_, i) => drops[i]).map((p) => `${drops[PAINTS.indexOf(p)]} ${p.name.toLowerCase()}`) // prettier-ignore
  const said = mode === 'match' && cup ? describe(cup, target) : ''
  const comparison = !said
    ? ''
    : matched || said === 'a match'
      ? 'A match.'
      : said === 'very nearly there'
        ? 'Very nearly there.'
        : `Yours is ${said} than ${t.name}.`
  const label =
    mode === 'match'
      ? `Paint mixer: match ${t.name}. ${cup ? `The cup holds ${recipe.join(', ')}. ${comparison}` : 'The cup is empty.'}`
      : `Paint mixer, free mixing. ${cup ? `The cup holds ${recipe.join(', ')}, which is ${hex(cup)}.` : 'The cup is empty.'}`

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Paint mixer">
      <LabStage
        label={label}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createMix(device, context, format, canvas)
          engine.current = v
          return {
            frame: (dt: number) => {
              clock.current += dt
              const c = now.current
              const d = lastDrop.current
              v.frame({
                time: clock.current,
                since: clock.current - d.at,
                target: c.mode === 'free' ? (c.cup ?? [0.93, 0.93, 0.93]) : c.target,
                matched: c.matched,
                cup: c.cup,
                before: d.before,
                drop: d.paint,
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
            <div className="lab-group" role="group" aria-label="What to do">
              <button
                className="btn btn-ghost"
                aria-pressed={mode === 'match'}
                onClick={() => {
                  setMode('match')
                  fresh()
                }}
              >
                🎯 Match a colour
              </button>
              <button
                className="btn btn-ghost"
                aria-pressed={mode === 'free'}
                onClick={() => {
                  setMode('free')
                  fresh()
                }}
              >
                🎨 Mix freely
              </button>
            </div>
            {mode === 'match' && (
              <>
                <button
                  className="btn btn-ghost"
                  aria-label="Previous colour"
                  disabled={level === 0}
                  onClick={() => go(level - 1)}
                >
                  ‹
                </button>
                <label className="studio-pick">
                  <span className="sr-only">Colour to match</span>
                  <select value={level} onChange={(e) => go(Number(e.target.value))}>
                    {TARGETS.map((x, i) => (
                      <option key={x.name} value={i}>
                        {i + 1}. {x.name}
                        {saved.best[x.name] !== undefined
                          ? ` ${'★'.repeat(stars(fewest(targetColour(x))!.n, saved.best[x.name]))}`
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn btn-ghost"
                  aria-label="Next colour"
                  disabled={level === TARGETS.length - 1}
                  onClick={() => go(level + 1)}
                >
                  ›
                </button>
              </>
            )}
          </div>
          <div className="mix-paints" role="group" aria-label="Add a drop">
            {PAINTS.map((p, i) => (
              <button
                key={p.id}
                className="btn mix-paint"
                style={{ background: hex(SWATCH[i]), color: ink(SWATCH[i]) }}
                aria-label={`Add a drop of ${p.name.toLowerCase()}${drops[i] ? ` (${drops[i]} in)` : ''}`}
                aria-keyshortcuts={String(i + 1)}
                disabled={matched}
                onClick={() => add(i)}
              >
                {p.name}
                {drops[i] ? <span className="mix-count"> ×{drops[i]}</span> : null}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              onClick={undo}
              disabled={!history.length}
              aria-keyshortcuts="Z"
            >
              ↶ Undo a drop
            </button>
            <button className="btn btn-ghost" onClick={fresh} disabled={!n} aria-keyshortcuts="E">
              Empty the cup
            </button>
            {mode === 'match' ? (
              <button
                className="btn btn-ghost"
                onClick={hint}
                disabled={matched}
                aria-keyshortcuts="H"
              >
                💡 Hint
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={copy} disabled={!cup}>
                📋 Copy {cup ? hex(cup) : 'colour'}
              </button>
            )}
            <button
              className="btn btn-ghost"
              aria-pressed={sound}
              onClick={() => setSound((s) => !s)}
            >
              {sound ? '🔔 Sound' : '🔕 Muted'}
            </button>
          </div>
          <p className="mix-reading" aria-live="polite">
            {mode === 'match'
              ? cup
                ? `${comparison} ${n} drop${n === 1 ? '' : 's'}${matched ? '' : ` · ${Math.round(off * 1000)} apart, a match is under ${MATCH * 1000}`}`
                : `Match ${t.name} — add drops of paint to the cup.`
              : cup
                ? `${recipe.join(', ')} → ${hex(cup)}`
                : 'Add drops of paint to the cup.'}
          </p>
          <p className="muted lab-hint" aria-live="polite">
            {note && <strong>{note} </strong>}
            {matched && level < TARGETS.length - 1 && (
              <>
                <button className="btn" onClick={() => go(level + 1)}>
                  Next colour ›
                </button>{' '}
              </>
            )}
            These mix like paint, not like light: each one swallows some colours and gives back the
            rest, so yellow and blue make green rather than grey. Drops cannot be taken out — only
            undone.
            {saved.best[t.name] !== undefined &&
              mode === 'match' &&
              ` Your best for ${t.name}: ${saved.best[t.name]} drops.`}{' '}
            Keys: 1–5 paints, Z undo, E empty, H hint.
          </p>
        </>
      )}
    </div>
  )
}
