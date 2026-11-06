import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { Holds, keySource } from './holds'
import { LabStage } from './LabStage'
import {
  BEST_KEY,
  QUARRY,
  clock,
  readBest,
  retry,
  sprayFor,
  startRun,
  tick,
  type Input,
  type Run,
} from './trials'
import { createTrials, type TrialsView } from './trialsEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Hold = 'gas' | 'brake' | 'back' | 'fwd'
const KEYS: Record<string, Hold> = {
  arrowup: 'gas',
  w: 'gas',
  arrowdown: 'brake',
  s: 'brake',
  arrowleft: 'back',
  a: 'back',
  arrowright: 'fwd',
  d: 'fwd',
}
/** how much of the course fits the screen's height, in metres */
const VIEW = 8.5
/** …and across */
const WIDE = 11
const COURSE = QUARRY

const loadBest = () => {
  try {
    return readBest(localStorage.getItem(BEST_KEY))
  } catch {
    return null
  }
}

/** a little seeded generator for the mud's looks, so nothing about it is ever Math.random */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
}

/**
 * A trials bike on a dirt course: throttle, brake and lean to get over the bumps, the block, the
 * gap, the hill, the stairs and the pit to the flag — as fast as you can, and again when you crash.
 */
export function TrialsDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [status, setStatus] = useState<{
    time: number
    checkpoint: number
    crashed: boolean
    finished: boolean
  }>({
    time: 0,
    checkpoint: -1,
    crashed: false,
    finished: false,
  })
  const [best, setBest] = useState(loadBest)
  const [record, setRecord] = useState(false)

  const engine = useRef<TrialsView | null>(null)
  const run = useRef<Run>(startRun(COURSE))
  /** who is holding each control: two keys bound to one, a pad, each its own holder (holds.ts) —
   *  letting go of ← used to cut the throttle that the Gas pad was still holding open */
  const held = useRef(new Holds<Hold>()).current
  const cam = useRef<[number, number]>([COURSE.start[0] + 3, COURSE.start[1] + 1])
  const now = useRef({ running })
  now.current = { running }
  const redraw = useRef<() => void>(() => {})

  const input = (): Input => {
    const h = held
    return {
      gas: h.has('gas'),
      brake: h.has('brake'),
      lean: (h.has('back') ? 1 : 0) - (h.has('fwd') ? 1 : 0),
    }
  }

  const again = () => {
    run.current = retry(run.current, COURSE)
    if (!now.current.running) setRunning(true)
    redraw.current()
  }
  const restart = () => {
    run.current = startRun(COURSE)
    setRecord(false)
    if (!now.current.running) setRunning(true)
    redraw.current()
  }

  /* a finished run that beats the best is kept, in frames */
  useEffect(() => {
    if (!status.finished) return
    const frames = run.current.frames
    if (best === null || frames < best) {
      setBest(frames)
      setRecord(true)
      try {
        localStorage.setItem(BEST_KEY, String(frames))
      } catch {
        /* private mode: it is the best for this visit */
      }
    }
    // only when a run finishes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.finished])

  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const k = e.key.toLowerCase()
    if (k in KEYS) {
      if (down) {
        held.press(KEYS[k], keySource(e))
        if (!now.current.running) setRunning(true)
      } else held.releaseSource(keySource(e))
    } else if (!down) return
    else if (k === 'r' || k === 'enter') again()
    else if (k === 'n' || k === 'backspace') restart()
    else if (k === 'p' || k === ' ') setRunning((r) => !r)
    else return
    e.preventDefault()
  }

  /* a hold button: pressed from the moment a finger lands on it until that finger lifts */
  const pad = (what: Hold) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      /* captured, so a thumb that drifts off Gas mid-jump keeps the throttle open; the press is
         the point and capture a nicety, so a refusal must not stop it */
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* a pointer the browser no longer tracks */
      }
      held.press(what, `pad:${e.pointerId}`)
      if (!now.current.running) setRunning(true)
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => held.releaseSource(`pad:${e.pointerId}`),
    onPointerCancel: (e: PointerEvent<HTMLButtonElement>) =>
      held.releaseSource(`pad:${e.pointerId}`),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  })

  const r = run.current
  const flags = COURSE.checkpoints.length
  return (
    <div
      className="lab-keys"
      tabIndex={0}
      onKeyDown={(e) => onKey(e, true)}
      onKeyUp={(e) => onKey(e, false)}
      onBlur={(e) => {
        /* only when focus leaves the toy: a press on a pad button can move focus from this box
           to the button inside it, and letting go of the keys then would be wrong. (Chromium did
           not move it in the probe; other browsers may, and the check costs nothing.) */
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) held.clear()
      }}
      aria-label="Bike trials"
    >
      <div className="trials-wrap">
        <LabStage
          label="A trials motorbike and rider on a dirt course of bumps, a block, a gap, a hill, stairs and a pit"
          running={running}
          onAdapter={onAdapter}
          onLive={setLive}
          maxDpr={1.5}
          make={async ({ device, context, format, canvas }) => {
            const v = await createTrials(device, context, format, canvas)
            engine.current = v
            v.course(COURSE)
            const rand = lcg(7)
            let acc = 0
            let t = 0
            let shown = ''
            const draw = (dt: number) => {
              let steps = 0
              acc = Math.min(acc + dt, 0.25)
              while (acc >= 1 / 60) {
                acc -= 1 / 60
                const at = run.current
                tick(at, COURSE, input())
                const mud = sprayFor(at.bike, COURSE, rand)
                if (mud.length) v.spray(mud)
                steps++
              }
              t += dt
              const b = run.current.bike
              /* the camera leads the bike the way it is going, and follows smoothly */
              const want: [number, number] = [
                b.x + Math.max(-3, Math.min(4, b.vx * 0.35)),
                b.y + 0.9,
              ]
              const k = 1 - Math.exp(-6 * Math.max(dt, 0))
              cam.current = [
                cam.current[0] + (want[0] - cam.current[0]) * k,
                cam.current[1] + (want[1] - cam.current[1]) * k,
              ]
              if (dt === 0) cam.current = want
              v.frame(
                {
                  cam: cam.current,
                  /* at least VIEW metres tall and WIDE metres across: a phone held upright would
                     otherwise show five metres of course, and the next obstacle off its edge */
                  scale: Math.min(canvas.height / VIEW, canvas.width / WIDE),
                  time: t,
                  bike: b,
                  lean: input().lean,
                  course: COURSE,
                  passed: run.current.checkpoint,
                },
                steps,
              )
              /* the words under it change a few times a second at most, not every frame */
              const s = {
                time: Math.floor(run.current.frames / 6) * 6,
                checkpoint: run.current.checkpoint,
                crashed: b.crashed,
                finished: run.current.finished,
              }
              const key = JSON.stringify(s)
              if (key !== shown) {
                shown = key
                setStatus(s)
              }
            }
            redraw.current = () => {
              if (!now.current.running) draw(0)
            }
            return {
              frame: draw,
              destroy: () => {
                v.destroy()
                engine.current = null
                redraw.current = () => {}
              },
            }
          }}
        />
        {live && (
          <div className="trials-hud" aria-hidden>
            <span>{clock(status.time)}</span>
            <span>
              ⚑ {status.checkpoint + 1}/{flags}
            </span>
            {best !== null && <span>best {clock(best)}</span>}
          </div>
        )}
      </div>

      {live && (
        <div className="trials-pad" role="group" aria-label="Ride">
          <button className="btn btn-ghost" {...pad('back')}>
            ⟲ Lean back
          </button>
          <button className="btn btn-ghost" {...pad('fwd')}>
            Lean forward ⟳
          </button>
          <button className="btn btn-ghost" {...pad('brake')}>
            Brake
          </button>
          <button className="btn trials-gas" {...pad('gas')}>
            Gas
          </button>
        </div>
      )}

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((x) => !x)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Ride'}
          </button>
          <button className="btn btn-ghost" onClick={again}>
            ↺ Back to the flag
          </button>
          <button className="btn btn-ghost" onClick={restart}>
            ⏮ Start again
          </button>
        </div>
      )}

      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {status.finished
            ? `Finished in ${clock(r.frames)}${record ? ' — a new best!' : best !== null ? `; your best is ${clock(best)}` : ''}. Start again to beat it.`
            : status.crashed
              ? 'Crashed! ↺ Back to the flag puts you on the bike at the last flag you passed — the clock keeps going.'
              : `Get to the chequered flag as fast as you can. Gas and brake drive the back wheel; lean back to lift the front over a block or land a jump, lean forward to keep the nose down on a climb. Hit your head and it is a crash. Each orange flag you pass turns green and is where you start again.`}
          {!touchOnly() &&
            ' Keys, once it has focus: ↑/W gas, ↓/S brake, ←/A lean back, →/D lean forward, R back to the flag, N start again, P pause.'}{' '}
          The ground is drawn from a distance field the GPU bakes from the course once, and the mud
          the tyres throw bounces off that same field.
        </p>
      )}
    </div>
  )
}
