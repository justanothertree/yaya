import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  DT,
  MAX_JOINTS,
  boneAt,
  jointAt,
  muscles,
  problem,
  removeJoint,
  snap,
  type Body,
  type V2,
} from './critters'
import {
  FINISH,
  MAX_MUSCLES,
  STEPS,
  STRUTS,
  STRUT_BEST_KEY,
  STRUT_KEY,
  VOICES,
  drums,
  fewestBars,
  hueOf,
  middleOf,
  notes,
  readBest,
  readStrut,
  splatsFor,
  trailFor,
  startStrut,
  stepAt,
  stepLength,
  strut,
  type Pattern,
  type StrutState,
  type Voice,
} from './strut'
import { createStrut, type StrutView } from './strutEngine'
import { useKept } from './kept'

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
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
const KEYS = [48, 50, 52, 53, 55, 57]
/** metres of the world the stage's height shows */
const VIEW = 2.6
const REACH = 0.12

const loadSaved = () => {
  try {
    return readStrut(localStorage.getItem(STRUT_KEY))
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
/** a pattern's rows fitted to a body's muscles: kept where they exist, empty where new */
const fit = (p: Pattern, b: Body): Pattern => ({
  ...p,
  rows: Array.from(
    { length: muscles(b) },
    (_, i) => p.rows[i] ?? Array<boolean>(STEPS).fill(false),
  ),
})

/**
 * A creature whose step sequencer is its gait and its song: light steps on the grid and each muscle
 * pulls and plays on them, its feet drum where they land, and the walk leaves a watercolour of the
 * song on the floor behind it.
 */
export function StrutDemo({ running, setRunning, onAdapter }: Props) {
  const saved = useRef(loadSaved())
  const [live, setLive] = useState(false)
  const [body, setBody] = useState<Body>(() => saved.current?.body ?? STRUTS.stomper.body)
  const [pattern, setPattern] = useState<Pattern>(
    () => saved.current?.pattern ?? STRUTS.stomper.pattern,
  )
  const [editing, setEditing] = useState(false)
  const [tool, setTool] = useState<Tool>('joint')
  const [sound, setSound] = useState(true)
  const [step, setStep] = useState(0)
  const [walked, setWalked] = useState(0)
  const [finished, setFinished] = useState<number | null>(null)
  const [best, setBest] = useKept(STRUT_BEST_KEY, readBest)
  const [note, setNote] = useState<string | null>(null)
  const now = useRef({ body, pattern, editing, sound, running })
  now.current = { body, pattern, editing, sound, running }
  const engine = useRef<StrutView | null>(null)
  const sim = useRef<StrutState>(startStrut(body))
  const press = useRef<{ joint: number } | null>(null)
  const voices = useRef(new Map<string, number>())
  const fileRef = useRef<HTMLInputElement | null>(null)
  const why =
    problem(body) ??
    (muscles(body) > MAX_MUSCLES ? `This toy plays ${MAX_MUSCLES} muscles at most.` : null)

  /* a walk that reaches the flag is a result: the fewest bars is kept */
  useEffect(() => {
    if (finished !== null) setBest((b) => fewestBars(b, finished))
  }, [finished, setBest])

  /* the creation is kept in this browser as it changes */
  useEffect(() => {
    try {
      localStorage.setItem(STRUT_KEY, JSON.stringify({ body, pattern }))
    } catch {
      /* private mode */
    }
  }, [body, pattern])

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
  const play = (instrument: Voice | 'drums', midi: number, ms: number) => {
    const id = `strut-${instrument}-${midi}-${performance.now()}`
    noteOn(id, instrument, midi)
    voices.current.set(
      id,
      window.setTimeout(() => {
        noteOff(id)
        voices.current.delete(id)
      }, ms),
    )
  }

  const restart = () => {
    sim.current = startStrut(now.current.body)
    setFinished(null)
    setWalked(0)
  }
  const change = (b: Body) => {
    setBody(b)
    setPattern((p) => fit(p, b))
    sim.current = startStrut(b)
  }
  const preset = (id: keyof typeof STRUTS) => {
    setBody(STRUTS[id].body)
    setPattern(STRUTS[id].pattern)
    sim.current = startStrut(STRUTS[id].body)
    engine.current?.clear()
    setFinished(null)
  }
  const toggle = (m: number, k: number) =>
    setPattern((p) => ({
      ...p,
      rows: p.rows.map((r, i) => (i === m ? r.map((c, j) => (j === k ? !c : c)) : r)),
    }))

  const toWorld = (e: PointerEvent<HTMLCanvasElement>): V2 => {
    const rect = e.currentTarget.getBoundingClientRect()
    const scale = rect.height / VIEW
    return [
      (e.clientX - rect.left - rect.width / 2) / scale,
      1 + (rect.height / 2 - (e.clientY - rect.top)) / scale,
    ]
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'r') restart()
    else if (k === 'e') setEditing((v) => !v)
    else if (k === 'm') setSound((v) => !v)
    else if (/^[1-5]$/.test(k) && editing) setTool(TOOL_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const tones = notes(body, pattern.root)
  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Strut">
      <LabStage
        label="A creature on watercolour paper, walking to the beat of its own step sequencer"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const v = await createStrut(device, context, format, canvas)
          engine.current = v
          let acc = 0
          let t = 0
          let shownStep = -1
          let cam = 0
          let frames = 0
          return {
            frame: (dt: number) => {
              const { body: b, pattern: p, editing: ed, sound: snd } = now.current
              const s = sim.current
              const ok = !problem(b) && muscles(b) <= MAX_MUSCLES
              let splats: number[] = []
              if (dt > 0 && !ed && ok && s.x.length === b.joints.length) {
                acc = Math.min(acc + dt, 0.1)
                const n = Math.floor(acc / DT)
                acc -= n * DT
                const events = strut(b, p, s, n)
                splats = splatsFor(events, b, p, s)
                // the dance, a dot a joint every few frames
                if (++frames % 4 === 0) splats.push(...trailFor(s))
                if (snd) {
                  const tn = notes(b, p.root)
                  const dr = drums(b)
                  for (const ev of events.slice(0, 12))
                    if (ev.kind === 'note')
                      play(p.instrument, tn[ev.muscle], stepLength(p.bpm) * 900)
                    else play('drums', dr[ev.joint], 150)
                }
                const st = stepAt(s.t, p.bpm)
                if (st !== shownStep) {
                  shownStep = st
                  setStep(st)
                  setWalked(middleOf(s))
                  if (middleOf(s) >= FINISH)
                    setFinished((f) => f ?? s.t / (stepLength(p.bpm) * STEPS))
                }
              }
              t += dt
              // in the editor the body is drawn where it is being built; walking, it is followed
              const editJoints = ed || s.x.length !== b.joints.length
              const target = editJoints ? 0 : middleOf(s) + 0.5
              cam += (target - cam) * (editJoints ? 1 : 1 - Math.exp(-4 * Math.max(dt, 0.016)))
              const joints = editJoints
                ? b.joints.flat()
                : Array.from(s.x).flatMap((x, i) => [x, s.y[i]])
              const tn = notes(b, p.root)
              let m = 0
              const bones = b.bones.flatMap((bone) => {
                if (!bone.muscle) return [bone.a, bone.b, 0, -1]
                const mi = m++
                const on = p.rows[mi]?.[stepAt(s.t, p.bpm)] ?? false
                return [bone.a, bone.b, on && !ed ? 1 : 0, ((((tn[mi] ?? 0) % 12) + 12) % 12) / 12]
              })
              v.frame({
                cam: [cam, editJoints ? 1 : 1.1],
                scale: canvas.height / VIEW,
                time: t,
                splats,
                bones,
                joints,
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          if (!editing) return
          const p = toWorld(e)
          const j = jointAt(body, p, REACH)
          press.current = { joint: j }
          if (tool === 'joint' && j < 0) {
            if (body.joints.length >= MAX_JOINTS)
              return setNote(`A creature has ${MAX_JOINTS} joints at most.`)
            change({ ...body, joints: [...body.joints, snap(p)] })
          } else if (tool === 'muscle') {
            const bi = boneAt(body, p, REACH)
            if (bi >= 0)
              change({
                ...body,
                bones: body.bones.map((x, i) => (i === bi ? { ...x, muscle: !x.muscle } : x)),
              })
          } else if (tool === 'erase') {
            if (j >= 0) change(removeJoint(body, j))
            else {
              const bi = boneAt(body, p, REACH)
              if (bi >= 0) change({ ...body, bones: body.bones.filter((_, i) => i !== bi) })
            }
          }
        }}
        onPointerMove={(e) => {
          const pr = press.current
          if (!editing || !pr || tool !== 'move' || pr.joint < 0) return
          const p = snap(toWorld(e))
          change({ ...body, joints: body.joints.map((x, i) => (i === pr.joint ? p : x)) })
        }}
        onPointerUp={(e) => {
          const pr = press.current
          press.current = null
          if (!editing || !pr || tool !== 'bone' || pr.joint < 0) return
          const to = jointAt(body, toWorld(e), REACH)
          if (to < 0 || to === pr.joint) return
          if (
            !body.bones.some(
              (x) => (x.a === pr.joint && x.b === to) || (x.a === to && x.b === pr.joint),
            )
          )
            change({ ...body, bones: [...body.bones, { a: pr.joint, b: to, muscle: false }] })
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Play'}
          </button>
          <button className="btn btn-ghost" onClick={restart}>
            ⏮ From the start
          </button>
          <span className="lab-score" aria-live="polite">
            {finished !== null
              ? `🏁 the flag in ${finished.toFixed(1)} bars`
              : `${Math.max(0, walked).toFixed(1)} / ${FINISH} m`}
            {best !== null && ` · best ${best.toFixed(1)} bars`}
          </span>
          <button
            className="btn btn-ghost"
            aria-pressed={editing}
            onClick={() => setEditing((v) => !v)}
          >
            ✏️ Body
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

      {live && editing && (
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
          {Object.entries(STRUTS).map(([id, s]) => (
            <button
              key={id}
              className="btn btn-ghost"
              onClick={() => preset(id as keyof typeof STRUTS)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {live && !why && (
        <div
          className="strut-grid"
          role="group"
          aria-label="The sequencer: each row a muscle, each column a sixteenth"
        >
          {pattern.rows.map((r, m) => {
            const [cr, cg, cb] = hueOf(tones[m] ?? 0).map((x) => Math.round(x * 255))
            return (
              <div key={m} className="strut-row">
                <span className="strut-name" style={{ borderColor: `rgb(${cr} ${cg} ${cb})` }}>
                  {NAMES[(((tones[m] ?? 0) % 12) + 12) % 12]}
                </span>
                {r.map((on, k) => (
                  <button
                    key={k}
                    className="strut-cell"
                    aria-pressed={on}
                    aria-label={`Muscle ${m + 1}, step ${k + 1}`}
                    data-now={k === step && running && !editing ? 'yes' : undefined}
                    data-beat={k % 4 === 0 ? 'yes' : undefined}
                    style={on ? { background: `rgb(${cr} ${cg} ${cb})` } : undefined}
                    onClick={() => toggle(m, k)}
                  />
                ))}
              </div>
            )
          })}
        </div>
      )}

      {live && (
        <div className="lab-controls">
          <label className="appearance-slider lab-flow">
            <span className="muted">Tempo</span>
            <input
              type="range"
              min={60}
              max={160}
              step={1}
              value={pattern.bpm}
              onChange={(e) => setPattern((p) => ({ ...p, bpm: Number(e.target.value) }))}
            />
            <span className="appearance-slider-val">{pattern.bpm}</span>
          </label>
          <label className="studio-pick">
            <span className="muted">Voice</span>
            <select
              value={pattern.instrument}
              onChange={(e) => setPattern((p) => ({ ...p, instrument: e.target.value as Voice }))}
            >
              {VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="studio-pick">
            <span className="muted">Key</span>
            <select
              value={pattern.root}
              onChange={(e) => setPattern((p) => ({ ...p, root: Number(e.target.value) }))}
            >
              {KEYS.map((k) => (
                <option key={k} value={k}>
                  {NAMES[k % 12]}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              const blob = await engine.current?.print()
              if (blob) download(blob, 'strut-painting.png')
              else setNote('The painting could not be read back from the GPU.')
            }}
          >
            ⬇ Save painting
          </button>
          <button className="btn btn-ghost" onClick={() => engine.current?.clear()}>
            🧻 Fresh paper
          </button>
          <button
            className="btn btn-ghost"
            onClick={() =>
              download(
                new Blob([JSON.stringify({ body, pattern }, null, 1)], {
                  type: 'application/json',
                }),
                'strut.json',
              )
            }
          >
            ⬇ Save strut
          </button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            ⬆ Open strut…
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
              const s = f.size <= 50_000 ? readStrut(await f.text()) : null
              if (!s) return setNote('That file is not a strut this toy can play.')
              setBody(s.body)
              setPattern(s.pattern)
              sim.current = startStrut(s.body)
              setNote(`Opened ${f.name}.`)
            }}
          />
        </div>
      )}

      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <>{note} </>}
          {why ? (
            <strong>{why} </strong>
          ) : (
            <>
              Each row of the grid is a muscle, playing its own note — longer muscles lower. Light a
              step and that muscle pulls in on it and sounds; its feet drum where they land. So a
              groove either walks or falls over: find one that gets your creature to the flag{' '}
              {FINISH} m away, and leaves a watercolour of the song on the floor behind it to
              keep.{' '}
            </>
          )}
          ✏️ Body opens the builder (the same rules as Critters, which the creature's shape and its
          sound both come from).
          {!touchOnly() &&
            ' Keys, once it has focus: Space play, R from the start, E body, M sound, 1–5 tool.'}
        </p>
      )}
    </div>
  )
}
