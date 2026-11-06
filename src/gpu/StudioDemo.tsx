import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  DEFAULT_SCENE,
  MATERIALS,
  MAX_LAMPS,
  MAX_THINGS,
  POSES,
  SCENE_KEY,
  SWATCHES,
  onPlane,
  pick,
  rayAt,
  readScene,
  view,
  type Kind,
  type Lamp,
  type Material,
  type Pose,
  type RGB,
  type Scene,
  type Thing,
} from './studio'
import { createStudio, type StudioView } from './studioEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Selected = { what: 'thing' | 'lamp'; index: number } | null
/** paths a pixel the preview settles at, and a finished shot */
const PREVIEW = 48
const SHOT = 512
/** paths a pixel each frame */
const PER_FRAME = 2
const LAMP_COLOURS: Record<string, RGB> = {
  warm: [1, 0.8, 0.6],
  white: [1, 1, 1],
  cool: [0.6, 0.75, 1],
  rose: [1, 0.55, 0.7],
}

const clone = (s: Scene): Scene => JSON.parse(JSON.stringify(s)) as Scene
const loadScene = () => {
  try {
    return readScene(localStorage.getItem(SCENE_KEY)) ?? clone(DEFAULT_SCENE)
  } catch {
    return clone(DEFAULT_SCENE)
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

/**
 * A tiny film studio: put actors, props and lamps on the floor, pose them, frame the shot with a
 * real lens, and shoot it — the GPU path traces it until it is clean — then keep the picture.
 */
export function StudioDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [scene, setScene] = useState<Scene>(loadScene)
  const [selected, setSelected] = useState<Selected>(null)
  const [samples, setSamples] = useState(0)
  const [target, setTarget] = useState(PREVIEW)
  const [note, setNote] = useState<string | null>(null)
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const now = useRef({ running, target })
  now.current = { running, target }
  const engine = useRef<StudioView | null>(null)
  /** what a drag is moving; a thing keeps the height it was grabbed at and its offset from there */
  const drag = useRef<{
    kind: 'thing' | 'lamp' | 'orbit'
    index: number
    x: number
    y: number
    moved: number
    dx: number
    dz: number
    h: number
  } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  /* every change goes to the GPU (the picture starts again) and, a moment later, to storage */
  useEffect(() => {
    engine.current?.scene(scene)
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(SCENE_KEY, JSON.stringify(scene))
      } catch {
        /* private mode: the scene lasts this visit */
      }
    }, 400)
    return () => window.clearTimeout(id)
  }, [scene])

  const change = (f: (s: Scene) => void) => {
    const next = clone(sceneRef.current)
    f(next)
    setScene(next)
    setTarget(PREVIEW)
    if (!now.current.running) setRunning(true)
  }
  const thing = selected?.what === 'thing' ? scene.things[selected.index] : null
  const lamp = selected?.what === 'lamp' ? scene.lamps[selected.index] : null
  const editThing = (f: (t: Thing) => void) =>
    change((s) => {
      if (selected?.what === 'thing' && s.things[selected.index]) f(s.things[selected.index])
    })
  const editLamp = (f: (l: Lamp) => void) =>
    change((s) => {
      if (selected?.what === 'lamp' && s.lamps[selected.index]) f(s.lamps[selected.index])
    })

  const addThing = (kind: Kind) => {
    if (scene.things.length >= MAX_THINGS)
      return setNote(`A scene holds ${MAX_THINGS} things at most.`)
    change((s) => {
      const c = s.camera
      s.things.push({
        kind,
        x: c.target[0] + (Math.random() - 0.5) * 1.5,
        z: c.target[2] + (Math.random() - 0.5) * 1.5,
        turn: 0,
        size: kind === 'actor' ? 1 : kind === 'box' ? 0.7 : 0.35,
        colour: Object.values(SWATCHES)[s.things.length % 8],
        material: 'matte',
        pose: 'stand',
      })
    })
    setSelected({ what: 'thing', index: scene.things.length })
  }
  const addLamp = () => {
    if (scene.lamps.length >= MAX_LAMPS) return setNote(`A scene holds ${MAX_LAMPS} lamps at most.`)
    change((s) => s.lamps.push({ x: 0, y: 3, z: 2, colour: LAMP_COLOURS.white, power: 20 }))
    setSelected({ what: 'lamp', index: scene.lamps.length })
  }
  const remove = () => {
    if (!selected) return
    change((s) => {
      if (selected.what === 'thing') s.things.splice(selected.index, 1)
      else s.lamps.splice(selected.index, 1)
    })
    setSelected(null)
  }
  const focusOn = () => {
    if (!thing) return
    change((s) => {
      const v = view(s.camera)
      const h = thing.kind === 'actor' ? 1.4 * thing.size : thing.size
      s.camera.focus = Math.hypot(thing.x - v.eye[0], h - v.eye[1], thing.z - v.eye[2])
    })
  }

  const rayFrom = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const u = ((e.clientX - r.left) / r.width) * 2 - 1
    const v = 1 - ((e.clientY - r.top) / r.height) * 2
    return rayAt(sceneRef.current.camera, u, v, r.width / r.height)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === 'delete' || k === 'backspace') remove()
    else if (k === 'arrowleft' || k === 'arrowright')
      change((s) => (s.camera.yaw += k === 'arrowleft' ? -0.15 : 0.15))
    else if (k === 'arrowup' || k === 'arrowdown')
      change(
        (s) =>
          (s.camera.pitch = Math.max(
            -0.1,
            Math.min(1.3, s.camera.pitch + (k === 'arrowup' ? 0.08 : -0.08)),
          )),
      )
    else if (k === '-' || k === '=' || k === '+')
      change(
        (s) =>
          (s.camera.distance = Math.max(
            2,
            Math.min(16, s.camera.distance + (k === '-' ? 0.5 : -0.5)),
          )),
      )
    else if (k === 's') setTarget(SHOT)
    else if (k === 'escape') setSelected(null)
    else return
    e.preventDefault()
  }

  const importScene = async (file: File) => {
    if (file.size > 200_000) return setNote('That file is too big to be a studio scene.')
    const s = readScene(await file.text())
    if (!s) return setNote('That file is not a studio scene.')
    setSelected(null)
    setScene(s)
    setTarget(PREVIEW)
    setNote(`Opened ${file.name}.`)
  }

  const cam = scene.camera
  const done = samples >= target
  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Film studio">
      <LabStage
        label="A small film set: posed figures, props and lamps on a studio floor, path traced"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.25}
        make={async ({ device, context, format, canvas }) => {
          const v = await createStudio(device, context, format, canvas)
          engine.current = v
          v.scene(sceneRef.current)
          let shown = -1
          return {
            frame: (dt: number) => {
              const more = dt > 0 && v.samples < now.current.target
              v.frame(more ? PER_FRAME : 0)
              if (v.samples !== shown) {
                shown = v.samples
                setSamples(shown)
              }
            },
            resize: () => {
              v.resize()
              v.scene(sceneRef.current)
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const ray = rayFrom(e)
          const hit = pick(sceneRef.current, ray.o, ray.d)
          const base = { x: e.clientX, y: e.clientY, moved: 0, dx: 0, dz: 0, h: 0 }
          if (hit.what === 'thing') {
            setSelected({ what: 'thing', index: hit.index })
            const t = sceneRef.current.things[hit.index]
            /* ⚠️ HELD WHERE IT WAS GRABBED, NOT BY THE FLOOR BEHIND IT. A finger on an actor's chest
               points at floor metres behind the actor, and following that point flung it across the
               set — measured, 1.9 m for a finger move worth 1. The drag runs on the level plane at
               the height the finger met the thing. */
            const h = ray.o[1] + ray.d[1] * hit.t
            const f = onPlane(ray.o, ray.d, h) ?? [t.x, t.z]
            drag.current = {
              kind: 'thing',
              index: hit.index,
              ...base,
              dx: t.x - f[0],
              dz: t.z - f[1],
              h,
            }
          } else if (hit.what === 'lamp') {
            setSelected({ what: 'lamp', index: hit.index })
            drag.current = { kind: 'lamp', index: hit.index, ...base }
          } else drag.current = { kind: 'orbit', index: -1, ...base }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const mx = e.clientX - d.x
          const my = e.clientY - d.y
          d.moved += Math.hypot(mx, my)
          d.x = e.clientX
          d.y = e.clientY
          if (d.moved < 4) return
          if (d.kind === 'orbit')
            change((s) => {
              s.camera.yaw -= mx * 0.008
              s.camera.pitch = Math.max(-0.1, Math.min(1.3, s.camera.pitch + my * 0.006))
            })
          else if (d.kind === 'thing') {
            const ray = rayFrom(e)
            const f = onPlane(ray.o, ray.d, d.h)
            if (f)
              change((s) => {
                const t = s.things[d.index]
                if (!t) return
                t.x = Math.max(-8, Math.min(8, f[0] + d.dx))
                t.z = Math.max(-5.5, Math.min(8, f[1] + d.dz))
              })
          } else {
            // a lamp moves across at its own height
            const ray = rayFrom(e)
            change((s) => {
              const l = s.lamps[d.index]
              if (!l || Math.abs(ray.d[1]) < 1e-3) return
              const t = (l.y - ray.o[1]) / ray.d[1]
              if (t <= 0) return
              l.x = Math.max(-10, Math.min(10, ray.o[0] + ray.d[0] * t))
              l.z = Math.max(-5.5, Math.min(10, ray.o[2] + ray.d[2] * t))
            })
          }
        }}
        onPointerUp={() => {
          const d = drag.current
          // a tap on the empty set lets go of whatever was chosen
          if (d && d.kind === 'orbit' && d.moved < 4) setSelected(null)
          drag.current = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <button
            className="btn"
            onClick={() => {
              setTarget(SHOT)
              if (!running) setRunning(true)
            }}
          >
            🎬 Shoot
          </button>
          <span className="lab-score" aria-live="polite">
            {done && target === SHOT ? '✓ ' : ''}
            {Math.min(samples, target)}/{target} samples
          </span>
          <button
            className="btn btn-ghost"
            onClick={async () => {
              const blob = await engine.current?.shoot()
              if (blob) download(blob, 'studio-shot.png')
              else setNote('The picture could not be read back from the GPU.')
            }}
          >
            ⬇ Save picture
          </button>
          <div className="lab-group" role="group" aria-label="Add">
            <button className="btn btn-ghost" onClick={() => addThing('actor')}>
              🧍 Actor
            </button>
            <button className="btn btn-ghost" onClick={() => addThing('box')}>
              ⬛ Box
            </button>
            <button className="btn btn-ghost" onClick={() => addThing('ball')}>
              ⚪ Ball
            </button>
            <button className="btn btn-ghost" onClick={addLamp}>
              💡 Lamp
            </button>
          </div>
        </div>
      )}

      {live && thing && (
        <div className="lab-controls" role="group" aria-label="The chosen thing">
          <strong className="studio-what">
            {thing.kind === 'actor' ? '🧍 Actor' : thing.kind === 'box' ? '⬛ Box' : '⚪ Ball'}
          </strong>
          {thing.kind === 'actor' && (
            <label className="studio-pick">
              <span className="muted">Pose</span>
              <select
                value={thing.pose}
                onChange={(e) => editThing((t) => (t.pose = e.target.value as Pose))}
              >
                {POSES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="studio-pick">
            <span className="muted">Finish</span>
            <select
              value={thing.material}
              onChange={(e) => editThing((t) => (t.material = e.target.value as Material))}
            >
              {MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <div className="lab-group" role="group" aria-label="Colour">
            {Object.entries(SWATCHES).map(([name, c]) => (
              <button
                key={name}
                className="btn btn-ghost studio-swatch"
                aria-label={name}
                aria-pressed={thing.colour.join() === c.join()}
                style={{ background: `rgb(${c.map((x) => Math.round(x * 255)).join(' ')})` }}
                onClick={() => editThing((t) => (t.colour = c))}
              />
            ))}
          </div>
          <label className="appearance-slider lab-flow">
            <span className="muted">Turn</span>
            <input
              type="range"
              min={-3.14}
              max={3.14}
              step={0.05}
              value={thing.turn}
              onChange={(e) => editThing((t) => (t.turn = Number(e.target.value)))}
            />
          </label>
          <label className="appearance-slider lab-flow">
            <span className="muted">Size</span>
            <input
              type="range"
              min={0.2}
              max={2}
              step={0.05}
              value={thing.size}
              onChange={(e) => editThing((t) => (t.size = Number(e.target.value)))}
            />
          </label>
          <button className="btn btn-ghost" onClick={focusOn}>
            🎯 Focus on it
          </button>
          <button className="btn btn-ghost" onClick={remove}>
            🗑 Remove
          </button>
        </div>
      )}

      {live && lamp && (
        <div className="lab-controls" role="group" aria-label="The chosen lamp">
          <strong className="studio-what">💡 Lamp</strong>
          <div className="lab-group" role="group" aria-label="Lamp colour">
            {Object.entries(LAMP_COLOURS).map(([name, c]) => (
              <button
                key={name}
                className="btn btn-ghost"
                aria-pressed={lamp.colour.join() === c.join()}
                onClick={() => editLamp((l) => (l.colour = c))}
              >
                {name}
              </button>
            ))}
          </div>
          <label className="appearance-slider lab-flow">
            <span className="muted">Power</span>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={lamp.power}
              onChange={(e) => editLamp((l) => (l.power = Number(e.target.value)))}
            />
          </label>
          <label className="appearance-slider lab-flow">
            <span className="muted">Height</span>
            <input
              type="range"
              min={0.5}
              max={8}
              step={0.1}
              value={lamp.y}
              onChange={(e) => editLamp((l) => (l.y = Number(e.target.value)))}
            />
          </label>
          <button className="btn btn-ghost" onClick={remove}>
            🗑 Remove
          </button>
        </div>
      )}

      {live && (
        <div className="lab-controls" role="group" aria-label="Camera">
          <label className="appearance-slider lab-flow">
            <span className="muted">Lens</span>
            <input
              type="range"
              min={18}
              max={135}
              step={1}
              value={cam.lens}
              onChange={(e) => change((s) => (s.camera.lens = Number(e.target.value)))}
            />
            <span className="appearance-slider-val">{cam.lens}mm</span>
          </label>
          <label className="appearance-slider lab-flow">
            <span className="muted">Aperture</span>
            <input
              type="range"
              min={1.4}
              max={16}
              step={0.1}
              value={cam.fstop}
              onChange={(e) => change((s) => (s.camera.fstop = Number(e.target.value)))}
            />
            <span className="appearance-slider-val">f/{cam.fstop.toFixed(1)}</span>
          </label>
          <label className="appearance-slider lab-flow">
            <span className="muted">Distance</span>
            <input
              type="range"
              min={2}
              max={16}
              step={0.1}
              value={cam.distance}
              onChange={(e) => change((s) => (s.camera.distance = Number(e.target.value)))}
            />
          </label>
        </div>
      )}

      {live && (
        <div className="lab-controls" role="group" aria-label="Scene">
          <button
            className="btn btn-ghost"
            onClick={() =>
              download(
                new Blob([JSON.stringify(scene, null, 1)], { type: 'application/json' }),
                'studio-scene.json',
              )
            }
          >
            ⬇ Save scene file
          </button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            ⬆ Open scene file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importScene(f)
            }}
          />
          <button
            className="btn btn-ghost"
            onClick={() => {
              setSelected(null)
              setScene(clone(DEFAULT_SCENE))
              setTarget(PREVIEW)
            }}
          >
            ↺ Start over
          </button>
        </div>
      )}

      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <>{note} </>}
          Tap an actor, a prop or a lamp to choose it, and drag it about the floor (a lamp moves at
          its own height); drag the empty set to walk the camera round it. Pose actors, colour and
          finish things, light the scene, choose a lens and an aperture — a wide aperture blurs what
          is not in focus, so 🎯 Focus on what matters. 🎬 Shoot path traces the frame until it is
          clean, then ⬇ Save picture keeps it as a PNG. The scene is kept in this browser as you
          go, and a scene file can be saved and opened again — it is only ever read as numbers and
          names, never run.
          {!touchOnly() &&
            ' Keys, once it has focus: ← → ↑ ↓ walk the camera, S shoots, Delete removes the chosen thing, Esc lets it go, − and + move the camera out and in.'}
        </p>
      )}
    </div>
  )
}
