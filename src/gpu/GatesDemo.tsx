import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  GATES_KEY,
  IO,
  KINDS,
  LEVELS,
  check,
  connect,
  disconnect,
  fitBoard,
  gateAt,
  labelsFor,
  loops,
  move,
  nameOf,
  nearestPin,
  pinName,
  place,
  readSaved,
  remove,
  shapes,
  sinks,
  sources,
  spread,
  stars,
  toBoard,
  used,
  type Circuit,
  type Kind,
  type Saved,
} from './gates'
import { createGates, type GatesView } from './gatesEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const EMPTY: Circuit = { gates: [], wires: {} }
const MAX_UNDO = 100

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(GATES_KEY))
  } catch {
    return { circuits: {}, best: {} }
  }
}

/** the switches for a row of the table, in counting order */
const rowBits = (row: number, n: number) =>
  Array.from({ length: n }, (_, i) => (row >> (n - 1 - i)) & 1)

type Drag =
  | { kind: 'wire'; from: string; to: [number, number]; target: string | null; moved: boolean }
  | { kind: 'gate'; id: number; grab: [number, number] }

export function GatesDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [saved, setSaved] = useState<Saved>(load)
  const [level, setLevel] = useState(() => {
    const s = load()
    return Math.max(
      0,
      LEVELS.findIndex((l) => s.best[l.name] === undefined),
    )
  })
  const l = LEVELS[level]
  const circuit = saved.circuits[l.name] ?? EMPTY
  const [row, setRow] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sound, setSound] = useState(true)
  const undo = useRef<{ level: string; c: Circuit }[]>([])
  const engine = useRef<GatesView | null>(null)
  const clock = useRef(0)
  const timers = useRef<number[]>([])

  useEffect(() => {
    try {
      localStorage.setItem(GATES_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t)
      for (const m of [60, 64, 67, 72]) noteOff(`gates-${m}`)
    },
    [],
  )

  const ins = rowBits(row, l.inputs.length)
  const result = useMemo(() => check(l, circuit), [l, circuit])
  const count = used(circuit, l)

  /** a change to this level's circuit: kept, undoable, and checked */
  const change = (next: Circuit, quiet = false) => {
    if (next === circuit) return
    undo.current.push({ level: l.name, c: circuit })
    if (undo.current.length > MAX_UNDO) undo.current.shift()
    const was = check(l, circuit).solved
    const now = check(l, next)
    const n = used(next, l)
    setSaved((s) => ({
      circuits: { ...s.circuits, [l.name]: next },
      best:
        now.solved && (s.best[l.name] === undefined || n < s.best[l.name])
          ? { ...s.best, [l.name]: n }
          : s.best,
    }))
    if (now.solved && !was) {
      const k = stars(l, n)
      setNote(
        `✨ It works — every row of the table. ${n} gate${n === 1 ? '' : 's'}, where ${l.par} is the fewest found. ${'★'.repeat(k)}${'☆'.repeat(3 - k)}`,
      )
      if (sound)
        [60, 64, 67, 72].forEach((m, i) => {
          const id = `gates-${m}`
          timers.current.push(
            window.setTimeout(() => noteOn(id, 'bell', m), i * 100),
            window.setTimeout(() => noteOff(id), i * 100 + 700),
          )
        })
    } else if (!quiet) setNote(null)
    if (!running) setRunning(true)
  }

  const go = (k: number) => {
    const n = Math.max(0, Math.min(LEVELS.length - 1, k))
    setLevel(n)
    setRow(0)
    setSelected(null)
    setPending(null)
    setDrag(null)
    setNote(null)
  }

  const add = (kind: Kind) => {
    const next = place(circuit, kind)
    if (!next) return setNote('The board is full — remove a gate to make room.')
    change(next)
    setSelected(next.gates[next.gates.length - 1].id)
  }
  const wire = (from: string, to: string) => {
    const next = connect(l, circuit, from, to)
    if (!next) {
      setNote(
        loops(circuit, from, to)
          ? 'That wire would feed a gate its own output, round in a circle — not allowed here.'
          : 'A wire runs from an output (right side of a gate, or a switch) to an input.',
      )
      return false
    }
    change(next)
    return true
  }
  const doUndo = () => {
    for (let k = undo.current.length - 1; k >= 0; k--) {
      if (undo.current[k].level !== l.name) continue
      const [u] = undo.current.splice(k, 1)
      setSaved((s) => ({ ...s, circuits: { ...s.circuits, [l.name]: u.c } }))
      setNote(null)
      return
    }
  }
  const flip = (i: number) => setRow((r) => r ^ (1 << (l.inputs.length - 1 - i)))

  /* ── what the stage draws, rebuilt whenever any of it changes */
  const scene = () => {
    const wrong = l.outputs.map((_, i) => result.rows[row]?.got[i] !== result.rows[row]?.want[i])
    const look = {
      selected,
      dragging: drag?.kind === 'wire' ? { from: drag.from, to: drag.to } : null,
      target: drag?.kind === 'wire' ? drag.target : pending,
      wrong,
    }
    return shapes(l, circuit, ins, look)
  }
  const send = (v: GatesView) => {
    const s = scene()
    v.scene(s.data, s.count, labelsFor(l))
  }
  const sendNow = useRef(send)
  sendNow.current = send
  useEffect(() => {
    if (engine.current) send(engine.current)
  })

  /* ── the pointer on the stage */
  const boardPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const k = el.width / r.width
    return toBoard(fitBoard([el.width, el.height]), [(e.clientX - r.left) * k, (e.clientY - r.top) * k]) // prettier-ignore
  }
  /** how far from a pin a press still takes it, in board units: at least 16 CSS pixels — on a
   *  phone a unit is about 15px, so the 0.6 units that suit a mouse are a 9px target. Pins are
   *  nearest-first, so a long reach never takes the wrong one of two close together. */
  const reachOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const el = e.currentTarget
    const css = fitBoard([el.width, el.height]).s / (el.width / el.getBoundingClientRect().width)
    return Math.min(1.2, Math.max(0.6, 16 / css))
  }
  const switchAt = (p: [number, number]) =>
    p[0] >= IO.inset && p[0] <= IO.inset + IO.w
      ? l.inputs.findIndex((_, i) => Math.abs(p[1] - spread(i, l.inputs.length)) <= IO.h / 2)
      : -1
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = boardPoint(e)
    const pin = nearestPin(l, circuit, p, 'any', reachOf(e))
    if (pin && pending && sinks(l, circuit).includes(pin)) {
      // the second tap of tap-then-tap wiring
      wire(pending, pin)
      setPending(null)
      return
    }
    if (pin && sources(l, circuit).includes(pin)) {
      setDrag({ kind: 'wire', from: pin, to: p, target: null, moved: false })
    } else if (pin && circuit.wires[pin]) {
      // an input that has a wire: pick that wire up by its end, to move it or let it go
      const from = circuit.wires[pin]
      change(disconnect(circuit, pin), true)
      setDrag({ kind: 'wire', from, to: p, target: pin, moved: true })
    } else {
      const g = gateAt(circuit, p)
      const s = switchAt(p)
      if (g) {
        setSelected(g.id)
        setDrag({ kind: 'gate', id: g.id, grab: [p[0] - g.x, p[1] - g.y] })
      } else if (s >= 0) flip(s)
      else {
        setSelected(null)
        setPending(null)
      }
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* a synthetic pointer: the press has already happened */
    }
    if (!running) setRunning(true)
  }
  const moveTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drag) return
    const p = boardPoint(e)
    if (drag.kind === 'wire') {
      const target = nearestPin(l, circuit, p, 'sink', reachOf(e))
      const moved = drag.moved || Math.hypot(p[0] - drag.to[0], p[1] - drag.to[1]) > 0.3
      setDrag({ ...drag, to: p, target, moved })
    } else {
      const next = move(circuit, drag.id, [p[0] - drag.grab[0], p[1] - drag.grab[1]])
      if (next !== circuit) setSaved((s) => ({ ...s, circuits: { ...s.circuits, [l.name]: next } }))
    }
  }
  const up = () => {
    if (drag?.kind === 'wire') {
      if (drag.target && drag.moved) wire(drag.from, drag.target)
      else if (!drag.moved) {
        // a tap on an output: it waits for an input to be tapped
        setPending(drag.from)
        setNote(`Now tap an input to wire ${pinName(l, circuit, drag.from)} to it.`)
      }
    }
    setDrag(null)
  }

  /* ── keys on the stage: Delete a selected gate, arrows nudge it, 1–4 flip switches */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.target !== e.currentTarget) return
    const g = circuit.gates.find((x) => x.id === selected)
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-0.5, 0],
      ArrowRight: [0.5, 0],
      ArrowUp: [0, -0.5],
      ArrowDown: [0, 0.5],
    }
    if (/^[1-4]$/.test(e.key) && Number(e.key) <= l.inputs.length) flip(Number(e.key) - 1)
    else if ((e.key === 'Delete' || e.key === 'Backspace') && g) {
      change(remove(circuit, g.id))
      setSelected(null)
    } else if (nudge[e.key] && g)
      change(move(circuit, g.id, [g.x + nudge[e.key][0], g.y + nudge[e.key][1]]))
    else if (e.key.toLowerCase() === 'z') doUndo()
    else return
    e.preventDefault()
  }

  /* ── words */
  const best = saved.best[l.name]
  const sel = circuit.gates.find((x) => x.id === selected)
  const sourceOptions = (forKey: string) =>
    sources(l, circuit).filter((s) => !loops(circuit, s, forKey))
  const stageLabel = `Logic gates, level ${level + 1}: ${l.name}. Switches ${l.inputs.map((n, i) => `${n} ${ins[i] ? 'on' : 'off'}`).join(', ')}; lamps ${l.outputs.map((n, i) => `${n} ${result.rows[row].got[i] ? 'lit' : 'dark'}`).join(', ')}. ${circuit.gates.length} gate${circuit.gates.length === 1 ? '' : 's'}. ${result.solved ? 'Every row of the table is right.' : `${result.rows.filter((r) => r.ok).length} of ${result.rows.length} rows right.`}`

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Logic gates">
      <LabStage
        label={stageLabel}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createGates(device, context, format, canvas)
          engine.current = v
          sendNow.current(v)
          return {
            frame: (dt: number) => {
              clock.current += dt
              v.frame(clock.current)
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={down}
        onPointerMove={moveTo}
        onPointerUp={up}
      />

      {live && (
        <>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-label="Previous level"
              disabled={level === 0}
              onClick={() => go(level - 1)}
            >
              ‹
            </button>
            <label className="studio-pick gates-pick">
              <span className="sr-only">Level</span>
              <select value={level} onChange={(e) => go(Number(e.target.value))}>
                {LEVELS.map((q, i) => (
                  <option key={q.name} value={i}>
                    {i + 1}. {q.name}
                    {saved.best[q.name] !== undefined
                      ? ` ${'★'.repeat(stars(q, saved.best[q.name]))}`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn-ghost"
              aria-label="Next level"
              disabled={level === LEVELS.length - 1}
              onClick={() => go(level + 1)}
            >
              ›
            </button>
            <button
              className="btn btn-ghost"
              onClick={doUndo}
              disabled={!undo.current.some((u) => u.level === l.name)}
              aria-keyshortcuts="Z"
            >
              ↶ Undo
            </button>
            <button
              className="btn btn-ghost"
              disabled={!circuit.gates.length && !Object.keys(circuit.wires).length}
              onClick={() => {
                change(EMPTY)
                setSelected(null)
              }}
            >
              Clear
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={sound}
              onClick={() => setSound((s) => !s)}
            >
              {sound ? '🔔 Sound' : '🔕 Muted'}
            </button>
          </div>
          <div className="lab-controls" role="group" aria-label="Add a gate">
            {l.palette.map((k) => (
              <button key={k} className="btn" onClick={() => add(k)}>
                + {k}
              </button>
            ))}
            {sel && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  change(remove(circuit, sel.id))
                  setSelected(null)
                }}
              >
                🗑 Remove {nameOf(circuit, sel.id)}
              </button>
            )}
          </div>

          <p className="muted lab-hint" aria-live="polite">
            {note && <strong>{note} </strong>}
            {result.solved && level < LEVELS.length - 1 && (
              <>
                <button className="btn" onClick={() => go(level + 1)}>
                  Next level ›
                </button>{' '}
              </>
            )}
            <strong>Build: </strong>
            {l.outputs.length === 1 ? 'a lamp' : 'lamps'} {l.outputs.join(', ')} that{' '}
            {l.outputs.length === 1 ? 'follows' : 'follow'} the table below. <em>{l.hint}</em> Drag
            from a gate’s right side (or a switch) to an input, or tap one then the other; drag a
            gate to move it; tap a switch to flip it.
            {best !== undefined && ` Your best: ${best} gate${best === 1 ? '' : 's'}.`}
            {result.loose.length > 0 &&
              !result.solved &&
              ` ${result.loose.length} input${result.loose.length === 1 ? ' has' : 's have'} no wire (orange rings) and read${result.loose.length === 1 ? 's' : ''} 0${result.loose.length > 3 ? '' : `: ${result.loose.map((k) => pinName(l, circuit, k)).join(', ')}`}.`}
          </p>

          <div className="gates-panels">
            <table className="gates-table">
              <caption>
                Truth table — {result.rows.filter((r) => r.ok).length} of {result.rows.length} rows
                right. Pick a row to set the switches.
              </caption>
              <thead>
                <tr>
                  {l.inputs.map((n) => (
                    <th key={n} scope="col">
                      {n}
                    </th>
                  ))}
                  {l.outputs.map((n) => (
                    <th key={n} scope="col">
                      {n}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="sr-only">Right?</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i} aria-current={i === row || undefined}>
                    {r.ins.map((v, k) => (
                      <td key={k}>
                        {k === 0 ? (
                          <button
                            className="gates-row"
                            aria-label={`Set the switches to row ${i + 1}: ${r.ins.join(' ')}`}
                            onClick={() => setRow(i)}
                          >
                            {v}
                          </button>
                        ) : (
                          v
                        )}
                      </td>
                    ))}
                    {r.want.map((v, k) => (
                      <td key={`w${k}`} className={r.got[k] === v ? '' : 'gates-bad'}>
                        {v}
                        {r.got[k] !== v && <span className="gates-got"> (yours {r.got[k]})</span>}
                      </td>
                    ))}
                    <td>{r.ok ? '✓' : '✗'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="gates-parts">
              <p className="gates-parts-head">
                Parts — {count} gate{count === 1 ? '' : 's'} in use
                {circuit.gates.length > count ? `, ${circuit.gates.length - count} spare` : ''}.
                Every wire can be set here too.
              </p>
              <ul>
                {circuit.gates.map((g) => (
                  <li key={g.id} aria-current={g.id === selected || undefined}>
                    <button
                      className="btn btn-ghost gates-part-name"
                      onClick={() => setSelected(g.id)}
                    >
                      {nameOf(circuit, g.id)}
                    </button>
                    {Array.from({ length: KINDS[g.kind].inputs }, (_, k) => {
                      const key = `g${g.id}.${k}`
                      return (
                        <label key={key} className="studio-pick">
                          <span className="muted">in {k + 1}</span>
                          <select
                            value={circuit.wires[key] ?? ''}
                            onChange={(e) =>
                              e.target.value
                                ? wire(e.target.value, key)
                                : change(disconnect(circuit, key))
                            }
                          >
                            <option value="">—</option>
                            {sourceOptions(key).map((s) => (
                              <option key={s} value={s}>
                                {pinName(l, circuit, s)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )
                    })}
                    <button
                      className="btn btn-ghost"
                      aria-label={`Remove ${nameOf(circuit, g.id)}`}
                      onClick={() => {
                        change(remove(circuit, g.id))
                        if (selected === g.id) setSelected(null)
                      }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
                {l.outputs.map((n, i) => (
                  <li key={n}>
                    <span className="gates-part-name">💡 {n}</span>
                    <label className="studio-pick">
                      <span className="muted">from</span>
                      <select
                        value={circuit.wires[`o${i}`] ?? ''}
                        onChange={(e) =>
                          e.target.value
                            ? wire(e.target.value, `o${i}`)
                            : change(disconnect(circuit, `o${i}`))
                        }
                      >
                        <option value="">—</option>
                        {sources(l, circuit).map((s) => (
                          <option key={s} value={s}>
                            {pinName(l, circuit, s)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="muted">
                Keys on the stage: 1–{l.inputs.length} flip switches, arrows nudge the selected
                gate, Delete removes it, Z undoes. Kept in this browser, per level.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
