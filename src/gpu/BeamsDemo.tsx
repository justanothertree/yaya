import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  BEAMS_KEY,
  COLOUR_NAMES,
  LEVELS,
  MAX_SEGMENTS,
  PARS,
  cellAt,
  fitBoard,
  free,
  key,
  packCells,
  packSegments,
  readSaved,
  solve,
  solved,
  trace,
  used,
  type Piece,
  type Saved,
  type Stock,
} from './beams'
import { createBeams, type BeamsView } from './beamsEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const stockName = (s: Stock) =>
  s.kind === 'filter'
    ? `${COLOUR_NAMES[s.colour ?? 7]} filter`
    : s.kind === 'mirror'
      ? 'Mirror'
      : 'Splitter'
const stockIcon = (s: Stock) => (s.kind === 'mirror' ? '╱' : s.kind === 'splitter' ? '⧄' : '▣')

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(BEAMS_KEY))
  } catch {
    return readSaved(null)
  }
}

export function BeamsDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(load()).current
  const [live, setLive] = useState(false)
  const [level, setLevel] = useState(saved.level)
  const [placed, setPlaced] = useState<Record<string, Piece>>(saved.placed)
  const [best, setBest] = useState(saved.best)
  const [tool, setTool] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [shown, setShown] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [sound, setSound] = useState(true)
  const l = LEVELS[level]
  // memoised: an effect sends this to the GPU, and a new object every render would resend it each time
  const t = useMemo(() => trace(l, placed), [l, placed])
  const done = solved(l, t)
  const count = Object.keys(placed).length
  const lit = l.targets.filter((g, i) => t.received[i] === g.colour).length

  const engine = useRef<BeamsView | null>(null)
  const solvedAt = useRef<number | null>(null)
  const clock = useRef(0)
  const voices = useRef(new Map<string, number>())
  const now = useRef({ l, placed, t, selected, cursor })
  now.current = { l, placed, t, selected, cursor }

  // what is on the board goes to the GPU when it changes, not every frame
  useEffect(() => {
    engine.current?.board(packCells(l, placed, t, selected), l.w, l.h)
    engine.current?.beams(packSegments(t.segments, MAX_SEGMENTS))
  }, [l, placed, t, selected])

  useEffect(() => {
    try {
      localStorage.setItem(BEAMS_KEY, JSON.stringify({ best, level, placed }))
    } catch {
      /* private mode: it stays for this visit */
    }
  }, [best, level, placed])

  /* sound stops when the toy goes: every note still ringing is let go and no timer outlives it */
  useEffect(
    () => () => {
      for (const [id, tm] of voices.current) {
        window.clearTimeout(tm)
        noteOff(id)
      }
      voices.current.clear()
    },
    [],
  )
  const play = (midi: number, wait = 0) => {
    if (!sound || voices.current.size > 8) return
    const id = `beams-${midi}-${performance.now()}`
    voices.current.set(
      id,
      window.setTimeout(() => {
        noteOn(id, 'bell', midi)
        voices.current.set(
          id,
          window.setTimeout(() => {
            noteOff(id)
            voices.current.delete(id)
          }, 900),
        )
      }, wait),
    )
  }

  // a level solved: once, when it becomes so
  const was = useRef(done)
  useEffect(() => {
    if (done && !was.current) {
      solvedAt.current = clock.current
      ;[76, 79, 84].forEach((m, i) => play(m, i * 120))
      if (!shown)
        setBest((b) =>
          b[l.name] !== undefined && b[l.name] <= count ? b : { ...b, [l.name]: count },
        )
      if (!running) setRunning(true)
    }
    if (!done) solvedAt.current = null
    was.current = done
    // play and the setters are stable enough here: this is about the moment `done` turns true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  const go = (k: number) => {
    const n = Math.max(0, Math.min(LEVELS.length - 1, k))
    setLevel(n)
    setPlaced({})
    setSelected(null)
    // the cursor belongs to a board: a level of another size must not inherit it
    setCursor(null)
    setShown(false)
    setTool(0)
    setNote(null)
    was.current = false
  }

  /** a cell pressed: place the chosen piece, select a piece, or turn the one already selected */
  const press = (x: number, y: number) => {
    const k = key(x, y)
    const p = placed[k]
    if (p) {
      if (selected === k) return turnIt(k)
      setSelected(k)
      return
    }
    setSelected(null)
    if (!free(l, placed, x, y))
      return setNote(
        l.fixed[k]
          ? 'That piece is part of the puzzle and stays where it is.'
          : 'Nothing can go there.',
      )
    const s = l.stock[tool]
    if (!s) return
    if (used(placed, s) >= s.count)
      return setNote(`No ${stockName(s).toLowerCase()}s left — take one back to move it.`)
    setPlaced({
      ...placed,
      [k]: { kind: s.kind, turn: 0, ...(s.colour ? { colour: s.colour } : {}) },
    })
    setSelected(k)
    setNote(null)
    play(67)
  }
  const turnIt = (k: string) => {
    const p = placed[k]
    if (!p || p.kind === 'filter') return
    setPlaced({ ...placed, [k]: { ...p, turn: p.turn ? 0 : 1 } })
    play(72)
  }
  const takeBack = (k: string) => {
    const rest = { ...placed }
    delete rest[k]
    setPlaced(rest)
    setSelected(null)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key
    const c = cursor ?? [0, 0]
    const move = (dx: number, dy: number) =>
      setCursor([
        Math.max(0, Math.min(l.w - 1, c[0] + dx)),
        Math.max(0, Math.min(l.h - 1, c[1] + dy)),
      ])
    if (k === 'ArrowRight') move(1, 0)
    else if (k === 'ArrowLeft') move(-1, 0)
    else if (k === 'ArrowDown') move(0, 1)
    else if (k === 'ArrowUp') move(0, -1)
    else if (k === 'Enter' || k === ' ') press(c[0], c[1])
    else if (k.toLowerCase() === 't' && selected) turnIt(selected)
    else if ((k === 'Delete' || k === 'Backspace') && selected) takeBack(selected)
    else if (/^[1-9]$/.test(k) && Number(k) <= l.stock.length) setTool(Number(k) - 1)
    else return
    e.preventDefault()
  }

  const describe = (x: number, y: number) => {
    const k = key(x, y)
    const p = placed[k] ?? l.fixed[k]
    if (l.walls.includes(k)) return 'a wall'
    const em = l.emitters.find((m) => m.x === x && m.y === y)
    if (em) return `a ${COLOUR_NAMES[em.colour]} light`
    const ti = l.targets.findIndex((g) => g.x === x && g.y === y)
    if (ti >= 0)
      return `a target wanting ${COLOUR_NAMES[l.targets[ti].colour]}, getting ${
        t.received[ti] ? COLOUR_NAMES[t.received[ti]] : 'nothing'
      }`
    if (p)
      return `${p.kind === 'filter' ? `a ${COLOUR_NAMES[p.colour ?? 7]} filter` : `a ${p.kind} ${p.turn ? '\\' : '/'}`}${
        l.fixed[k] ? ', fixed' : ''
      }`
    return t.lit.has(k) ? 'empty, lit' : 'empty'
  }

  const bestHere = best[l.name]
  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Beams">
      <LabStage
        label={`Beams, level ${level + 1}: ${l.name}. ${lit} of ${l.targets.length} targets lit.${
          cursor
            ? ` Cursor on column ${cursor[0] + 1}, row ${cursor[1] + 1}: ${describe(cursor[0], cursor[1])}.`
            : ''
        }`}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createBeams(device, context, format, canvas)
          engine.current = v
          const n = now.current
          v.board(packCells(n.l, n.placed, n.t, n.selected), n.l.w, n.l.h)
          v.beams(packSegments(n.t.segments, MAX_SEGMENTS))
          return {
            frame: (dt: number) => {
              clock.current += dt
              const since = solvedAt.current === null ? -1 : clock.current - solvedAt.current
              v.frame({
                time: clock.current,
                flash: since >= 0 && since < 1.2 ? 1 - since / 1.2 : 0,
                hover: now.current.cursor,
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const c = e.currentTarget
          const r = c.getBoundingClientRect()
          const k = c.width / r.width
          const f = fitBoard([c.width, c.height], l.w, l.h)
          const at = cellAt(f, l.w, l.h, [(e.clientX - r.left) * k, (e.clientY - r.top) * k])
          if (!at) return setSelected(null)
          setCursor(at)
          press(at[0], at[1])
          if (!running) setRunning(true)
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
                  {best[q.name] !== undefined ? ` ✓ ${best[q.name]}` : ''}
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
          <span className="lab-score" aria-live="polite">
            {lit}/{l.targets.length} lit · {count} {count === 1 ? 'piece' : 'pieces'} · par{' '}
            {PARS[level]}
          </span>
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="The piece a tap places">
            {l.stock.map((s, i) => {
              const left = s.count - used(placed, s)
              return (
                <button
                  key={i}
                  className="btn btn-ghost beams-tool"
                  aria-pressed={tool === i}
                  aria-label={`${stockName(s)}: ${left} of ${s.count} left`}
                  onClick={() => setTool(i)}
                >
                  <span
                    aria-hidden
                    style={
                      s.kind === 'filter'
                        ? {
                            color: ['', '#f55', '#4d4', '#ee4', '#58f', '#e5e', '#4ee', '#fff'][
                              s.colour ?? 7
                            ],
                          }
                        : undefined
                    }
                  >
                    {stockIcon(s)}
                  </span>{' '}
                  {stockName(s)} ×{left}
                </button>
              )
            })}
          </div>
          <button
            className="btn btn-ghost"
            disabled={!selected || placed[selected]?.kind === 'filter'}
            onClick={() => selected && turnIt(selected)}
          >
            ↻ Turn
          </button>
          <button
            className="btn btn-ghost"
            disabled={!selected}
            onClick={() => selected && takeBack(selected)}
          >
            ✕ Take back
          </button>
          <button
            className="btn btn-ghost"
            disabled={!count}
            onClick={() => {
              setPlaced({})
              setSelected(null)
              setShown(false)
            }}
          >
            🧹 Clear
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              const s = solve(l)
              if (!s) return
              setPlaced(s)
              setShown(true)
              setSelected(null)
              setNote('One way to do it, in as few pieces as it takes. (Not kept as a best.)')
            }}
          >
            💡 Show a way
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
          {done && (
            <strong>
              ✨ All lit with {count} {count === 1 ? 'piece' : 'pieces'}
              {count <= PARS[level] ? ' — par!' : ` — par is ${PARS[level]}.`}{' '}
              {level < LEVELS.length - 1 && (
                <button className="btn" onClick={() => go(level + 1)}>
                  Next level ›
                </button>
              )}{' '}
            </strong>
          )}
          {note && <strong>{note} </strong>}
          <em>{l.hint}</em> Tap a square to place the chosen piece; tap a piece to select it, and
          again to turn it. A target lights when exactly its colour arrives — colours add, so red
          and green make yellow.
          {bestHere !== undefined && ` Your best here: ${bestHere}.`} Keys: arrows move, Enter
          places or turns, T turns, Delete takes back, 1–{l.stock.length} choose a piece.
        </p>
      )}
    </div>
  )
}
