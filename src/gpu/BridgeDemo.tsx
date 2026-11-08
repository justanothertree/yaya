import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  BRIDGE_KEY,
  LEVELS,
  MATERIALS,
  addMember,
  canJoint,
  cost,
  fitScene,
  jointAt,
  packMembers,
  readSaved,
  reference,
  removeMember,
  simulate,
  start,
  step,
  toWorld,
  type Design,
  type Kind,
  type Refusal,
  type Saved,
  type Sim,
  type V2,
} from './bridge'
import { createBridge, type BridgeView } from './bridgeEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Tool = Kind | 'erase'
const REFUSED: Record<Exclude<Refusal, null>, string> = {
  same: 'That is the same point.',
  long: 'Too long — a member can be at most 4.5 m. Put a joint in between.',
  exists: 'Those two are joined already.',
  kind: 'This level has none of that.',
}
const clone = (d: Design): Design => structuredClone(d)

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(BRIDGE_KEY))
  } catch {
    return readSaved(null)
  }
}

/** the distance from p to the segment a–b, in metres */
const toSeg = (p: V2, a: V2, b: V2) => {
  const ab: V2 = [b[0] - a[0], b[1] - a[1]]
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)),
  )
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t)
}

export function BridgeDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(load()).current
  const [live, setLive] = useState(false)
  const [level, setLevel] = useState(saved.level)
  const l = LEVELS[level]
  const [designs, setDesigns] = useState<Record<string, Design>>(saved.designs)
  const design = designs[l.name] ?? start(l)
  const [best, setBest] = useState(saved.best)
  const [tool, setTool] = useState<Tool>('road')
  const [pending, setPending] = useState<V2 | null>(null)
  const [cursor, setCursor] = useState<V2 | null>(null)
  const [history, setHistory] = useState<Design[]>([])
  const [shown, setShown] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [driving, setDriving] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [sound, setSound] = useState(true)
  const price = cost(design)
  const over = price > l.budget

  const engine = useRef<BridgeView | null>(null)
  const sim = useRef<Sim | null>(null)
  const hover = useRef<V2 | null>(null)
  const told = useRef<Sim | null>(null)
  const clock = useRef(0)
  const voices = useRef(new Map<string, number>())
  const now = useRef({ l, design, pending, cursor, driving })
  now.current = { l, design, pending, cursor, driving }

  useEffect(() => {
    try {
      localStorage.setItem(BRIDGE_KEY, JSON.stringify({ level, designs, best }))
    } catch {
      /* private mode: it stays for this visit */
    }
  }, [level, designs, best])

  useEffect(
    () => () => {
      for (const [id, t] of voices.current) {
        window.clearTimeout(t)
        noteOff(id)
      }
      voices.current.clear()
    },
    [],
  )
  const play = (instrument: 'pluck' | 'bell' | 'marimba', midi: number, ms = 400, wait = 0) => {
    if (!sound || voices.current.size > 10) return
    const id = `bridge-${midi}-${performance.now()}-${wait}`
    voices.current.set(
      id,
      window.setTimeout(() => {
        noteOn(id, instrument, midi)
        voices.current.set(
          id,
          window.setTimeout(() => {
            noteOff(id)
            voices.current.delete(id)
          }, ms),
        )
      }, wait),
    )
  }

  /** the design shown while building: its joints where they were drawn, no forces */
  const showDesign = (d: Design, selected = -1) => {
    const v = engine.current
    if (!v) return
    const p = d.joints.map((j) => [j.x, j.y] as V2)
    v.members(packMembers(d, p, null, null, selected))
    v.joints(
      p,
      d.joints.map((j) => j.fixed),
      -1,
    )
  }
  useEffect(() => {
    if (!driving) showDesign(design)
  }, [design, driving])

  const change = (next: Design) => {
    setHistory((h) => [...h.slice(-49), clone(design)])
    setDesigns((all) => ({ ...all, [l.name]: next }))
    setOutcome(null)
  }

  const go = (k: number) => {
    stop()
    setLevel(Math.max(0, Math.min(LEVELS.length - 1, k)))
    setPending(null)
    setCursor(null)
    setHistory([])
    setShown(false)
    setNote(null)
    setOutcome(null)
    setTool('road')
  }

  /** a grid point pressed: start a member there, finish one, or erase what is under it */
  const press = (pt: V2, exact: V2) => {
    if (driving) return
    const [x, y] = pt
    if (tool === 'erase') {
      let bestI = -1
      let bestD = 0.4
      design.members.forEach((m, i) => {
        const d = toSeg(
          exact,
          [design.joints[m.a].x, design.joints[m.a].y],
          [design.joints[m.b].x, design.joints[m.b].y],
        )
        if (d < bestD) {
          bestD = d
          bestI = i
        }
      })
      if (bestI < 0) return setNote('Nothing there to take away.')
      const next = clone(design)
      removeMember(next, bestI)
      change(next)
      play('pluck', 55, 200)
      return setNote(null)
    }
    const exists = design.joints.some((j) => j.x === x && j.y === y)
    if (!exists && !canJoint(l, x, y))
      return setNote(
        y < 0 && (x <= 0 || x >= l.span) ? 'That is solid rock.' : 'A joint cannot go there.',
      )
    if (!pending) {
      setPending(pt)
      return setNote(null)
    }
    if (pending[0] === x && pending[1] === y) {
      setPending(null)
      return
    }
    const next = clone(design)
    const a = jointAt(l, next, pending[0], pending[1], true)
    const b = jointAt(l, next, x, y, true)
    const why = addMember(l, next, a, b, tool)
    if (why) return setNote(REFUSED[why])
    change(next)
    setPending(pt) // keep drawing from here
    setNote(null)
    play('pluck', tool === 'steel' ? 67 : tool === 'road' ? 60 : 64, 200)
  }

  const undo = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    setDesigns((all) => ({ ...all, [l.name]: prev }))
    setPending(null)
    setOutcome(null)
  }

  const drive = () => {
    if (driving) return stop()
    setPending(null)
    sim.current = simulate(l, clone(design))
    setDriving(true)
    setOutcome(null)
    if (!running) setRunning(true)
  }
  const stop = () => {
    sim.current = null
    setDriving(false)
  }

  /** the drive has ended: say what happened, keep a best if it was one */
  const finish = (s: Sim) => {
    const broke = s.broken.filter(Boolean).length
    if (s.outcome === 'across') {
      const valid = !over && !shown
      setOutcome(
        `✨ Across for ${price.toLocaleString()} of ${l.budget.toLocaleString()}` +
          (over
            ? ' — but that is over budget, so it does not count.'
            : shown
              ? ' (shown, so not kept as a best).'
              : '.'),
      )
      if (valid) setBest((b) => (b[l.name] && b[l.name] <= price ? b : { ...b, [l.name]: price }))
      ;[72, 76, 79].forEach((m, i) => play('bell', m, 700, i * 130))
    } else if (s.outcome === 'fell')
      setOutcome(
        `💥 The cart fell${broke ? ` — ${broke} ${broke === 1 ? 'member' : 'members'} broke` : ''}. The red ones were working hardest.`,
      )
    else setOutcome('The cart stopped — is the road joined all the way across?')
    if (s.outcome !== 'across') play('marimba', 40, 600)
  }
  const finishNow = useRef(finish)
  finishNow.current = finish

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key
    const c = cursor ?? [0, 0]
    const move = (dx: number, dy: number) => {
      const next: V2 = [
        Math.max(-2, Math.min(l.span + 2, c[0] + dx)),
        Math.max(-l.water + 1, Math.min(6, c[1] + dy)),
      ]
      setCursor(next)
      hover.current = next
    }
    if (k === 'ArrowRight') move(1, 0)
    else if (k === 'ArrowLeft') move(-1, 0)
    else if (k === 'ArrowUp') move(0, 1)
    else if (k === 'ArrowDown') move(0, -1)
    else if (k === 'Enter' || k === ' ') press(c, c)
    else if (k === 'Escape') setPending(null)
    else if (k.toLowerCase() === 'd') drive()
    else if (k.toLowerCase() === 'u') undo()
    else if (/^[1-4]$/.test(k)) {
      const tools: Tool[] = [...l.kinds, 'erase']
      const t = tools[Number(k) - 1]
      if (t) setTool(t)
    } else return
    e.preventDefault()
  }

  const at = (e: { currentTarget: HTMLCanvasElement; clientX: number; clientY: number }) => {
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    const k = c.width / r.width
    const exact = toWorld(fitScene(l, [c.width, c.height]), [
      (e.clientX - r.left) * k,
      (e.clientY - r.top) * k,
    ])
    return { exact, pt: [Math.round(exact[0]), Math.round(exact[1])] as V2 }
  }

  const describeCursor = () => {
    if (!cursor) return ''
    const j = design.joints.some((q) => q.x === cursor[0] && q.y === cursor[1])
    return ` Cursor ${cursor[0]} m along, ${cursor[1]} m ${cursor[1] < 0 ? 'down' : 'up'}: ${
      j ? 'a joint' : canJoint(l, cursor[0], cursor[1]) ? 'empty' : 'rock or water'
    }${pending ? `, drawing from ${pending[0]}, ${pending[1]}` : ''}.`
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Bridge">
      <LabStage
        label={`Bridge, level ${level + 1}: ${l.name}, a ${l.span} m gap. ${design.members.length} members costing ${price} of ${l.budget}.${describeCursor()}`}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createBridge(device, context, format, canvas)
          engine.current = v
          showDesign(now.current.design)
          return {
            frame: (dt: number) => {
              clock.current += dt
              const n = now.current
              const s = sim.current
              if (n.driving && s) {
                if (dt > 0) step(s)
                v.members(
                  packMembers(
                    s.design,
                    s.p,
                    s.force.map(
                      (f, i) => Math.abs(f) / MATERIALS[s.design.members[i].kind].strength,
                    ),
                    s.broken,
                    -1,
                  ),
                )
                v.joints(
                  s.p,
                  s.design.joints.map((j) => j.fixed),
                  -1,
                )
                // said once per drive: the frame loop sees an ended drive every frame after
                if (s.outcome !== 'driving' && told.current !== s) {
                  told.current = s
                  finishNow.current(s)
                }
              }
              const h = hover.current
              v.frame({
                level: n.l,
                cart: s && n.driving ? [s.cart.x, s.cart.y] : [-3, 0],
                time: clock.current,
                building: !n.driving,
                ghost:
                  !n.driving && n.pending && h ? [n.pending[0], n.pending[1], h[0], h[1]] : null,
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const { exact, pt } = at(e)
          hover.current = pt
          press(pt, exact)
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          hover.current = at(e).pt
        }}
      />

      {live && (
        <div className="lab-controls">
          <button
            className="btn btn-ghost"
            aria-label="Previous level"
            disabled={level === 0}
            onClick={() => go(level - 1)}
          >
            ‹
          </button>
          <label className="studio-pick">
            <span className="sr-only">Level</span>
            <select value={level} onChange={(e) => go(Number(e.target.value))}>
              {LEVELS.map((q, i) => (
                <option key={q.name} value={i}>
                  {i + 1}. {q.name}
                  {best[q.name] ? ` ✓ ${best[q.name].toLocaleString()}` : ''}
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
          <span className="lab-score" aria-live="polite" data-over={over || undefined}>
            {price.toLocaleString()} / {l.budget.toLocaleString()}
            {over ? ' — over budget' : ''}
          </span>
          <button className="btn" onClick={drive}>
            {driving ? '⏹ Back to building' : '🚚 Drive'}
          </button>
        </div>
      )}
      {live && !driving && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="What a tap builds">
            {[...l.kinds, 'erase' as const].map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={tool === t}
                onClick={() => {
                  setTool(t)
                  setPending(null)
                }}
              >
                {t === 'erase'
                  ? '🧽 Erase'
                  : `${t === 'road' ? '🛣' : t === 'wood' ? '🪵' : '🔩'} ${MATERIALS[t].label}`}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={undo} disabled={!history.length}>
            ↶ Undo
          </button>
          <button
            className="btn btn-ghost"
            disabled={!design.members.length}
            onClick={() => {
              change(start(l))
              setPending(null)
              setShown(false)
            }}
          >
            🧹 Clear
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              change(reference(level))
              setShown(true)
              setPending(null)
              setNote(
                'A bridge that works — drive it, then try to build one for less. (Not kept as a best.)',
              )
            }}
          >
            💡 One that works
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((v) => !v)}
          >
            {sound ? '🔔 Sound' : '🔕 Muted'}
          </button>
        </div>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {outcome && <strong>{outcome} </strong>}
          {note && <strong>{note} </strong>}
          <em>{l.hint}</em> Tap a dot, then another, to lay a member between them — it keeps drawing
          from the last dot; tap it again to stop. The cart drives on 🛣 road only. Members show how
          hard they are working as it crosses: green is easy, red is at its limit.
          {best[l.name] ? ` Your cheapest crossing: ${best[l.name].toLocaleString()}.` : ''} Keys:
          arrows move, Enter lays, Esc stops drawing, D drives, U undoes, 1–{l.kinds.length + 1}{' '}
          choose.
        </p>
      )}
    </div>
  )
}
