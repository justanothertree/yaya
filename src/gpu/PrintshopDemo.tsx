import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { LabStage } from './LabStage'
import {
  BH,
  BW,
  FILE_LIMIT,
  GOUGES,
  INKS,
  MAX_POINTS,
  MAX_STEPS,
  PRINTSHOP_KEY,
  layout,
  follow,
  readWork,
  undoable,
  type Cut,
  type Gouge,
  type Step,
  type V2,
} from './printshop'
import { createShop, type Shop } from './printshopEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const GOUGE_NAMES = Object.keys(GOUGES) as Gouge[]
const load = () => {
  try {
    const text = localStorage.getItem(PRINTSHOP_KEY)
    const v = JSON.parse(text ?? 'null') as {
      gouge?: unknown
      ink?: unknown
      pressure?: unknown
    } | null
    const steps = text ? readWork(text) : []
    const ink = v?.ink
    const pressure = v?.pressure
    return {
      steps: typeof steps === 'string' ? [] : steps,
      gouge: GOUGE_NAMES.find((g) => g === v?.gouge) ?? 'u',
      ink:
        Number.isInteger(ink) && (ink as number) >= 0 && (ink as number) < INKS.length
          ? (ink as number)
          : 0,
      pressure: typeof pressure === 'number' && pressure >= 0.3 && pressure <= 1 ? pressure : 0.85,
    }
  } catch {
    return { steps: [] as Step[], gouge: 'u' as Gouge, ink: 0, pressure: 0.85 }
  }
}
const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
/** a point of the stage on the block, in texels, kept within reach of its edges */
const onBlockAt = (e: PointerEvent<HTMLCanvasElement>): V2 => {
  const r = e.currentTarget.getBoundingClientRect()
  const { s, block } = layout([r.width, r.height])
  const x = (e.clientX - r.left - block[0]) / s
  const y = (e.clientY - r.top - block[1]) / s
  return [Math.round(clamp(x, -8, BW + 8) * 10) / 10, Math.round(clamp(y, -8, BH + 8) * 10) / 10]
}
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const onBlock = (p: V2) => p[0] >= -4 && p[1] >= -4 && p[0] <= BW + 4 && p[1] <= BH + 4

export function PrintshopDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(load()).current
  const [live, setLive] = useState(false)
  /** every cut and print so far, in order: the block and the paper are these, replayed */
  const [steps, setStepsState] = useState<Step[]>(saved.steps)
  const [gouge, setGouge] = useState<Gouge>(saved.gouge)
  const [ink, setInk] = useState(saved.ink)
  const [pressure, setPressure] = useState(saved.pressure)
  const [note, setNote] = useState<string | null>(null)
  const engine = useRef<Shop | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** the steps as they are now, ahead of React: a long stroke commits more than once a render */
  const stepsNow = useRef(steps)
  /** the cut being drawn */
  const cutting = useRef<Cut | null>(null)
  /** the work as it was before 🔄 New block, so Undo can bring it back */
  const cleared = useRef<Step[] | null>(null)

  const setSteps = (next: Step[]) => {
    stepsNow.current = next
    setStepsState(next)
  }
  const commit = (s: Step) => {
    cleared.current = null
    setSteps([...stepsNow.current, s])
  }

  useEffect(() => {
    try {
      localStorage.setItem(PRINTSHOP_KEY, JSON.stringify({ steps, gouge, ink, pressure }))
    } catch {
      setNote('This browser would not keep the print — ⬇ Save it to a file to be sure of it.')
    }
  }, [steps, gouge, ink, pressure])

  const pulls = steps.filter((s) => 'pull' in s).length
  const cuts = steps.length - pulls
  // after a print there is nothing to undo, but the button stays to say why rather than going dead
  const canUndo = steps.length > 0 || !!cleared.current
  const lastInk = [...steps].reverse().find((s) => 'pull' in s)
  const full = steps.length >= MAX_STEPS

  const undo = () => {
    if (!steps.length && cleared.current) {
      const back = cleared.current
      cleared.current = null
      engine.current?.replay(back)
      setSteps(back)
      return setNote('The block and the print are back.')
    }
    if (!undoable(stepsNow.current)) {
      if (stepsNow.current.length)
        setNote('A cut that has been printed is in the block for good, as on a real one.')
      return
    }
    const next = stepsNow.current.slice(0, -1)
    engine.current?.replay(next)
    setSteps(next)
    setNote(null)
  }
  const pull = () => {
    if (stepsNow.current.length >= MAX_STEPS)
      return setNote(`${MAX_STEPS} cuts and prints is as many as one block takes.`)
    const p = { ink, pressure, seed: Math.floor(Math.random() * 2 ** 31) }
    engine.current?.pull(p)
    commit({ pull: p })
    const name = INKS[ink].name
    setNote(
      `Printed ${name}. Now cut away whatever should stay ${name.toLowerCase()}, and print a darker ink over it.`,
    )
    if (!running) setRunning(true)
  }
  const fresh = () => {
    if (!stepsNow.current.length) return
    cleared.current = stepsNow.current
    engine.current?.replay([])
    setStepsState([])
    stepsNow.current = []
    setNote('A fresh block and a clean sheet. (↶ Undo brings the last one back.)')
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === 'u' || k === 'backspace') undo()
    else if (k === 'p') pull()
    else if (k === '1' || k === '2' || k === '3') setGouge(GOUGE_NAMES[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const status = steps.length
    ? `${cuts} ${cuts === 1 ? 'cut' : 'cuts'} · ${pulls} ${pulls === 1 ? 'colour' : 'colours'} printed${lastInk && 'pull' in lastInk ? ` · last: ${INKS[lastInk.pull.ink].name}` : ''}`
    : 'Uncut block, blank sheet'

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Print shop">
      <LabStage
        label="A lino block on the left (or above) and the sheet it prints on beside it; drag on the block to carve it"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createShop(device, context, format, canvas)
          engine.current = v
          v.replay(stepsNow.current)
          return {
            frame: () => v.frame(),
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const at = onBlockAt(e)
          if (!onBlock(at)) return
          if (stepsNow.current.length >= MAX_STEPS)
            return setNote(`${MAX_STEPS} cuts and prints is as many as one block takes.`)
          const c: Cut = { g: gouge, pts: [at] }
          cutting.current = c
          engine.current?.carve(c)
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const c = cutting.current
          if (!c) return
          const q = onBlockAt(e)
          const piece = follow(c.pts, q)
          if (!piece) return
          // carving is a minimum, so the new piece alone carves the same as the whole stroke again
          engine.current?.carve({ g: c.g, pts: piece })
          if (c.pts.length >= MAX_POINTS) {
            // a long stroke is kept as several cuts, each one as it was carved
            commit({ cut: c })
            cutting.current = stepsNow.current.length < MAX_STEPS ? { g: c.g, pts: [q] } : null
          }
        }}
        onPointerUp={() => {
          const c = cutting.current
          cutting.current = null
          if (c) commit({ cut: c })
        }}
      />

      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Gouge">
            {GOUGE_NAMES.map((g) => (
              <button
                key={g}
                className="btn btn-ghost"
                aria-pressed={gouge === g}
                onClick={() => setGouge(g)}
              >
                {GOUGES[g].label}
              </button>
            ))}
          </div>
          <span className="lab-score" aria-live="polite">
            {status}
          </span>
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <label className="studio-pick">
            <span className="muted">Ink</span>
            <select value={ink} onChange={(e) => setInk(Number(e.target.value))}>
              {INKS.map((c, k) => (
                <option key={c.name} value={k}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="appearance-slider lab-flow">
            <span className="muted">Pressure</span>
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.05}
              value={pressure}
              onChange={(e) => setPressure(Number(e.target.value))}
            />
          </label>
          <button className="btn" onClick={pull} disabled={full}>
            🖨 Print it
          </button>
          <button className="btn btn-ghost" onClick={undo} disabled={!canUndo}>
            ↶ Undo
          </button>
          <button className="btn btn-ghost" onClick={fresh} disabled={!steps.length}>
            🔄 New block
          </button>
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <button
            className="btn btn-ghost"
            disabled={!pulls}
            onClick={async () => {
              const blob = await engine.current?.png()
              if (blob) download(blob, 'print.png')
              else setNote('The print could not be read back from the GPU.')
            }}
          >
            ⬇ Save picture
          </button>
          <button
            className="btn btn-ghost"
            disabled={!steps.length}
            onClick={() =>
              download(
                new Blob([JSON.stringify({ steps })], { type: 'application/json' }),
                'linocut.json',
              )
            }
          >
            ⬇ Save block
          </button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            ⬆ Open block…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              const r =
                f.size <= FILE_LIMIT
                  ? readWork(await f.text())
                  : 'That file is too big to be a print.'
              if (typeof r === 'string') return setNote(r)
              cleared.current = stepsNow.current.length ? stepsNow.current : null
              engine.current?.replay(r)
              setSteps(r)
              setNote(`Opened ${f.name}.`)
            }}
          />
        </div>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <strong>{note} </strong>}
          Drag on the block to carve it, then 🖨 Print it. What you carve away stays the colour of
          the paper; what still stands takes the ink. That is a reduction print: cut, print the
          lightest ink, cut away what should keep that colour, print a darker one over it — the same
          block every time. Cuts since the last print can be undone; printed ones are there for
          good. The print is the block turned over, so write words backwards. U undoes, P prints,
          1–3 pick a gouge.
        </p>
      )}
    </div>
  )
}
