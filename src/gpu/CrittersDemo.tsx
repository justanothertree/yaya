import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  CRITTER_KEY,
  DT,
  GENERATION,
  MAX_JOINTS,
  POPULATION,
  PRESETS,
  boneAt,
  breed,
  jointAt,
  lcg,
  muscles,
  packStart,
  problem,
  randomBrain,
  readCritter,
  removeJoint,
  snap,
  stuck,
  type Body,
  type Brain,
  type V2,
} from './critters'
import { createCritters, type CrittersView } from './crittersEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Tool = 'joint' | 'bone' | 'muscle' | 'move' | 'erase'
const TOOLS: Record<Tool, string> = {
  joint: '● Joint',
  bone: '⎯ Bone',
  muscle: '💪 Muscle',
  move: '✋ Move',
  erase: '🧽 Erase',
}
const TOOL_IDS = Object.keys(TOOLS) as Tool[]
type Mode = 'build' | 'race' | 'champion'
/** metres of the world the stage's height shows, building and racing */
const BUILD_VIEW = 2.4
const RACE_VIEW = 4
const SPEEDS = [1, 4, 16]
/** a finger's reach when choosing a joint or bone, metres */
const REACH = 0.12

const loadSaved = () => {
  try {
    return readCritter(localStorage.getItem(CRITTER_KEY))
  } catch {
    return null
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
const stillBrain = (b: Body): Brain => ({
  phase: Array(muscles(b)).fill(0),
  strength: Array(muscles(b)).fill(0),
  beat: 1,
})

/**
 * Build a critter from joints, bones and muscles, then race 256 copies of it and watch them learn
 * to walk: each generation the furthest breed.
 */
export function CrittersDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(loadSaved())
  const [live, setLive] = useState(false)
  const [body, setBody] = useState<Body>(() => saved.current?.body ?? PRESETS.worm.body)
  const [tool, setTool] = useState<Tool>('joint')
  const [mode, setMode] = useState<Mode>('build')
  const [speed, setSpeed] = useState(4)
  const [generation, setGeneration] = useState(0)
  const [history, setHistory] = useState<number[]>([])
  const [leader, setLeader] = useState(0)
  const [champion, setChampion] = useState<Brain | null>(() => saved.current?.brain ?? null)
  const [note, setNote] = useState<string | null>(null)
  const now = useRef({ body, mode, speed, running, champion })
  now.current = { body, mode, speed, running, champion }

  const engine = useRef<CrittersView | null>(null)
  /** the race's own state, in a ref: the frame loop is built once and must never read stale state */
  const race = useRef({
    t: 0,
    brains: [] as Brain[],
    rand: lcg(1),
    waiting: false,
    frames: 0,
    cam: 0,
    best: 0,
    record: -Infinity,
    history: [] as number[],
  })
  const press = useRef<{ joint: number; at: V2 } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const why = problem(body)

  /* the body and the champion are kept in this browser */
  useEffect(() => {
    try {
      localStorage.setItem(CRITTER_KEY, JSON.stringify({ body, brain: champion }))
    } catch {
      /* private mode */
    }
  }, [body, champion])

  /** the stage shows what the mode wants: the body being built, the race, or the champion */
  const show = (m: Mode, b: Body) => {
    const v = engine.current
    if (!v) return
    v.body(b)
    const r = race.current
    if (m === 'build') {
      v.brains([stillBrain(b)])
      const f = new Float32Array(MAX_JOINTS * 4)
      b.joints.forEach((j, i) => f.set([j[0], j[1], 0, 0], i * 4))
      v.place(f, 1)
    } else if (m === 'race') {
      v.brains(r.brains)
      v.place(packStart(b), POPULATION)
    } else {
      v.brains([now.current.champion ?? stillBrain(b)])
      v.place(packStart(b, 1), 1)
    }
    r.t = 0
    r.cam = 0
    r.best = 0
  }
  useEffect(() => show(mode, body), [mode, body])

  const startRace = () => {
    if (why) return setNote(why)
    const r = race.current
    r.rand = lcg(Date.now() >>> 0)
    r.brains = Array.from({ length: POPULATION }, () => randomBrain(muscles(body), r.rand))
    r.record = -Infinity
    r.history = []
    setGeneration(1)
    setHistory([])
    setLeader(0)
    setMode('race')
    show('race', body)
    if (!running) setRunning(true)
  }

  /** a generation is over: how far each walked, the best breed, and the next one starts */
  const endGeneration = async () => {
    const v = engine.current
    const r = race.current
    if (!v || r.waiting) return
    r.waiting = true
    const state = await v.read()
    r.waiting = false
    if (!state || now.current.mode !== 'race') return
    const b = now.current.body
    const start = packStart(b)
    const n = b.joints.length
    const walked = r.brains.map((_, c) => {
      let d = 0
      for (let j = 0; j < n; j++)
        d += state[(c * MAX_JOINTS + j) * 4] - start[(c * MAX_JOINTS + j) * 4]
      return d / n
    })
    const top = Math.max(...walked)
    r.history = [...r.history, top]
    setHistory(r.history)
    // the champion is the best brain of the best generation so far, kept with the body
    if (top > r.record) {
      r.record = top
      setChampion(r.brains[walked.indexOf(top)])
    }
    r.brains = breed(r.brains, walked, r.rand)
    setGeneration((g) => g + 1)
    show('race', b)
  }

  /* where the pointer is, in metres, as the shader maps the stage */
  const toWorld = (e: PointerEvent<HTMLCanvasElement>): V2 => {
    const rect = e.currentTarget.getBoundingClientRect()
    const scale = rect.height / BUILD_VIEW
    return [
      (e.clientX - rect.left - rect.width / 2) / scale,
      0.8 + (rect.height / 2 - (e.clientY - rect.top)) / scale,
    ]
  }
  const edit = (f: (b: Body) => Body | null) => {
    const next = f(now.current.body)
    if (next) setBody(next)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (/^[1-5]$/.test(k) && mode === 'build') setTool(TOOL_IDS[Number(k) - 1])
    else if (/^[1-3]$/.test(k)) setSpeed(SPEEDS[Number(k) - 1])
    else if (k === 'e') setMode('build')
    else if (k === 'r') startRace()
    else return
    e.preventDefault()
  }

  const best = history.length ? Math.max(...history) : null
  const spark = history.length > 1 ? sparkline(history) : null
  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Critters">
      <LabStage
        label="A little creature of joints, bones and muscles, and a race of copies learning to walk"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const v = await createCritters(device, context, format, canvas)
          engine.current = v
          show(now.current.mode, now.current.body)
          return {
            frame: (dt: number) => {
              const m = now.current.mode
              const r = race.current
              const moving = dt > 0 && m !== 'build' && !r.waiting
              const steps = moving ? 4 * (m === 'race' ? now.current.speed : 1) : 0
              const view = m === 'build' ? BUILD_VIEW : RACE_VIEW
              /* the camera follows the leader, which is read back a few times a second */
              if (moving && ++r.frames % 12 === 0)
                void v.read().then((s) => {
                  if (!s || now.current.mode !== m) return
                  const n = now.current.body.joints.length
                  const count = m === 'race' ? POPULATION : 1
                  let far = -Infinity
                  for (let c = 0; c < count; c++) {
                    let x = 0
                    for (let j = 0; j < n; j++) x += s[(c * MAX_JOINTS + j) * 4]
                    if (x / n > far) {
                      far = x / n
                      r.best = c
                    }
                  }
                  r.cam = far
                  if (m === 'race') setLeader(far)
                })
              const camX = m === 'build' ? 0 : r.cam
              v.frame({
                steps,
                time: r.t,
                cam: [camX, m === 'build' ? 0.8 : 1.2],
                scale: canvas.height / view,
                best: m === 'race' ? r.best : 0,
                build: m === 'build',
              })
              r.t += steps * DT
              if (m === 'race' && r.t >= GENERATION) void endGeneration()
              if (m === 'champion' && r.t >= GENERATION * 2) show('champion', now.current.body)
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          if (mode !== 'build') return
          const p = toWorld(e)
          const j = jointAt(body, p, REACH)
          press.current = { joint: j, at: p }
          if (tool === 'joint' && j < 0) {
            if (body.joints.length >= MAX_JOINTS)
              return setNote(`A critter has ${MAX_JOINTS} joints at most.`)
            edit((b) => ({ ...b, joints: [...b.joints, snap(p)] }))
          } else if (tool === 'muscle') {
            const bi = boneAt(body, p, REACH)
            if (bi >= 0)
              edit((b) => ({
                ...b,
                bones: b.bones.map((x, i) => (i === bi ? { ...x, muscle: !x.muscle } : x)),
              }))
          } else if (tool === 'erase') {
            if (j >= 0) edit((b) => removeJoint(b, j))
            else {
              const bi = boneAt(body, p, REACH)
              if (bi >= 0) edit((b) => ({ ...b, bones: b.bones.filter((_, i) => i !== bi) }))
            }
          }
        }}
        onPointerMove={(e) => {
          const pr = press.current
          if (mode !== 'build' || !pr || tool !== 'move' || pr.joint < 0) return
          const p = snap(toWorld(e))
          edit((b) => ({ ...b, joints: b.joints.map((x, i) => (i === pr.joint ? p : x)) }))
        }}
        onPointerUp={(e) => {
          const pr = press.current
          press.current = null
          if (mode !== 'build' || !pr || tool !== 'bone' || pr.joint < 0) return
          const to = jointAt(body, toWorld(e), REACH)
          if (to < 0 || to === pr.joint) return
          const exists = body.bones.some(
            (x) => (x.a === pr.joint && x.b === to) || (x.a === to && x.b === pr.joint),
          )
          if (!exists)
            edit((b) => ({ ...b, bones: [...b.bones, { a: pr.joint, b: to, muscle: false }] }))
        }}
      />

      {live && mode !== 'build' && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <span className="lab-score" aria-live="polite">
            {mode === 'race'
              ? `Generation ${generation} · leader ${leader.toFixed(2)} m${best !== null ? ` · record ${best.toFixed(2)} m` : ''}`
              : `👑 The champion${best !== null ? ` · ${best.toFixed(2)} m` : ''}`}
          </span>
          {spark && (
            <svg
              className="critters-spark"
              viewBox="0 0 100 24"
              role="img"
              aria-label={`Best distance each generation, from ${history[0].toFixed(1)} to ${history.at(-1)!.toFixed(1)} metres`}
            >
              <polyline points={spark} fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          )}
          {mode === 'race' && (
            <div className="lab-group" role="group" aria-label="Speed">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  className="btn btn-ghost"
                  aria-pressed={speed === s}
                  onClick={() => setSpeed(s)}
                >
                  ×{s}
                </button>
              ))}
            </div>
          )}
          {champion && (
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'champion'}
              onClick={() => setMode(mode === 'champion' ? 'race' : 'champion')}
            >
              👑 {mode === 'champion' ? 'Back to the race' : 'Watch the champion'}
            </button>
          )}
          <button className="btn btn-ghost" onClick={startRace}>
            ↺ New race
          </button>
          <button className="btn btn-ghost" onClick={() => setMode('build')}>
            ✏️ Change the body
          </button>
        </div>
      )}

      {live && mode === 'build' && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="What a finger does">
            {TOOL_IDS.map((t) => (
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
          <button className="btn" disabled={!!why} onClick={startRace}>
            ▶ Race 256 of them
          </button>
          {champion && (
            <button className="btn btn-ghost" onClick={() => setMode('champion')}>
              👑 Watch the champion
            </button>
          )}
        </div>
      )}

      {live && (
        <div className="lab-controls" role="group" aria-label="Critters">
          {mode === 'build' &&
            Object.entries(PRESETS).map(([id, p]) => (
              <button
                key={id}
                className="btn btn-ghost"
                onClick={() => {
                  setBody(p.body)
                  setChampion(null)
                }}
              >
                {p.name}
              </button>
            ))}
          {mode === 'build' && (
            <button className="btn btn-ghost" onClick={() => setBody({ joints: [], bones: [] })}>
              ✕ Empty
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={() =>
              download(
                new Blob([JSON.stringify({ body, brain: champion }, null, 1)], {
                  type: 'application/json',
                }),
                'critter.json',
              )
            }
          >
            ⬇ Save critter
          </button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            ⬆ Open critter…
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
              const c = f.size <= 50_000 ? readCritter(await f.text()) : null
              if (!c) return setNote('That file is not a critter this toy can build.')
              setBody(c.body)
              setChampion(c.brain)
              setMode('build')
              setNote(`Opened ${f.name}.`)
            }}
          />
        </div>
      )}

      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <>{note} </>}
          {mode === 'build' ? (
            <>
              {why ? (
                <strong>{why} </strong>
              ) : stuck(body) ? (
                <strong>
                  It is the same both ways round with one muscle, so every push is matched by one
                  the other way and it cannot go anywhere: give it a second muscle, or move a joint
                  off centre.{' '}
                </strong>
              ) : (
                <strong>Ready to race. </strong>
              )}
              ● Joint taps joints onto the grid; ⎯ Bone drags from one joint to another; 💪 Muscle
              taps a bone to make it a muscle (red) that pulses; ✋ Move drags a joint; 🧽 Erase
              taps one away. Or start from a Hopper, an Inchworm or a Walker. Then race 256 copies:
              each has its own timing for every muscle, and after eight seconds the 64 that got
              furthest breed the next 256.
            </>
          ) : (
            <>
              Every copy is the same body with its own brain — when each muscle pulses, how hard,
              and how fast. The bright one is in the lead; after {GENERATION} seconds the furthest
              64 breed. The line beside the record is the best of each generation. On the GPU each
              critter is a workgroup, its joints held in shared memory through every step.
            </>
          )}
          {!touchOnly() &&
            ' Keys, once it has focus: Space pause, 1–5 tool or 1–3 speed, E edit, R new race.'}
        </p>
      )}
    </div>
  )
}

/** the best of each generation as an SVG polyline in a 100×24 box */
function sparkline(h: number[]) {
  const lo = Math.min(...h)
  const hi = Math.max(...h)
  return h
    .map(
      (v, i) =>
        `${((i / (h.length - 1)) * 100).toFixed(1)},${(22 - ((v - lo) / (hi - lo || 1)) * 20).toFixed(1)}`,
    )
    .join(' ')
}
