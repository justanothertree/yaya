import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { LabStage } from './LabStage'
import {
  CELLS,
  COLS,
  ROWS,
  FILE_LIMIT,
  LEVELS,
  MAX_BUDGET,
  MAX_GENS,
  RULES,
  SEEDLING_KEY,
  SOLUTIONS,
  at,
  blankLevel,
  gardenFit,
  marksOf,
  paintStone,
  parseRule,
  plant,
  readLevel,
  ruleText,
  setPatch,
  stampAt,
  step,
  tapSeeds,
  toggleLamp,
  type Level,
  type Stamp,
  type V2,
} from './seedling'
import { createSeedling, type SeedlingView } from './seedlingEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Mode = 'play' | 'make'
type Tool = 'stone' | 'lamp' | 'patch' | 'erase'
const TOOLS: Record<Tool, string> = {
  stone: '🪨 Stone',
  lamp: '💡 Lamp',
  patch: '🌱 Patch',
  erase: '🧽 Erase',
}
/** −1 is the garden you made */
type Pick = number
type Best = Record<string, { seeds: number; gen: number }>
type Saved = { made: Level; best: Best; level: Pick }

const load = (): Saved => {
  const fresh: Saved = { made: blankLevel(), best: {}, level: 0 }
  try {
    const raw = localStorage.getItem(SEEDLING_KEY)
    if (!raw || raw.length > FILE_LIMIT * 2) return fresh
    const v = JSON.parse(raw) as Partial<Saved>
    const made = readLevel(JSON.stringify(v.made))
    const best: Best = {}
    if (v.best && typeof v.best === 'object')
      for (const [k, b] of Object.entries(v.best).slice(0, 50))
        if (b && Number.isInteger(b.seeds) && Number.isInteger(b.gen))
          best[k.slice(0, 40)] = { seeds: b.seeds, gen: b.gen }
    const level =
      Number.isInteger(v.level) && (v.level as number) >= -1 && (v.level as number) < LEVELS.length
        ? (v.level as number)
        : 0
    return { made: typeof made === 'string' ? fresh.made : made, best, level }
  } catch {
    return fresh
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
const cellOf = (e: PointerEvent<HTMLCanvasElement>): V2 => {
  const r = e.currentTarget.getBoundingClientRect()
  const [x, y] = gardenFit([r.width, r.height], [e.clientX - r.left, e.clientY - r.top])
  return [Math.floor(x), Math.floor(y)]
}
const onBoard = ([x, y]: V2) => x >= 0 && y >= 0 && x < COLS && y < ROWS

/** what is growing: the judge's own board, a generation at a time */
type Growth = {
  cells: Uint8Array
  next: Uint8Array
  stones: Uint8Array
  lit: boolean[]
  gen: number
  /** −1 still going, otherwise the generation every lamp was lit (solved) or it ran out (0) */
  end: number
  solved: boolean
}
const startGrowth = (l: Level, seeds: readonly V2[]): Growth => {
  const p = plant(l, seeds)
  return {
    cells: p.cells,
    next: new Uint8Array(CELLS),
    stones: p.stones,
    lit: l.lamps.map(([x, y]) => p.cells[at(x, y)] === 1),
    gen: 0,
    end: -1,
    solved: false,
  }
}

export function SeedlingDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(load()).current
  const [live, setLive] = useState(false)
  const [mode, setMode] = useState<Mode>('play')
  const [pick, setPick] = useState<Pick>(saved.level)
  const [made, setMade] = useState<Level>(saved.made)
  const [best, setBest] = useState<Best>(saved.best)
  const [seeds, setSeeds] = useState<V2[]>([])
  const [stamp, setStamp] = useState<Stamp>('cell')
  const [turnK, setTurnK] = useState(0)
  const [tool, setTool] = useState<Tool>('stone')
  const [speed, setSpeed] = useState(8)
  const [growing, setGrowing] = useState(false)
  const [shown, setShown] = useState({ gen: 0, lit: 0, end: -1, solved: false })
  const [note, setNote] = useState<string | null>(null)
  const [ruleDraft, setRuleDraft] = useState(ruleText(saved.made.rule))
  const level = pick < 0 || mode === 'make' ? made : LEVELS[pick]
  const now = useRef({ level, seeds, growing, speed, mode, running })
  now.current = { level, seeds, growing, speed, mode, running }
  const engine = useRef<SeedlingView | null>(null)
  const growth = useRef<Growth>(startGrowth(level, seeds))
  /** the GPU's garden needs loading again: what is planted, or the garden itself, changed */
  const stale = useRef(true)
  const drag = useRef<{ from: V2; paint: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** what is planted came from 💡 Show a way, so solving it is not yours to keep as a best */
  const shownWay = useRef(false)

  /* what is kept: the garden you made, your best for each, and which you were on */
  useEffect(() => {
    try {
      localStorage.setItem(SEEDLING_KEY, JSON.stringify({ made, best, level: pick }))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [made, best, pick])

  /** back to generation 0 with what is planted (or `s`) */
  const replant = (s: readonly V2[] = now.current.seeds, l: Level = now.current.level) => {
    growth.current = startGrowth(l, s)
    stale.current = true
    setGrowing(false)
    setShown({ gen: 0, lit: growth.current.lit.filter(Boolean).length, end: -1, solved: false })
  }
  const choose = (p: Pick) => {
    shownWay.current = false
    setPick(p)
    setSeeds([])
    setNote(null)
    replant([], p < 0 ? made : LEVELS[p])
  }
  /* a drag can send several moves before React draws again, so each edit builds on the last one
     made rather than on the garden as it was at the last draw — or a quick stroke drops cells */
  const madeNow = useRef(made)
  madeNow.current = made
  const changeMade = (l: Level) => {
    madeNow.current = l
    setMade(l)
    replant([], l)
  }

  const grow = () => {
    const g = growth.current
    if (now.current.mode === 'make') return
    if (g.end >= 0) replant()
    setNote(null)
    setGrowing((v) => !v)
    if (!now.current.running) setRunning(true)
  }

  const tap = (c: V2) => {
    const l = now.current.level
    if (growth.current.gen > 0) replant()
    const r = tapSeeds(l, now.current.seeds, stampAt(stamp, turnK, c[0], c[1]))
    setNote(r.why ?? null)
    if (r.seeds.length !== now.current.seeds.length) shownWay.current = false
    setSeeds(r.seeds)
    replant(r.seeds)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (mode === 'play' && k === ' ') grow()
    else if (mode === 'play' && k === 'r') replant()
    else if (mode === 'play' && k === 'c') {
      setSeeds([])
      replant([])
    } else if (mode === 'play' && k === 'g') setStamp((s) => (s === 'cell' ? 'glider' : 'cell'))
    else if (mode === 'play' && k === 't') setTurnK((t) => (t + 1) % 4)
    else if (mode === 'make' && /^[1-4]$/.test(k)) setTool((Object.keys(TOOLS) as Tool[])[+k - 1])
    else return
    e.preventDefault()
  }

  const finished = (solved: boolean, gen: number) => {
    const l = now.current.level
    const used = now.current.seeds.length
    if (!solved || now.current.mode === 'make' || shownWay.current) return
    setBest((b) => {
      const was = b[l.name]
      if (was && (was.seeds < used || (was.seeds === used && was.gen <= gen))) return b
      return { ...b, [l.name]: { seeds: used, gen } }
    })
  }

  const lit = shown.lit
  const lamps = level.lamps.length
  const status =
    mode === 'make'
      ? null
      : shown.solved
        ? `✨ Every lamp lit by generation ${shown.end}, with ${seeds.length} of ${level.budget} seeds.`
        : shown.end === 0
          ? `The garden ran out of time with ${lit} of ${lamps} lamps lit. Replant and try again.`
          : `🌱 ${seeds.length}/${level.budget} seeds · 💡 ${lit}/${lamps} lit · generation ${shown.gen}/${level.gens}`
  const kept = mode === 'play' ? best[level.name] : undefined
  const ruleOk = parseRule(ruleDraft)

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Seedling">
      <LabStage
        label="A walled garden of Life: plant a few seed cells in the patch so that what grows lights every lamp"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createSeedling(device, context, format, canvas)
          engine.current = v
          stale.current = true
          let t = 0
          let due = 0
          let phase = 1
          return {
            frame: (dt: number) => {
              const { level: l, growing: on, speed: sp, mode: md } = now.current
              const g = growth.current
              if (stale.current) {
                stale.current = false
                v.load(marksOf(l), g.cells)
                phase = 1
              }
              t += dt
              if (on && md === 'play' && g.end < 0 && dt > 0) {
                due = Math.min(due + dt * sp, 4)
                phase = Math.min(1, phase + dt * sp)
                let steps = 0
                while (due >= 1 && g.end < 0) {
                  due -= 1
                  steps++
                  step(g.cells, g.stones, l.rule, g.next)
                  ;[g.cells, g.next] = [g.next, g.cells]
                  g.gen++
                  v.grow(l.rule)
                  l.lamps.forEach(([x, y], k) => {
                    if (g.cells[at(x, y)]) g.lit[k] = true
                  })
                  if (g.lit.every(Boolean)) {
                    g.end = g.gen
                    g.solved = true
                  } else if (g.gen >= l.gens) g.end = 0
                }
                if (steps) {
                  phase = 0
                  const done = g.end >= 0
                  setShown({
                    gen: g.gen,
                    lit: g.lit.filter(Boolean).length,
                    end: g.end,
                    solved: g.solved,
                  })
                  if (done) {
                    setGrowing(false)
                    finished(g.solved, g.gen)
                  }
                }
              } else due = 0
              v.frame({
                patch: l.patch,
                rule: l.rule,
                time: t,
                phase,
                planting: md === 'make' || g.gen === 0,
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const c = cellOf(e)
          if (!onBoard(c)) return
          if (mode === 'play') return tap(c)
          const m = madeNow.current
          if (tool === 'lamp') return changeMade(toggleLamp(m, ...c))
          if (tool === 'patch') {
            drag.current = { from: c, paint: true }
            return changeMade(setPatch(m, c, c))
          }
          const paint = tool === 'stone'
          drag.current = { from: c, paint }
          changeMade(
            paint ? paintStone(m, ...c, true) : toggleLampOff(paintStone(m, ...c, false), c),
          )
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (mode !== 'make' || !d) return
          const c = cellOf(e)
          if (!onBoard(c)) return
          const m = madeNow.current
          if (tool === 'patch') changeMade(setPatch(m, d.from, c))
          else if (tool === 'stone') changeMade(paintStone(m, ...c, true))
          else if (tool === 'erase') changeMade(toggleLampOff(paintStone(m, ...c, false), c))
        }}
        onPointerUp={() => {
          drag.current = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="Play or make">
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'play'}
              onClick={() => {
                setMode('play')
                replant(seeds, pick < 0 ? made : LEVELS[pick])
              }}
            >
              🌱 Play
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'make'}
              onClick={() => {
                setMode('make')
                setSeeds([])
                replant([], made)
              }}
            >
              🛠 Make
            </button>
          </div>
          {mode === 'play' && (
            <label className="studio-pick">
              <span className="muted">Garden</span>
              <select value={pick} onChange={(e) => choose(Number(e.target.value))}>
                {LEVELS.map((l, k) => (
                  <option key={l.name} value={k}>
                    {k + 1}. {l.name}
                    {best[l.name] ? ' ✓' : ''}
                  </option>
                ))}
                <option value={-1}>✏️ {made.name}</option>
              </select>
            </label>
          )}
        </div>
      )}

      {live && mode === 'play' && (
        <div className="lab-controls">
          <button className="btn" onClick={grow} aria-pressed={growing}>
            {growing ? '⏸ Pause' : shown.end >= 0 ? '⏮ Again' : '▶ Grow'}
          </button>
          <button className="btn btn-ghost" onClick={() => replant()}>
            ⏮ Replant
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              shownWay.current = false
              setSeeds([])
              replant([])
            }}
          >
            🧹 Clear seeds
          </button>
          <div className="lab-group" role="group" aria-label="What a tap plants">
            <button
              className="btn btn-ghost"
              aria-pressed={stamp === 'cell'}
              onClick={() => setStamp('cell')}
            >
              ● Cell
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={stamp === 'glider'}
              onClick={() => setStamp('glider')}
            >
              🛩 Glider
            </button>
            {stamp === 'glider' && (
              <button className="btn btn-ghost" onClick={() => setTurnK((t) => (t + 1) % 4)}>
                ↻ Turn {['↘', '↙', '↖', '↗'][turnK]}
              </button>
            )}
          </div>
          <label className="appearance-slider lab-flow">
            <span className="muted">Speed</span>
            <input
              type="range"
              min={2}
              max={30}
              step={1}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{speed}/s</span>
          </label>
          {pick >= 0 && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                const s = SOLUTIONS[pick]
                shownWay.current = true
                setSeeds(s)
                replant(s)
                setNote('One way to do it. There are others.')
              }}
            >
              💡 Show a way
            </button>
          )}
        </div>
      )}

      {live && mode === 'make' && (
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
          <label className="studio-pick">
            <span className="muted">Name</span>
            <input
              className="seedling-name"
              value={made.name}
              maxLength={40}
              onChange={(e) => setMade({ ...made, name: e.target.value })}
            />
          </label>
          <label className="studio-pick">
            <span className="muted">Rule</span>
            <select
              value={
                Object.keys(RULES).find(
                  (k) => ruleText(RULES[k as keyof typeof RULES]) === ruleDraft,
                ) ?? ''
              }
              onChange={(e) => {
                const r = RULES[e.target.value as keyof typeof RULES]
                if (!r) return
                setRuleDraft(ruleText(r))
                changeMade({ ...made, rule: { born: r.born, stays: r.stays } })
              }}
            >
              {Object.entries(RULES).map(([k, r]) => (
                <option key={k} value={k}>
                  {r.name}
                </option>
              ))}
              <option value="" disabled>
                Your own
              </option>
            </select>
            <input
              className="seedling-rule"
              value={ruleDraft}
              aria-label="Rule in B/S notation, such as B3/S23"
              aria-invalid={!ruleOk}
              maxLength={24}
              onChange={(e) => {
                setRuleDraft(e.target.value)
                const r = parseRule(e.target.value)
                if (r) changeMade({ ...made, rule: r })
              }}
            />
          </label>
          <label className="studio-pick">
            <span className="muted">Seeds</span>
            <input
              className="seedling-num"
              type="number"
              min={1}
              max={MAX_BUDGET}
              value={made.budget}
              onChange={(e) =>
                setMade({
                  ...made,
                  budget: Math.max(1, Math.min(MAX_BUDGET, Math.round(+e.target.value) || 1)),
                })
              }
            />
          </label>
          <label className="studio-pick">
            <span className="muted">Generations</span>
            <input
              className="seedling-num"
              type="number"
              min={1}
              max={MAX_GENS}
              value={made.gens}
              onChange={(e) =>
                setMade({
                  ...made,
                  gens: Math.max(1, Math.min(MAX_GENS, Math.round(+e.target.value) || 1)),
                })
              }
            />
          </label>
        </div>
      )}
      {live && mode === 'make' && (
        <div className="lab-controls">
          <button
            className="btn"
            onClick={() => {
              const ok = readLevel(JSON.stringify(made))
              if (typeof ok === 'string') return setNote(ok)
              setMode('play')
              setPick(-1)
              setSeeds([])
              replant([], made)
              setNote('Your garden — now solve it.')
            }}
          >
            ▶ Try it
          </button>
          <button
            className="btn btn-ghost"
            onClick={() =>
              download(
                new Blob([JSON.stringify(made, null, 1)], { type: 'application/json' }),
                'garden.json',
              )
            }
          >
            ⬇ Save garden
          </button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            ⬆ Open garden…
          </button>
          <button className="btn btn-ghost" onClick={() => changeMade(blankLevel())}>
            🧹 Start over
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
              const l =
                f.size <= FILE_LIMIT
                  ? readLevel(await f.text())
                  : 'That file is too big to be a garden.'
              if (typeof l === 'string') return setNote(l)
              changeMade(l)
              setRuleDraft(ruleText(l.rule))
              setNote(`Opened ${f.name}.`)
            }}
          />
        </div>
      )}

      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {status && <strong>{status} </strong>}
          {note && <>{note} </>}
          {kept && (
            <>
              Your best here: {kept.seeds} seeds, generation {kept.gen}.{' '}
            </>
          )}
          {mode === 'play' ? (
            <>
              {level.hint || 'Light every lamp before the generations run out.'} Rule{' '}
              {ruleText(level.rule)}. Tap the green patch to plant; Space grows, R replants, G
              glider, T turns it.
            </>
          ) : (
            <>
              Lay stones, place lamps and drag out the planting patch; set the rule, the seeds and
              the time; then ▶ Try it. Saved here as you go, and as a file with ⬇ Save garden.
            </>
          )}
        </p>
      )}
    </div>
  )
}

/** the erase tool takes a lamp away as well as a stone */
function toggleLampOff(l: Level, [x, y]: V2): Level {
  return l.lamps.some(([a, b]) => a === x && b === y) ? toggleLamp(l, x, y) : l
}
