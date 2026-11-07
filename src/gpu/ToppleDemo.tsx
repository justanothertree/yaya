import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  COLOURS,
  FILE_LIMIT,
  MAX_DOMINOES,
  PUZZLES,
  TOPPLE_KEY,
  cascade,
  dominoAt,
  floorAt,
  pushOf,
  readLayout,
  solve,
  solved,
  spiral,
  standAlong,
  type Cascade,
  type Layout,
  type V2,
} from './topple'
import { createTopple, type ToppleView } from './toppleEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Mode = 'puzzle' | 'free'
type Tool = 'line' | 'paint' | 'erase' | 'push'
const TOOLS: Record<Tool, string> = {
  line: '✏️ Line',
  paint: '🎨 Paint',
  erase: '🧽 Erase',
  push: '👉 Push',
}
const SWATCHES = [
  '#d93333',
  '#f29926',
  '#f2d940',
  '#4db359',
  '#338cd9',
  '#734cbf',
  '#1f1f24',
  '#f5f5f0',
]
const SWATCH_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'violet', 'black', 'white']
type Best = Record<string, number>

const load = (): { puzzle: number; best: Best; free: Layout } => {
  const empty: Layout = { dominoes: [], bells: [], walls: [] }
  try {
    const v = JSON.parse(localStorage.getItem(TOPPLE_KEY) ?? 'null') as {
      puzzle?: unknown
      best?: Record<string, unknown>
      free?: unknown
    } | null
    const puzzle =
      typeof v?.puzzle === 'number' &&
      Number.isInteger(v.puzzle) &&
      v.puzzle >= 0 &&
      v.puzzle < PUZZLES.length
        ? v.puzzle
        : 0
    const best: Best = {}
    for (const p of PUZZLES) {
      const n = v?.best?.[p.name]
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) best[p.name] = n
    }
    const free = readLayout(JSON.stringify(v?.free ?? empty))
    return { puzzle, best, free: typeof free === 'string' ? empty : free }
  } catch {
    return { puzzle: 0, best: {}, free: empty }
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
const atFloor = (e: PointerEvent<HTMLCanvasElement>): V2 => {
  const r = e.currentTarget.getBoundingClientRect()
  return floorAt([r.width, r.height], [e.clientX - r.left, e.clientY - r.top])
}

export function ToppleDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(load()).current
  const [live, setLive] = useState(false)
  const [mode, setMode] = useState<Mode>('puzzle')
  const [puzzle, setPuzzle] = useState(saved.puzzle)
  const [best, setBest] = useState<Best>(saved.best)
  const [tool, setTool] = useState<Tool>('line')
  const [colour, setColour] = useState(4)
  const [note, setNote] = useState<string | null>(null)
  const p = PUZZLES[puzzle]
  const blank = (k = puzzle): Layout => ({
    dominoes: [],
    bells: PUZZLES[k].bells,
    walls: PUZZLES[k].walls,
  })
  const [layout, setLayout] = useState<Layout>(blank())
  const [free, setFree] = useState<Layout>(saved.free)
  const [history, setHistory] = useState<Layout[]>([])
  const [shown, setShown] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  /** how fast a run plays: a long spiral takes most of a minute at its own pace */
  const [speed, setSpeed] = useState(1)
  const speedNow = useRef(speed)
  const [sound, setSound] = useState(true)
  const soundNow = useRef(sound)
  soundNow.current = sound
  speedNow.current = speed
  const table = mode === 'puzzle' ? layout : free
  /** the run in progress: its cascade and when it was pushed (in the stage's own clock) */
  const run = useRef<{ c: Cascade; at: number; done: boolean } | null>(null)
  const clock = useRef(0)
  const stroke = useRef<V2[] | null>(null)
  const engine = useRef<ToppleView | null>(null)
  const dirty = useRef(true)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const voices = useRef(new Map<string, number>())
  const now = useRef({ table, mode, p })
  now.current = { table, mode, p }
  const tableNow = useRef(table)
  tableNow.current = table

  useEffect(() => {
    try {
      localStorage.setItem(
        TOPPLE_KEY,
        JSON.stringify({ puzzle, best, free: { dominoes: free.dominoes, bells: free.bells } }),
      )
    } catch {
      /* private mode, or a table too big for the browser's store: it stays for this visit */
    }
  }, [puzzle, best, free])

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
  const play = (instrument: 'pluck' | 'bell', midi: number, ms: number) => {
    if (!soundNow.current || voices.current.size > 12) return
    const id = `topple-${midi}-${performance.now()}`
    noteOn(id, instrument, midi)
    voices.current.set(
      id,
      window.setTimeout(() => {
        noteOff(id)
        voices.current.delete(id)
      }, ms),
    )
  }

  /** the table changed: every domino stands again */
  const change = (l: Layout) => {
    /* ⚠️ taken now, not inside the updater: React runs an updater later, by when tableNow.current is
       already the NEW table — and Undo then "restored" the change it was meant to undo */
    const before = tableNow.current
    setHistory((h) => [...h.slice(-29), before])
    tableNow.current = l
    if (mode === 'puzzle') setLayout(l)
    else setFree(l)
    standUp()
  }
  const standUp = () => {
    run.current = null
    dirty.current = true
    setOutcome(null)
  }
  const undo = () => {
    const prev = history[history.length - 1]
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    tableNow.current = prev
    if (mode === 'puzzle') setLayout(prev)
    else setFree(prev)
    standUp()
  }
  const pick = (k: number) => {
    setPuzzle(k)
    setLayout(blank(k))
    setHistory([])
    setShown(false)
    setNote(null)
    standUp()
  }

  /** push: the puzzle's arrow, or in free play the domino tapped (away from the tap) or the first */
  const push = (first?: number, dir = 1) => {
    const l = tableNow.current
    let from = first
    let d = dir
    if (from === undefined) {
      if (mode === 'puzzle') {
        const s = pushOf(p, l)
        if (!s) return setNote('Stand a domino on the arrow first — the push is there.')
        from = s.first
        d = s.dir
      } else from = 0
    }
    if (!l.dominoes.length) return setNote('Draw a line of dominoes first.')
    const c = cascade(l, from, d)
    run.current = { c, at: clock.current, done: false }
    dirty.current = true
    setNote(null)
    setOutcome(null)
    if (!running) setRunning(true)
  }

  /** when a run has finished: did it do what the puzzle asked? */
  const judge = (c: Cascade) => {
    const fell = c.falls.filter((f) => f.t >= 0).length
    const total = tableNow.current.dominoes.length
    if (mode === 'free') return setOutcome(`${fell} of ${total} down.`)
    const ok = solved(p, c)
    if (ok) {
      setOutcome(`✨ Solved with ${total} dominoes (allowed ${p.budget}).`)
      if (!shown) setBest((b) => (b[p.name] && b[p.name] <= total ? b : { ...b, [p.name]: total }))
      return
    }
    const rang = c.bells.filter((t) => t >= 0)
    if (p.goal === 'together' && rang.length === c.bells.length)
      return setOutcome(
        `The bells rang ${(Math.max(...rang) - Math.min(...rang)).toFixed(2)} s apart — they need to be within 0.125 s.`,
      )
    if (p.goal === 'order' && rang.length === c.bells.length)
      return setOutcome('All rang, but not left to right.')
    setOutcome(
      `${rang.length} of ${c.bells.length} bells rang; ${fell} of ${total} dominoes fell. ⏮ stands them up again.`,
    )
  }

  /* the frame loop was made with the first render's functions: it reaches the judge through a ref,
     or it would judge a Duet by First run's rules (it said "allowed 30" of a 70-domino puzzle) */
  const judgeNow = useRef(judge)
  judgeNow.current = judge

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') push()
    else if (k === 'r') standUp()
    else if (k === 'u') undo()
    else if (/^[1-4]$/.test(k)) setTool((Object.keys(TOOLS) as Tool[])[+k - 1])
    else return
    e.preventDefault()
  }

  const count = table.dominoes.length
  const cap = mode === 'puzzle' ? p.budget : MAX_DOMINOES
  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Topple">
      <LabStage
        label="A wooden table of dominoes standing in lines; push one and the run falls, showing the colours of their faces"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createTopple(device, context, format, canvas)
          engine.current = v
          dirty.current = true
          let lastStroke = 0
          let ticks = 0
          let rangSeen = 0
          return {
            frame: (dt: number) => {
              // the run's clock goes at the chosen speed; drawing and the push are on the same clock
              const step = dt * speedNow.current
              clock.current += step
              const n = now.current
              const r = run.current
              if (dirty.current) {
                dirty.current = false
                v.dominoes(n.table, r?.c ?? null)
                v.marks(n.mode === 'puzzle' ? n.p.start : null, n.table.bells, n.table.walls)
                rangSeen = 0
              }
              const st = stroke.current
              if ((st?.length ?? 0) !== lastStroke) {
                lastStroke = st?.length ?? 0
                v.preview(st ?? [])
              }
              let rung = 0
              if (r) {
                const t = clock.current - r.at
                r.c.bells.forEach((b, k) => {
                  if (b >= 0 && t >= b) rung |= 1 << k
                })
                // a tick for the dominoes that started falling this frame (a few at most), a bell for each new ring
                const started = r.c.falls.filter(
                  (f) => f.t >= 0 && f.t <= t && f.t > t - step,
                ).length
                if (started && step > 0 && ticks++ % 2 === 0) play('pluck', 84 + (started % 5), 60)
                const fresh = rung & ~rangSeen
                if (fresh) {
                  rangSeen |= fresh
                  play('bell', 79, 800)
                }
                if (!r.done && t >= r.c.end + 0.2) {
                  r.done = true
                  judgeNow.current(r.c)
                }
                v.frame({ time: t, rung })
              } else v.frame({ time: 0, rung: 0 })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const at = atFloor(e)
          const l = tableNow.current
          if (tool === 'push') {
            const k = dominoAt(l, at, 0.6)
            if (k < 0) return
            const d = l.dominoes[k]
            // pushed away from where the finger came from
            const side = (d.x - at[0]) * Math.cos(d.a) + (d.z - at[1]) * Math.sin(d.a)
            return push(k, side >= 0 ? 1 : -1)
          }
          if (run.current) standUp()
          if (tool === 'line') stroke.current = [at]
          else if (tool === 'paint' || tool === 'erase') stroke.current = [at]
          if (tool === 'erase') {
            const k = dominoAt(l, at)
            if (k >= 0) change({ ...l, dominoes: l.dominoes.filter((_, i) => i !== k) })
          } else if (tool === 'paint') {
            const k = dominoAt(l, at)
            if (k >= 0)
              change({
                ...l,
                dominoes: l.dominoes.map((d, i) => (i === k ? { ...d, c: colour } : d)),
              })
          }
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const st = stroke.current
          if (!st) return
          const at = atFloor(e)
          const last = st[st.length - 1]
          if (Math.hypot(at[0] - last[0], at[1] - last[1]) < 0.15) return
          st.push(at)
          const l = tableNow.current
          if (tool === 'paint') {
            const hit = l.dominoes.some(
              (d) => Math.hypot(d.x - at[0], d.z - at[1]) < 0.4 && d.c !== colour,
            )
            if (hit) {
              tableNow.current = {
                ...l,
                dominoes: l.dominoes.map((d) =>
                  Math.hypot(d.x - at[0], d.z - at[1]) < 0.4 ? { ...d, c: colour } : d,
                ),
              }
              if (mode === 'puzzle') setLayout(tableNow.current)
              else setFree(tableNow.current)
              dirty.current = true
            }
          } else if (tool === 'erase') {
            const k = dominoAt(l, at)
            if (k >= 0) {
              tableNow.current = { ...l, dominoes: l.dominoes.filter((_, i) => i !== k) }
              if (mode === 'puzzle') setLayout(tableNow.current)
              else setFree(tableNow.current)
              dirty.current = true
            }
          }
        }}
        onPointerUp={() => {
          const st = stroke.current
          stroke.current = null
          if (!st || tool !== 'line') return
          const l = tableNow.current
          const fresh = standAlong(l, st, colour).slice(0, Math.max(0, cap - l.dominoes.length))
          if (!fresh.length)
            return setNote(
              l.dominoes.length >= cap
                ? `That is all ${cap} dominoes${mode === 'puzzle' ? ' this puzzle allows' : ''}.`
                : 'Draw a longer line, on the table and clear of the walls.',
            )
          setNote(null)
          change({ ...l, dominoes: [...l.dominoes, ...fresh] })
        }}
      />

      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Puzzles or free play">
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'puzzle'}
              onClick={() => {
                setMode('puzzle')
                setHistory([])
                standUp()
              }}
            >
              🧩 Puzzles
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'free'}
              onClick={() => {
                setMode('free')
                setHistory([])
                standUp()
              }}
            >
              🎨 Free table
            </button>
          </div>
          <span className="lab-score" aria-live="polite">
            {count}/{cap} dominoes
          </span>
          {mode === 'puzzle' && (
            <label className="studio-pick">
              <span className="muted">Puzzle</span>
              <select value={puzzle} onChange={(e) => pick(Number(e.target.value))}>
                {PUZZLES.map((q, k) => (
                  <option key={q.name} value={k}>
                    {k + 1}. {q.name}
                    {best[q.name] ? ` ✓ ${best[q.name]}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => push()}>
            ▶ Push
          </button>
          <button className="btn btn-ghost" onClick={standUp}>
            ⏮ Stand them up
          </button>
          <button
            className="btn btn-ghost"
            aria-label={`Speed: ${speed} times`}
            onClick={() => setSpeed((v) => (v === 1 ? 3 : v === 3 ? 6 : 1))}
          >
            ⏩ {speed}×
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((v) => !v)}
          >
            {sound ? '🔔 Sound' : '🔕 Muted'}
          </button>
          <button className="btn btn-ghost" onClick={undo} disabled={!history.length}>
            ↶ Undo
          </button>
          <button
            className="btn btn-ghost"
            onClick={() =>
              change(mode === 'puzzle' ? blank() : { dominoes: [], bells: [], walls: [] })
            }
            disabled={!count}
          >
            🧹 Clear
          </button>
          {mode === 'puzzle' && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                change(solve(p))
                setShown(true)
                setNote('One way to do it — push to see. (Not kept as a best.)')
              }}
            >
              💡 Show a way
            </button>
          )}
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="What a finger does">
            {(Object.keys(TOOLS) as Tool[]).map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={tool === t}
                onClick={() => setTool(t)}
              >
                {TOOLS[t]}
              </button>
            ))}
          </div>
          <div
            className="lab-group"
            role="group"
            aria-label="The colour new and painted dominoes have on their faces"
          >
            {SWATCHES.slice(0, COLOURS).map((c, k) => (
              <button
                key={c}
                className="btn btn-ghost studio-swatch"
                style={{ background: c }}
                aria-pressed={colour === k}
                aria-label={SWATCH_NAMES[k]}
                onClick={() => setColour(k)}
              />
            ))}
          </div>
          {mode === 'free' && (
            <>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  change({ dominoes: spiral(), bells: [], walls: [] })
                  setNote(
                    'A spiral of 300-odd dominoes with a picture on their faces: push the middle one.',
                  )
                }}
              >
                🌀 A picture to knock down
              </button>
              <button
                className="btn btn-ghost"
                disabled={!count}
                onClick={() =>
                  download(
                    new Blob([JSON.stringify({ dominoes: free.dominoes, bells: free.bells })], {
                      type: 'application/json',
                    }),
                    'dominoes.json',
                  )
                }
              >
                ⬇ Save table
              </button>
              <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
                ⬆ Open table…
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
                      ? readLayout(await f.text())
                      : 'That file is too big to be a table of dominoes.'
                  if (typeof r === 'string') return setNote(r)
                  change(r)
                  setNote(`Opened ${f.name}.`)
                }}
              />
            </>
          )}
        </div>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {outcome && <strong>{outcome} </strong>}
          {note && <strong>{note} </strong>}
          {mode === 'puzzle' ? (
            <>{p.hint} </>
          ) : (
            <>
              Draw lines of dominoes, paint their faces, and push one: the colours show as they
              fall.{' '}
            </>
          )}
          ✏️ draws a line of dominoes (they face along it; a sharp corner stops a run), 🎨 paints
          faces, 🧽 removes, 👉 pushes the one you tap, away from your finger. Space pushes, R
          stands them up, U undoes.
        </p>
      )}
    </div>
  )
}
