import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { Holds, keySource } from './holds'
import { LabStage } from './LabStage'
import {
  DEFAULT_TABLE,
  FILE_LIMIT,
  HZ,
  PINBALL_KEY,
  addPart,
  erase,
  itemsOf,
  newGame,
  plunge,
  readTable,
  restFlippers,
  segmentsOf,
  step,
  tableFit,
  thin,
  type Game,
  type Table,
  type V2,
} from './pinball'
import { createPinball, type PinballView } from './pinballEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Mode = 'play' | 'build'
type Tool = 'wall' | 'bumper' | 'target' | 'erase'
const TOOLS: Record<Tool, string> = {
  wall: '✏️ Wall',
  bumper: '● Bumper',
  target: '◆ Target',
  erase: '🧽 Erase',
}
type Held = { left: boolean; right: boolean; plunger: boolean }
/** seconds of holding the plunger for a full pull */
const PULL_TIME = 0.9

const load = (): { table: Table; best: Record<string, number> } => {
  try {
    const v = JSON.parse(localStorage.getItem(PINBALL_KEY) ?? 'null') as {
      table?: unknown
      best?: Record<string, unknown>
    } | null
    const t = readTable(JSON.stringify(v?.table ?? null))
    const best: Record<string, number> = {}
    for (const [k, n] of Object.entries(v?.best ?? {}).slice(0, 50))
      if (typeof n === 'number' && Number.isInteger(n) && n >= 0) best[k.slice(0, 40)] = n
    return { table: typeof t === 'string' ? DEFAULT_TABLE : t, best }
  } catch {
    return { table: DEFAULT_TABLE, best: {} }
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
const onTable = (e: PointerEvent<HTMLCanvasElement>): V2 => {
  const r = e.currentTarget.getBoundingClientRect()
  return tableFit([r.width, r.height], [e.clientX - r.left, e.clientY - r.top])
}

export function PinballDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(load()).current
  const [live, setLive] = useState(false)
  const [mode, setMode] = useState<Mode>('play')
  const [table, setTable] = useState<Table>(saved.table)
  const [best, setBest] = useState<Record<string, number>>(saved.best)
  const [tool, setTool] = useState<Tool>('wall')
  const [sound, setSound] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [shown, setShown] = useState({ score: 0, balls: 3, over: false, waiting: true })
  const game = useRef<Game>(newGame(saved.table))
  const flippers = useRef(restFlippers())
  /** who is holding each control: keys, pads and fingers on the stage, each its own holder */
  const holds = useRef(new Holds<keyof Held>()).current
  const pull = useRef(0)
  const stroke = useRef<V2[] | null>(null)
  const trail = useRef<V2[]>([])
  const engine = useRef<PinballView | null>(null)
  const stale = useRef(true)
  const voices = useRef(new Map<string, number>())
  const now = useRef({ table, mode, sound, running })
  now.current = { table, mode, sound, running }
  /* a drag can send several moves before React draws again: build on the newest table */
  const tableNow = useRef(table)
  tableNow.current = table

  useEffect(() => {
    try {
      localStorage.setItem(PINBALL_KEY, JSON.stringify({ table, best }))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [table, best])

  /* sound stops when the toy goes: every note still ringing is let go and no timer outlives it */
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
  const play = (instrument: 'marimba' | 'bell' | 'pluck', midi: number, ms: number, delay = 0) => {
    if (!now.current.sound || voices.current.size > 24) return
    const id = `pinball-${midi}-${performance.now()}-${delay}`
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
      }, delay),
    )
  }

  const newBall = (t: Table = now.current.table) => {
    game.current = newGame(t)
    flippers.current = restFlippers()
    trail.current = []
    setShown({ score: 0, balls: game.current.balls, over: false, waiting: true })
  }
  const changeTable = (t: Table) => {
    tableNow.current = t
    setTable(t)
    stale.current = true
    newBall(t)
  }

  const hold = (what: keyof Held, source: string) => {
    holds.press(what, source)
    if (!now.current.running) setRunning(true)
  }
  /** the plunger fires when the last thing pulling it lets go */
  const letGo = (freed: (keyof Held)[]) => {
    if (freed.includes('plunger') && pull.current > 0) {
      plunge(game.current, pull.current)
      pull.current = 0
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const source = keySource(e)
    /* ⚠️ A RELEASE COUNTS WHEREVER FOCUS IS. A key held on the stage and let go after a click has moved
       focus to a button arrives from the button; ignoring it left the flipper up for good. A press on
       a control stays the control's (Space presses a button), and so does the release's default. */
    if (!down) {
      letGo(holds.releaseSource(source))
      if (e.target !== e.currentTarget) return
    } else if (e.target !== e.currentTarget && e.key !== 'Shift') return
    const k = e.key.toLowerCase()
    const side =
      k === 'z' || k === 'arrowleft' || e.code === 'ShiftLeft'
        ? 'left'
        : k === 'm' || k === '/' || k === 'arrowright' || e.code === 'ShiftRight'
          ? 'right'
          : k === ' ' || k === 'arrowdown'
            ? 'plunger'
            : null
    if (side && mode === 'play') {
      if (down) hold(side, source)
    } else if (down && k === 'n' && mode === 'play') newBall()
    else return
    e.preventDefault()
  }

  /** a hold button: pressed from the moment a finger lands on it until that finger lifts */
  const pad = (what: keyof Held) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* a pointer the browser no longer tracks */
      }
      hold(what, `pad:${e.pointerId}`)
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) =>
      letGo(holds.releaseSource(`pad:${e.pointerId}`)),
    onPointerCancel: (e: PointerEvent<HTMLButtonElement>) =>
      letGo(holds.releaseSource(`pad:${e.pointerId}`)),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  })

  const s = shown
  const record = best[table.name] ?? 0
  return (
    <div
      className="lab-keys"
      tabIndex={0}
      onKeyDown={(e) => onKey(e, true)}
      onKeyUp={(e) => onKey(e, false)}
      onBlur={(e) => {
        /* focus left the toy, so no release will reach it: let go of everything, launching nothing */
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          holds.clear()
          pull.current = 0
        }
      }}
      aria-label="Pinball workshop"
    >
      <LabStage
        label="A neon pinball table you can draw on, with two flippers and a plunger"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createPinball(device, context, format, canvas)
          engine.current = v
          stale.current = true
          let acc = 0
          let t = 0
          let lastBaked: Table | null = null
          return {
            frame: (dt: number) => {
              const n = now.current
              const g = game.current
              const tbl = tableNow.current
              const draft = stroke.current
              if (stale.current || tbl !== lastBaked || draft) {
                stale.current = false
                lastBaked = tbl
                const segs = segmentsOf(
                  draft && draft.length > 1 ? { ...tbl, walls: [...tbl.walls, thin(draft)] } : tbl,
                )
                v.bake(segs, itemsOf(tbl, null))
              }
              t += dt
              if (n.mode === 'play' && dt > 0) {
                const held = {
                  left: holds.has('left'),
                  right: holds.has('right'),
                  plunger: holds.has('plunger'),
                }
                if (held.plunger && g.waiting)
                  pull.current = Math.min(1, pull.current + dt / PULL_TIME)
                acc = Math.min(acc + dt, 0.05)
                const before = { score: g.score, balls: g.balls, over: g.over, waiting: g.waiting }
                let sounds = 0
                while (acc >= 1 / HZ) {
                  acc -= 1 / HZ
                  step(g, tbl, flippers.current, held)
                  for (const h of g.hits) {
                    if (sounds > 3) break
                    sounds++
                    if (h.kind === 'bumper') play('marimba', 67 + ((h.k * 5) % 12), 160)
                    else if (h.kind === 'target') play('bell', 76 + ((h.k * 3) % 8), 300)
                    else if (h.kind === 'bonus')
                      [0, 4, 7, 12].forEach((k, i) => play('bell', 79 + k, 300, i * 90))
                    else if (h.kind === 'drain') play('pluck', 40, 500)
                  }
                }
                const b = g.ball
                const last = trail.current[trail.current.length - 1]
                if (!last || Math.hypot(b.x - last[0], b.y - last[1]) > 0.12) {
                  trail.current.push([b.x, b.y])
                  if (trail.current.length > 32) trail.current.shift()
                }
                if (
                  g.score !== before.score ||
                  g.balls !== before.balls ||
                  g.over !== before.over ||
                  g.waiting !== before.waiting
                ) {
                  setShown({ score: g.score, balls: g.balls, over: g.over, waiting: g.waiting })
                  if (g.over)
                    setBest((bb) =>
                      (bb[tbl.name] ?? 0) >= g.score ? bb : { ...bb, [tbl.name]: g.score },
                    )
                }
              } else acc = 0
              v.frame({
                ball: [g.ball.x, g.ball.y],
                pull: g.waiting ? pull.current : 0,
                flippers: flippers.current,
                items: itemsOf(tbl, g),
                trail: g.waiting ? [] : trail.current,
                time: t,
                building: n.mode === 'build',
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const p = onTable(e)
          if (mode === 'play') {
            // a finger on the left of the table works the left flipper, on the right the right one;
            // while the ball waits in the lane, any finger pulls the plunger
            const what: keyof Held = game.current.waiting
              ? 'plunger'
              : p[0] < 4.6
                ? 'left'
                : 'right'
            hold(what, `stage:${e.pointerId}`)
            return
          }
          const t = tableNow.current
          if (tool === 'wall') stroke.current = [p]
          else if (tool === 'erase') changeTable(erase(t, p))
          else {
            const r = addPart(t, tool, p)
            setNote(r.why ?? null)
            if (r.table !== t) changeTable(r.table)
          }
        }}
        onPointerMove={(e) => {
          if (mode === 'build' && stroke.current) stroke.current.push(onTable(e))
        }}
        onPointerUp={(e) => {
          letGo(holds.releaseSource(`stage:${e.pointerId}`))
          const st = stroke.current
          stroke.current = null
          if (mode === 'build' && st) {
            const r = addPart(tableNow.current, 'wall', st)
            setNote(r.why ?? null)
            if (r.table !== tableNow.current) changeTable(r.table)
            else stale.current = true
          }
        }}
      />

      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Play or build">
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'play'}
              onClick={() => {
                setMode('play')
                newBall()
              }}
            >
              🎮 Play
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'build'}
              onClick={() => setMode('build')}
            >
              🛠 Build
            </button>
          </div>
          {mode === 'play' && (
            <span className="lab-score" aria-live="polite">
              {s.over
                ? `Game over: ${s.score.toLocaleString()}${s.score > 0 && s.score >= record ? ' — a best for this table!' : ''}`
                : `${s.score.toLocaleString()} · ball ${4 - s.balls} of 3`}
              {record > 0 && !s.over ? ` · best ${record.toLocaleString()}` : ''}
            </span>
          )}
          {mode === 'play' && (
            <button className="btn btn-ghost" onClick={() => newBall()}>
              ↻ New game
            </button>
          )}
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((v) => !v)}
          >
            {sound ? '🔔 Sound' : '🔕 Muted'}
          </button>
        </div>
      )}
      {live && mode === 'play' && (
        <div className="lab-controls pinball-pads">
          <button className="btn pinball-pad" {...pad('left')}>
            ◀ Flip
          </button>
          <button className="btn pinball-pad" {...pad('plunger')} disabled={!s.waiting || s.over}>
            🚀 Hold to pull
          </button>
          <button className="btn pinball-pad" {...pad('right')}>
            Flip ▶
          </button>
        </div>
      )}
      {live && mode === 'build' && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="What a finger does">
            {(Object.keys(TOOLS) as Tool[]).map((k) => (
              <button
                key={k}
                className="btn btn-ghost"
                aria-pressed={tool === k}
                onClick={() => setTool(k)}
              >
                {TOOLS[k]}
              </button>
            ))}
          </div>
          <label className="studio-pick">
            <span className="muted">Name</span>
            <input
              className="seedling-name"
              value={table.name}
              maxLength={40}
              onChange={(e) => changeTable({ ...table, name: e.target.value })}
            />
          </label>
          <button className="btn btn-ghost" onClick={() => changeTable(DEFAULT_TABLE)}>
            ↺ The workshop table
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => changeTable({ name: 'My table', walls: [], bumpers: [], targets: [] })}
          >
            🧹 Empty table
          </button>
          <button
            className="btn btn-ghost"
            onClick={() =>
              download(
                new Blob([JSON.stringify(table, null, 1)], { type: 'application/json' }),
                'pinball-table.json',
              )
            }
          >
            ⬇ Save table
          </button>
          <PinballOpen
            onOpen={(t, name) => {
              changeTable(t)
              setNote(`Opened ${name}.`)
            }}
            onRefuse={setNote}
          />
        </div>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <strong>{note} </strong>}
          {mode === 'play' ? (
            <>
              Hold 🚀 (or Space) to pull the plunger and let go to launch; then the left and right
              of the table — or Z and M, or ← and → — work the flippers. Bumpers kick, targets
              light, and lighting them all pays a bonus. Three balls; N starts again.
            </>
          ) : (
            <>
              Draw walls with a finger, tap to place bumpers and targets, erase by tapping a part.
              The frame, the lane, the flippers and the drain stay put. Then 🎮 Play your table — it
              is kept here, and as a file with ⬇ Save table.
            </>
          )}
        </p>
      )}
    </div>
  )
}

/** ⬆ Open table…: a file input behind a button, read as data and checked before anything is used */
function PinballOpen({
  onOpen,
  onRefuse,
}: {
  onOpen: (t: Table, name: string) => void
  onRefuse: (why: string) => void
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  return (
    <>
      <button className="btn btn-ghost" onClick={() => ref.current?.click()}>
        ⬆ Open table…
      </button>
      <input
        ref={ref}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          const t =
            f.size <= FILE_LIMIT ? readTable(await f.text()) : 'That file is too big to be a table.'
          if (typeof t === 'string') onRefuse(t)
          else onOpen(t, f.name)
        }}
      />
    </>
  )
}
