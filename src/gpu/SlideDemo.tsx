import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  DIFFICULTY,
  LEVELS,
  SLIDE_KEY,
  generate,
  packTiles,
  readSaved,
  slide,
  solve,
  stars,
  swipe,
  won,
  type Board,
  type Difficulty,
  type Dir,
  type State,
} from './slide'
import { createSlide, type SlideView } from './slideEngine'
import { loadKept, useKept } from './kept'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** cells a second while sliding: quick enough to feel like ice, slow enough to follow */
const SPEED = 16
const ARROWS: Record<Dir, string> = { up: '▲', down: '▼', left: '◀', right: '▶' }
const NAMES: Record<Dir, string> = { up: 'Push up', down: 'Push down', left: 'Push left', right: 'Push right' } // prettier-ignore
const KEYS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
}

const newSeed = () => 1 + Math.floor(Math.random() * 99999)

export function SlideDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [saved, setSaved] = useKept(SLIDE_KEY, readSaved)
  const [mode, setMode] = useState<'levels' | 'endless'>('levels')
  const [level, setLevel] = useState(() => {
    const s = loadKept(SLIDE_KEY, readSaved)
    return Math.max(
      0,
      LEVELS.findIndex((l) => s.best[l.name] === undefined),
    )
  })
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const [seed, setSeed] = useState(newSeed)
  const board: Board = useMemo(
    () => (mode === 'levels' ? LEVELS[level] : (generate(seed, difficulty) ?? LEVELS[0])),
    [mode, level, seed, difficulty],
  )
  const par = useMemo(() => solve(board)?.length ?? 0, [board])
  const [history, setHistory] = useState<State[]>(() => [{ at: board.start, got: 0 }])
  const [note, setNote] = useState<string | null>(null)
  const [hintDir, setHintDir] = useState<Dir | null>(null)
  const [sound, setSound] = useState(true)
  const state = history[history.length - 1]
  const moves = history.length - 1
  const done = won(board, state)

  const engine = useRef<SlideView | null>(null)
  const clock = useRef(0)
  /** the push being animated: the cells it crosses and when it began */
  const anim = useRef<{ from: [number, number]; path: [number, number][]; t0: number } | null>(null)
  const flashAt = useRef(-9)
  const press = useRef<[number, number] | null>(null)
  const timers = useRef<number[]>([])

  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t)
      for (const m of [64, 67, 71, 76]) noteOff(`slide-${m}`)
    },
    [],
  )

  /** a fresh start on the board shown */
  const reset = (b: Board = board) => {
    setHistory([{ at: b.start, got: 0 }])
    anim.current = null
    setHintDir(null)
    setNote(null)
  }
  // a new board — another level, another seed — starts at its start
  useEffect(() => {
    reset(board)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board])

  const blip = (m: number, len: number, voice: 'pluck' | 'bell' = 'pluck') => {
    if (!sound) return
    const id = `slide-${m}`
    noteOn(id, voice, m)
    timers.current.push(window.setTimeout(() => noteOff(id), len))
  }

  const push = (d: Dir) => {
    if (done) return
    const { to, path } = slide(board, state, d)
    if (!path.length) {
      setNote(`No room to push ${d} — a wall is right there.`)
      return
    }
    anim.current = { from: state.at, path, t0: clock.current }
    const next = [...history, to]
    setHistory(next)
    setHintDir(null)
    setNote(null)
    if (to.got !== state.got) blip(76, 160, 'bell')
    if (won(board, to)) {
      const n = next.length - 1
      flashAt.current = clock.current + path.length / SPEED
      if (mode === 'levels') {
        const k = stars(par, n)
        setSaved((s) =>
          s.best[board.name] !== undefined && s.best[board.name] <= n
            ? s
            : { ...s, best: { ...s.best, [board.name]: n } },
        )
        setNote(`✨ Done in ${n} push${n === 1 ? '' : 'es'} — the fewest possible is ${par}. ${'★'.repeat(k)}${'☆'.repeat(3 - k)}`) // prettier-ignore
      } else {
        setSaved((s) => ({
          ...s,
          endless: { ...s.endless, [difficulty]: s.endless[difficulty] + 1 },
        }))
        setNote(`✨ Done in ${n} — the fewest possible is ${par}.`)
      }
      if (sound)
        [64, 67, 71, 76].forEach((m, i) => {
          const id = `slide-${m}`
          timers.current.push(
            window.setTimeout(() => noteOn(id, 'bell', m), 200 + i * 110),
            window.setTimeout(() => noteOff(id), 200 + i * 110 + 700),
          )
        })
    } else blip(52 + Math.min(path.length, 12), 90)
    if (!running) setRunning(true)
  }
  const undo = () => {
    if (history.length < 2) return
    setHistory(history.slice(0, -1))
    anim.current = null
    setNote(null)
  }
  const hint = () => {
    const p = solve(board, state)
    if (!p || !p.length) return
    setHintDir(p[0])
    setNote(
      `Try ${ARROWS[p[0]]} ${p[0]} — ${p.length} push${p.length === 1 ? '' : 'es'} from here at best.`,
    )
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.target !== e.currentTarget) return
    const d = KEYS[e.key] ?? KEYS[e.key.toLowerCase()]
    if (d) push(d)
    else if (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'u') undo()
    else if (e.key.toLowerCase() === 'r') reset()
    else if (e.key.toLowerCase() === 'h') hint()
    else return
    e.preventDefault()
  }

  const latest = useRef({ board, state })
  latest.current = { board, state }
  useEffect(() => {
    engine.current?.board(packTiles(board, state.got), board.w, board.h)
  }, [board, state])

  const coinsLeft = board.coins.length - board.coins.filter((_, c) => state.got & (1 << c)).length
  const best = mode === 'levels' ? saved.best[board.name] : undefined
  const label = `Slide: ${mode === 'levels' ? `level ${level + 1}, ${board.name}` : `${difficulty} board, seed ${seed}`}. The puck is at column ${state.at[0] + 1}, row ${state.at[1] + 1}. ${coinsLeft ? `${coinsLeft} coin${coinsLeft === 1 ? '' : 's'} left. ` : board.coins.length ? 'Every coin taken. ' : ''}${moves} push${moves === 1 ? '' : 'es'}; the fewest possible is ${par}.${done ? ' Done.' : ''}`

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Slide">
      <LabStage
        label={label}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createSlide(device, context, format, canvas)
          engine.current = v
          const n = latest.current
          v.board(packTiles(n.board, n.state.got), n.board.w, n.board.h)
          return {
            frame: (dt: number) => {
              clock.current += dt
              const t = clock.current
              const { board: b, state: s } = latest.current
              let puck: [number, number] = s.at
              let from: [number, number] = s.at
              let trail = 0
              const a = anim.current
              if (a) {
                // along the path at SPEED, easing into the stop over the last cell
                const total = a.path.length
                const k = Math.min(1, ((t - a.t0) * SPEED) / total)
                const eased = 1 - (1 - k) * (1 - k)
                const along = eased * total
                const i = Math.min(total - 1, Math.floor(along))
                const prev = i === 0 ? a.from : a.path[i - 1]
                const frac = along - i
                const cur = a.path[i]
                puck = [prev[0] + (cur[0] - prev[0]) * frac, prev[1] + (cur[1] - prev[1]) * frac]
                if (k >= 1) puck = a.path[total - 1]
                from = a.from
                trail = Math.max(0, 1 - (t - a.t0 - total / SPEED) * 2)
              }
              const coinsDone = s.got === (1 << b.coins.length) - 1
              v.frame({
                time: t,
                puck,
                from,
                trail,
                flash: Math.max(0, 1 - Math.abs(t - flashAt.current) * 2.5),
                allCoins: coinsDone,
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          press.current = [e.clientX, e.clientY]
          if (!running) setRunning(true)
        }}
        onPointerUp={(e) => {
          const p = press.current
          press.current = null
          if (!p) return
          const d = swipe(e.clientX - p[0], e.clientY - p[1], 24)
          if (d) push(d)
        }}
      />

      {live && (
        <>
          <div className="lab-controls">
            <div className="lab-group" role="group" aria-label="Which boards">
              <button
                className="btn btn-ghost"
                aria-pressed={mode === 'levels'}
                onClick={() => setMode('levels')}
              >
                Levels
              </button>
              <button
                className="btn btn-ghost"
                aria-pressed={mode === 'endless'}
                onClick={() => setMode('endless')}
              >
                ♾ Endless
              </button>
            </div>
            {mode === 'levels' ? (
              <label className="studio-pick">
                <span className="sr-only">Level</span>
                <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
                  {LEVELS.map((l, i) => (
                    <option key={l.name} value={i}>
                      {i + 1}. {l.name}
                      {saved.best[l.name] !== undefined
                        ? ` ${'★'.repeat(stars(solve(l)!.length, saved.best[l.name]))}`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="studio-pick">
                  <span className="sr-only">Difficulty</span>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                  >
                    {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
                      <option key={d} value={d}>
                        {d[0].toUpperCase() + d.slice(1)} ({DIFFICULTY[d].min}–{DIFFICULTY[d].max}{' '}
                        pushes)
                        {saved.endless[d] ? ` · ${saved.endless[d]} done` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn btn-ghost" onClick={() => setSeed(newSeed())}>
                  🎲 New board
                </button>
              </>
            )}
            <button
              className="btn btn-ghost"
              onClick={undo}
              disabled={moves === 0}
              aria-keyshortcuts="Z"
            >
              ↶ Undo
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => reset()}
              disabled={moves === 0}
              aria-keyshortcuts="R"
            >
              ↺ Restart
            </button>
            <button className="btn btn-ghost" onClick={hint} disabled={done} aria-keyshortcuts="H">
              💡 Hint
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={sound}
              onClick={() => setSound((s) => !s)}
            >
              {sound ? '🔔 Sound' : '🔕 Muted'}
            </button>
          </div>
          <div className="slide-pad" role="group" aria-label="Push the puck">
            {(['up', 'left', 'right', 'down'] as Dir[]).map((d) => (
              <button
                key={d}
                className={`btn slide-${d}`}
                aria-label={NAMES[d]}
                aria-keyshortcuts={
                  d === 'up'
                    ? 'ArrowUp'
                    : d === 'down'
                      ? 'ArrowDown'
                      : d === 'left'
                        ? 'ArrowLeft'
                        : 'ArrowRight'
                }
                data-hint={hintDir === d || undefined}
                disabled={done}
                onClick={() => push(d)}
              >
                {ARROWS[d]}
              </button>
            ))}
            <p className="lab-score slide-score" aria-live="off">
              {moves} push{moves === 1 ? '' : 'es'} · fewest {par}
              {coinsLeft
                ? ` · ${coinsLeft} coin${coinsLeft === 1 ? '' : 's'} left`
                : board.coins.length
                  ? ' · all coins'
                  : ''}
              {best !== undefined ? ` · best ${best}` : ''}
            </p>
          </div>
          <p className="muted lab-hint" aria-live="polite">
            {note && <strong>{note} </strong>}
            {done && mode === 'levels' && level < LEVELS.length - 1 && (
              <>
                <button className="btn" onClick={() => setLevel(level + 1)}>
                  Next level ›
                </button>{' '}
              </>
            )}
            {done && mode === 'endless' && (
              <>
                <button className="btn" onClick={() => setSeed(newSeed())}>
                  Another ›
                </button>{' '}
              </>
            )}
            The puck slides until something stops it — a wall, or a patch of snow, which it stops
            on. Take every coin, then come to rest on the ring: sliding over it does not count.
            Swipe on the board, use the buttons, or the arrow keys (Z undo, R restart, H hint).
            {mode === 'endless' &&
              ` This board is seed ${seed}; every one has been solved before you see it.`}
          </p>
        </>
      )}
    </div>
  )
}
