import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { hashParam, here } from '../lab/links'
import { CanvasStage } from './CanvasStage'
import {
  BALL,
  COURSE,
  CUP,
  H,
  LEVELS,
  MAX_HOLES,
  PICK_UP,
  PUTT_KEY,
  THEMES,
  W,
  pack,
  playHole,
  readHole,
  readSaved,
  roll,
  writeHole,
  type Hole,
  type Level,
  type Pt,
  type Saved,
} from './putt'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
type Theme = Saved['theme']
const LOOK: Record<
  Theme,
  {
    name: string
    grass: [string, string]
    wall: string
    edge: string
    sand: string
    water: string
    you: string
    cpu: string
    flag: string
  }
> = {
  links: {
    name: 'Links',
    grass: ['#5fb04a', '#57a643'],
    wall: '#7a4a24',
    edge: '#4a2a12',
    sand: '#e8d29a',
    water: '#3d8fd1',
    you: '#ffffff',
    cpu: '#ffcf33',
    flag: '#e5484d',
  },
  night: {
    name: 'Night',
    grass: ['#1d3b4f', '#1a3546'],
    wall: '#0b1622',
    edge: '#33e1ff',
    sand: '#5d5a7a',
    water: '#6b3bd6',
    you: '#f6ff7a',
    cpu: '#ff6ad5',
    flag: '#33e1ff',
  },
  candy: {
    name: 'Candy',
    grass: ['#9fe3c6', '#93dbbd'],
    wall: '#f28bb5',
    edge: '#c2457a',
    sand: '#fff1b3',
    water: '#8cc7ff',
    you: '#ffffff',
    cpu: '#7b4fd6',
    flag: '#ff5a8a',
  },
}
type Tool = 'g' | 'x' | 's' | 'w' | 't' | 'o'
const TOOLS: { t: Tool; name: string; key: string }[] = [
  { t: 'g', name: 'Grass', key: '1' },
  { t: 'x', name: 'Wall', key: '2' },
  { t: 's', name: 'Sand', key: '3' },
  { t: 'w', name: 'Water', key: '4' },
  { t: 't', name: 'Tee', key: '5' },
  { t: 'o', name: 'Cup', key: '6' },
]
/** an open box of grass with the tee near the bottom and the cup near the top */
const BLANK = Array.from({ length: W * H }, (_, i) => {
  const x = i % W
  const y = Math.floor(i / W)
  if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return 'x'
  if (x === 5 && y === 12) return 't'
  if (x === 4 && y === 2) return 'o'
  return 'g'
}).join('')

type Course = { kind: 'course' | 'mine' | 'sent' | 'try'; holes: Hole[] }
type Card = { you: number | null; cpu: number | null }[]
type Phase = 'aim' | 'rolling' | 'cpu' | 'between' | 'done'
type Show = { frames: number[]; t: number; who: 0 | 1; after: () => void }

type View = { s: number; ox: number; oy: number }
const fitView = (w: number, h: number): View => {
  const s = Math.min(w / W, h / H)
  return { s, ox: (w - W * s) / 2, oy: (h - H * s) / 2 }
}

/** the first stretch of a putt, up to where it first turns — a bounce: what the guide shows */
function firstLeg(h: Hole, from: Pt, angle: number, power: number): Pt[] {
  const f = roll(h, from, angle, power, true).frames
  const out: Pt[] = [{ x: f[0], y: f[1] }]
  for (let i = 2; i + 1 < f.length; i += 2) {
    const q = out[out.length - 1]
    const dx = f[i] - q.x
    const dy = f[i + 1] - q.y
    if (Math.hypot(dx, dy) > 1e-6) {
      const d = Math.atan2(dy, dx) - angle
      if (Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) > 0.3) break
    }
    out.push({ x: f[i], y: f[i + 1] })
  }
  return out
}

export function PuttDemo() {
  const [saved, setSaved] = useKept(PUTT_KEY, readSaved)
  const sentHole = useMemo(() => {
    const t = hashParam('hole')
    return t ? readHole(t, 'A sent hole') : null
  }, [])
  const [mode, setMode] = useState<'play' | 'build'>('play')
  const [course, setCourse] = useState<Course>(() =>
    sentHole ? { kind: 'sent', holes: [sentHole] } : { kind: 'course', holes: COURSE },
  )
  const [level, setLevel] = useState<Level>(saved.level)
  const [idx, setIdx] = useState(0)
  const [ball, setBall] = useState<Pt>(() => ({ ...course.holes[0].tee }))
  const [cpuBall, setCpuBall] = useState<Pt | null>(null)
  const [strokes, setStrokes] = useState(0)
  const [card, setCard] = useState<Card>(() => course.holes.map(() => ({ you: null, cpu: null })))
  const [phase, setPhase] = useState<Phase>('aim')
  const [line, setLine] = useState(
    sentHole
      ? 'Somebody sent you a hole. Drag back from anywhere and let go to putt.'
      : 'Hole 1. Drag back from anywhere on the green — like a slingshot — and let go.',
  )
  // the builder
  const [draft, setDraft] = useState(BLANK)
  const [tool, setTool] = useState<Tool>('x')
  const [editing, setEditing] = useState<number | null>(null)
  const [cursor, setCursor] = useState(5 * W + 5)
  const [removing, setRemoving] = useState<number | null>(null)

  const refs = useRef({ saved, course, idx, ball, cpuBall, phase, mode, draft, cursor })
  refs.current = { saved, course, idx, ball, cpuBall, phase, mode, draft, cursor }
  const aim = useRef({ angle: -Math.PI / 2, power: 0, dragging: false, from: { x: 0, y: 0 } })
  const show = useRef<Show | null>(null)
  const view = useRef<View | null>(null)
  const painting = useRef(false)
  const timers = useRef<number[]>([])
  const [, redraw] = useState(0)
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  const hole = course.holes[idx]
  const total = (k: 'you' | 'cpu') => card.reduce((s, c) => s + (c[k] ?? 0), 0)

  const start = (c: Course, lv: Level = saved.level) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    show.current = null
    setCourse(c)
    setLevel(lv)
    setIdx(0)
    setBall({ ...c.holes[0].tee })
    setCpuBall(null)
    setStrokes(0)
    setCard(c.holes.map(() => ({ you: null, cpu: null })))
    setPhase('aim')
    aim.current.power = 0
    setLine(
      c.kind === 'try'
        ? 'Trying your hole. Putt it out, then the computer has a go.'
        : `Hole 1 of ${c.holes.length}: ${c.holes[0].name}. Drag back and let go to putt.`,
    )
  }

  /** run a putt's frames on the canvas, or jump to its end under reduced motion */
  const animate = (frames: number[], who: 0 | 1, after: () => void) => {
    if (reduced()) {
      show.current = { frames: frames.slice(-2), t: 0, who, after: () => {} }
      later(220, () => {
        show.current = null
        after()
      })
    } else
      show.current = {
        frames,
        t: 0,
        who,
        after: () => {
          show.current = null
          after()
        },
      }
  }

  const finishRound = (final: Card) => {
    const you = final.reduce((s, c) => s + (c.you ?? 0), 0)
    const cpu = final.reduce((s, c) => s + (c.cpu ?? 0), 0)
    setPhase('done')
    if (course.kind === 'try') {
      setLine(`You took ${final[0].you}, the computer ${final[0].cpu} on ${LEVEL_NAMES[level]}.`)
      return
    }
    const r = you < cpu ? 'won' : you > cpu ? 'lost' : 'tied'
    const full = course.kind === 'course'
    const prev = saved.record[level].best
    const best = full && (!prev || you < prev)
    setSaved((s) => {
      const t = s.record[level]
      return {
        ...s,
        record: {
          ...s.record,
          [level]: { ...t, [r]: t[r] + 1, best: best ? you : t.best },
        },
      }
    })
    setLine(
      `${r === 'won' ? '🏆 You win' : r === 'lost' ? 'The computer wins' : 'A tie'}, ${you} to ${cpu}.${best ? ' Your best round on ' + LEVEL_NAMES[level] + '.' : ''}`,
    )
  }

  const computerPlays = (c: Card) => {
    setPhase('cpu')
    const res = playHole(hole, level)
    let k = 0
    const next = () => {
      if (k >= res.putts.length) {
        const done = c.map((x, i) => (i === idx ? { ...x, cpu: res.strokes } : x))
        setCard(done)
        setCpuBall(null)
        if (idx === course.holes.length - 1) finishRound(done)
        else {
          setPhase('between')
          setLine(
            `The computer takes ${res.strokes}${res.strokes === 1 ? ' — a hole in one' : ''}. ${
              (done[idx].you ?? 0) < res.strokes
                ? 'You win the hole.'
                : (done[idx].you ?? 0) > res.strokes
                  ? 'It wins the hole.'
                  : 'Halved.'
            }`,
          )
        }
        return
      }
      const p = res.putts[k++]
      setCpuBall(p.from)
      later(reduced() ? 120 : 380, () =>
        animate(p.roll.frames.length ? p.roll.frames : [p.from.x, p.from.y], 1, () => {
          setCpuBall(p.roll.sunk ? null : p.roll.end)
          later(reduced() ? 60 : 250, next)
        }),
      )
    }
    // replay each of the computer's putts with its path, for the page to show
    res.putts.forEach((p) => {
      p.roll = roll(hole, p.from, p.angle, p.power, true)
    })
    setLine(`The computer plays hole ${idx + 1}…`)
    later(500, next)
  }

  const putt = (angle: number, power: number) => {
    const from = refs.current.ball
    const r = roll(hole, from, angle, power, true)
    setPhase('rolling')
    aim.current.power = 0
    animate(r.frames, 0, () => {
      const n = strokes + (r.wet ? 2 : 1)
      setStrokes(n)
      if (r.sunk || n >= PICK_UP) {
        const c = card.map((x, i) => (i === idx ? { ...x, you: Math.min(n, PICK_UP) } : x))
        setCard(c)
        setBall({ ...hole.cup })
        setLine(
          r.sunk
            ? n === 1
              ? '⛳ A hole in one!'
              : `In, in ${n}.`
            : `That is ${PICK_UP}: picked up.`,
        )
        later(700, () => computerPlays(c))
        return
      }
      setBall(r.end)
      setPhase('aim')
      setLine(
        r.wet
          ? `Splash — a stroke added, and back to where you played from. ${n} so far.`
          : `${n} stroke${n === 1 ? '' : 's'}. Again.`,
      )
    })
  }

  const nextHole = () => {
    const i = idx + 1
    setIdx(i)
    setBall({ ...course.holes[i].tee })
    setStrokes(0)
    setPhase('aim')
    aim.current.power = 0
    setLine(`Hole ${i + 1} of ${course.holes.length}: ${course.holes[i].name}.`)
  }

  /* -------------------------------------------------------------------- pointer and keys */

  const toHole = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    const v = view.current
    if (!v) return null
    const r = c.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * c.width
    const py = ((e.clientY - r.top) / r.height) * c.height
    return { x: (px - v.ox) / v.s, y: (py - v.oy) / v.s }
  }
  const paintAt = (i: number) => {
    const d = refs.current.draft
    if (i < 0 || i >= W * H) return
    if ((d[i] === 't' || d[i] === 'o') && tool !== d[i]) return
    let next = d
    if (tool === 't' || tool === 'o') next = next.replace(tool, 'g')
    next = next.slice(0, i) + tool + next.slice(i + 1)
    if (next !== d) setDraft(next)
  }
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = toHole(e)
    if (!p) return
    if (refs.current.mode === 'build') {
      painting.current = true
      const i = Math.floor(p.y) * W + Math.floor(p.x)
      if (p.x >= 0 && p.y >= 0 && p.x < W && p.y < H) {
        setCursor(i)
        paintAt(i)
      }
      return
    }
    if (refs.current.phase !== 'aim') return
    aim.current = { ...aim.current, dragging: true, from: p, power: 0 }
  }
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = toHole(e)
    if (!p) return
    if (refs.current.mode === 'build') {
      if (painting.current && p.x >= 0 && p.y >= 0 && p.x < W && p.y < H)
        paintAt(Math.floor(p.y) * W + Math.floor(p.x))
      return
    }
    if (!aim.current.dragging) return
    const dx = aim.current.from.x - p.x
    const dy = aim.current.from.y - p.y
    const d = Math.hypot(dx, dy)
    if (d > 0.05) aim.current.angle = Math.atan2(dy, dx)
    aim.current.power = Math.min(1, d / 6)
  }
  const onUp = () => {
    painting.current = false
    if (!aim.current.dragging) return
    aim.current.dragging = false
    if (aim.current.power > 0.02 && refs.current.phase === 'aim')
      putt(aim.current.angle, aim.current.power)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
    if (mode === 'build') {
      const t = TOOLS.find((x) => x.key === e.key)
      if (t) setTool(t.t)
      else if (arrows.includes(e.key)) {
        const x = cursor % W
        const y = Math.floor(cursor / W)
        const nx = Math.max(
          0,
          Math.min(W - 1, x + (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0)),
        )
        const ny = Math.max(
          0,
          Math.min(H - 1, y + (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0)),
        )
        setCursor(ny * W + nx)
      } else if (e.key === 'Enter' || e.key === ' ') paintAt(cursor)
      else return
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (phase !== 'aim') return
    const fine = e.shiftKey ? 0.2 : 1
    if (arrows.includes(e.key)) {
      if (e.key === 'ArrowLeft') aim.current.angle -= 0.04 * fine
      if (e.key === 'ArrowRight') aim.current.angle += 0.04 * fine
      if (e.key === 'ArrowUp') aim.current.power = Math.min(1, aim.current.power + 0.04 * fine)
      if (e.key === 'ArrowDown') aim.current.power = Math.max(0, aim.current.power - 0.04 * fine)
      redraw((n) => n + 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (aim.current.power > 0.02) putt(aim.current.angle, aim.current.power)
      else setLine('Set some strength first: the up arrow.')
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  /* -------------------------------------------------------------------- the builder */

  const draftHole = readHole(draft, 'Your hole')
  const keep = () => {
    if (!draftHole) return
    setSaved((s) => {
      const holes = [...s.holes]
      if (editing !== null && editing < holes.length) holes[editing] = draft
      else holes.push(draft)
      return { ...s, holes: holes.slice(0, MAX_HOLES) }
    })
    if (editing === null) setEditing(Math.min(saved.holes.length, MAX_HOLES - 1))
  }
  const full = editing === null && saved.holes.length >= MAX_HOLES
  const mine = saved.holes
    .map((h, i) => readHole(h, `Your hole ${i + 1}`))
    .filter((h): h is Hole => h !== null)

  /* -------------------------------------------------------------------- drawing */

  const tileCache = useRef<{ key: string; img: HTMLCanvasElement } | null>(null)
  const paintTiles = (ctx: CanvasRenderingContext2D, flat: string, theme: Theme, v: View) => {
    const key = `${flat}|${theme}|${v.s}`
    if (tileCache.current?.key !== key) {
      const img = document.createElement('canvas')
      img.width = Math.ceil(W * v.s)
      img.height = Math.ceil(H * v.s)
      const g = img.getContext('2d')!
      const L = LOOK[theme]
      for (let i = 0; i < W * H; i++) {
        const x = (i % W) * v.s
        const y = Math.floor(i / W) * v.s
        const c = flat[i]
        const t = c === 't' || c === 'o' ? 'g' : c
        g.fillStyle =
          t === 'g'
            ? L.grass[((i % W) + Math.floor(i / W)) % 2]
            : t === 's'
              ? L.sand
              : t === 'w'
                ? L.water
                : L.wall
        // whole pixels at both edges, so neighbouring tiles of one colour show no seam
        const x1 = Math.round(x + v.s)
        const y1 = Math.round(y + v.s)
        g.fillRect(Math.round(x), Math.round(y), x1 - Math.round(x), y1 - Math.round(y))
        if (t === 's') {
          g.fillStyle = 'rgba(0,0,0,0.12)'
          for (let k = 0; k < 5; k++)
            g.fillRect(
              x + ((k * 37) % 10) * v.s * 0.09 + v.s * 0.1,
              y + ((k * 53) % 10) * v.s * 0.09 + v.s * 0.1,
              2,
              2,
            )
        }
        if (t === 'w') {
          g.strokeStyle = 'rgba(255,255,255,0.35)'
          g.lineWidth = Math.max(1, v.s * 0.04)
          g.beginPath()
          g.moveTo(x + v.s * 0.2, y + v.s * 0.55)
          g.quadraticCurveTo(x + v.s * 0.35, y + v.s * 0.4, x + v.s * 0.5, y + v.s * 0.55)
          g.quadraticCurveTo(x + v.s * 0.65, y + v.s * 0.7, x + v.s * 0.8, y + v.s * 0.55)
          g.stroke()
        }
        if (t === 'x') {
          // a wall's face where it meets something you can roll on
          g.fillStyle = L.edge
          const open = (dx: number, dy: number) => {
            const nx = (i % W) + dx
            const ny = Math.floor(i / W) + dy
            return nx >= 0 && ny >= 0 && nx < W && ny < H && flat[ny * W + nx] !== 'x'
          }
          const e = Math.max(2, v.s * 0.1)
          if (open(0, 1)) g.fillRect(x, y + v.s - e, v.s, e)
          if (open(0, -1)) g.fillRect(x, y, v.s, e)
          if (open(1, 0)) g.fillRect(x + v.s - e, y, e, v.s)
          if (open(-1, 0)) g.fillRect(x, y, e, v.s)
        }
      }
      tileCache.current = { key, img }
    }
    ctx.drawImage(tileCache.current.img, v.ox, v.oy)
  }
  const drawBall = (ctx: CanvasRenderingContext2D, v: View, p: Pt, colour: string) => {
    const x = v.ox + p.x * v.s
    const y = v.oy + p.y * v.s
    const r = BALL * v.s
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.beginPath()
    ctx.arc(x + r * 0.25, y + r * 0.35, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = colour
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
  const drawCupAndTee = (
    ctx: CanvasRenderingContext2D,
    v: View,
    cup: Pt,
    tee: Pt,
    theme: Theme,
  ) => {
    const L = LOOK[theme]
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    ctx.fillRect(v.ox + (tee.x - 0.4) * v.s, v.oy + (tee.y - 0.4) * v.s, 0.8 * v.s, 0.8 * v.s)
    const cx = v.ox + cup.x * v.s
    const cy = v.oy + cup.y * v.s
    ctx.fillStyle = '#0b0b0b'
    ctx.beginPath()
    ctx.arc(cx, cy, CUP * v.s, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#ddd'
    ctx.lineWidth = Math.max(1.5, v.s * 0.04)
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx, cy - v.s * 0.9)
    ctx.stroke()
    ctx.fillStyle = L.flag
    ctx.beginPath()
    ctx.moveTo(cx, cy - v.s * 0.9)
    ctx.lineTo(cx + v.s * 0.5, cy - v.s * 0.75)
    ctx.lineTo(cx, cy - v.s * 0.6)
    ctx.fill()
  }

  const r = saved.record[saved.level]
  const canPutt = mode === 'play' && phase === 'aim'

  return (
    <div className={`lab-keys pt-room is-${saved.theme}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Play or build">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'play'}
            onClick={() => setMode('play')}
          >
            ⛳ Play
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'build'}
            onClick={() => setMode('build')}
          >
            ✎ Build a hole
          </button>
        </div>
        {mode === 'play' && (
          <div className="lab-group" role="group" aria-label="How well the computer putts">
            {LEVELS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.level === l}
                onClick={() => {
                  setSaved((s) => ({ ...s, level: l }))
                  if (phase === 'done' || (idx === 0 && strokes === 0)) start(course, l)
                }}
              >
                {LEVEL_NAMES[l]}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === 'play' && (
        <>
          <div className="lab-controls" role="group" aria-label="Which holes">
            <button
              className="btn btn-ghost"
              aria-pressed={course.kind === 'course'}
              onClick={() => start({ kind: 'course', holes: COURSE })}
            >
              The course · {COURSE.length} holes
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={course.kind === 'mine'}
              disabled={!mine.length}
              onClick={() => start({ kind: 'mine', holes: mine })}
            >
              Your holes · {mine.length}
            </button>
            {sentHole && (
              <button
                className="btn btn-ghost"
                aria-pressed={course.kind === 'sent'}
                onClick={() => start({ kind: 'sent', holes: [sentHole] })}
              >
                The sent hole
              </button>
            )}
          </div>
          <div className="pt-card-wrap">
            <table className="pt-card">
              <caption className="sr-only">Scorecard</caption>
              <thead>
                <tr>
                  <th scope="row">Hole</th>
                  {course.holes.map((_, i) => (
                    <th key={i} scope="col" className={i === idx ? 'is-now' : ''}>
                      {i + 1}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">You</th>
                  {card.map((c, i) => (
                    <td key={i} className={i === idx ? 'is-now' : ''}>
                      {c.you ?? (i === idx && strokes ? `(${strokes})` : '·')}
                    </td>
                  ))}
                  <td>{total('you')}</td>
                </tr>
                <tr>
                  <th scope="row">{LEVEL_NAMES[level]}</th>
                  {card.map((c, i) => (
                    <td key={i} className={i === idx ? 'is-now' : ''}>
                      {c.cpu ?? '·'}
                    </td>
                  ))}
                  <td>{total('cpu')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mc-line" aria-live="polite">
            {line}
          </p>
        </>
      )}

      {mode === 'build' && (
        <div className="lab-controls" role="group" aria-label="Paint with">
          {TOOLS.map((t) => (
            <button
              key={t.t}
              className={`btn btn-ghost pt-tool is-${t.t}`}
              aria-pressed={tool === t.t}
              onClick={() => setTool(t.t)}
            >
              <span aria-hidden className="pt-swatch" />
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div
        className={`pt-wrap${canPutt ? ' is-aiming' : ''}${mode === 'build' ? ' is-building' : ''}`}
        tabIndex={0}
        role="group"
        aria-label={
          mode === 'build'
            ? 'The hole you are building. Arrow keys move the square, keys 1 to 6 pick grass, wall, sand, water, tee or cup, and Enter paints.'
            : 'The green. Drag back from anywhere and let go to putt; with the keys, left and right aim, up and down set the strength, Space putts.'
        }
        onKeyDown={onKey}
      >
        <CanvasStage
          className="pt-stage"
          label={
            mode === 'build'
              ? `A hole being built: ${draftHole ? 'it can be played' : 'the cup cannot be reached from the tee yet'}.`
              : `Hole ${idx + 1}, ${hole.name}. ${line}`
          }
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          make={(ctx, c) => {
            let last = ''
            let leg: { key: string; pts: Pt[] } | null = null
            return {
              frame: (dt) => {
                const st = refs.current
                const sh = show.current
                let moving: Pt | null = null
                if (sh) {
                  sh.t += dt * 60
                  const k = Math.min(sh.frames.length / 2 - 1, Math.floor(sh.t))
                  moving = { x: sh.frames[k * 2], y: sh.frames[k * 2 + 1] }
                  if (sh.t >= sh.frames.length / 2 - 1) sh.after()
                }
                const a = aim.current
                const building = st.mode === 'build'
                const flat = building ? st.draft : writeHole(st.course.holes[st.idx])
                const key = `${c.width}x${c.height}|${flat}|${st.saved.theme}|${st.saved.guide}|${moving ? `${moving.x.toFixed(3)},${moving.y.toFixed(3)}` : ''}|${sh?.who}|${st.ball.x.toFixed(3)},${st.ball.y.toFixed(3)}|${st.cpuBall ? `${st.cpuBall.x},${st.cpuBall.y}` : ''}|${a.angle.toFixed(3)}|${a.power.toFixed(3)}|${a.dragging}|${st.phase}|${building ? st.cursor : ''}`
                if (key === last) return
                last = key
                const v = fitView(c.width, c.height)
                view.current = v
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.clearRect(0, 0, c.width, c.height)
                paintTiles(ctx, flat, st.saved.theme, v)
                const L = LOOK[st.saved.theme]
                const centre = (ch: string) => {
                  const i = flat.indexOf(ch)
                  return { x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 }
                }
                drawCupAndTee(ctx, v, centre('o'), centre('t'), st.saved.theme)
                if (building) {
                  const x = st.cursor % W
                  const y = Math.floor(st.cursor / W)
                  ctx.strokeStyle = '#ffb000'
                  ctx.lineWidth = 3
                  ctx.strokeRect(v.ox + x * v.s + 1.5, v.oy + y * v.s + 1.5, v.s - 3, v.s - 3)
                  return
                }
                const h = st.course.holes[st.idx]
                const aiming = st.phase === 'aim' && !sh
                if (aiming && (a.power > 0 || a.dragging)) {
                  if (st.saved.guide && a.power > 0) {
                    const lk = `${st.idx}|${st.ball.x},${st.ball.y}|${a.angle.toFixed(3)}|${a.power.toFixed(3)}`
                    if (leg?.key !== lk)
                      leg = { key: lk, pts: firstLeg(h, st.ball, a.angle, a.power) }
                    ctx.strokeStyle = 'rgba(255,255,255,0.75)'
                    ctx.setLineDash([5, 6])
                    ctx.lineWidth = Math.max(1.5, v.s * 0.05)
                    ctx.beginPath()
                    leg.pts.forEach((p, i) =>
                      i
                        ? ctx.lineTo(v.ox + p.x * v.s, v.oy + p.y * v.s)
                        : ctx.moveTo(v.ox + p.x * v.s, v.oy + p.y * v.s),
                    )
                    ctx.stroke()
                    ctx.setLineDash([])
                  }
                  // the putter, pulled back the further the harder
                  const bx = v.ox + st.ball.x * v.s
                  const by = v.oy + st.ball.y * v.s
                  const back = (0.35 + a.power * 1.6) * v.s
                  ctx.strokeStyle = '#cfd6dd'
                  ctx.lineCap = 'round'
                  ctx.lineWidth = Math.max(3, v.s * 0.12)
                  ctx.beginPath()
                  ctx.moveTo(bx - Math.cos(a.angle) * back, by - Math.sin(a.angle) * back)
                  ctx.lineTo(
                    bx - Math.cos(a.angle) * (back + v.s * 0.15),
                    by - Math.sin(a.angle) * (back + v.s * 0.15),
                  )
                  ctx.stroke()
                  ctx.lineCap = 'butt'
                  // the strength, as a bar along the foot of the hole
                  ctx.fillStyle = 'rgba(0,0,0,0.45)'
                  ctx.fillRect(v.ox + v.s * 0.5, v.oy + (H - 0.55) * v.s, (W - 1) * v.s, v.s * 0.3)
                  ctx.fillStyle = a.power > 0.8 ? '#ff6b4a' : '#ffd34d'
                  ctx.fillRect(
                    v.ox + v.s * 0.5,
                    v.oy + (H - 0.55) * v.s,
                    (W - 1) * a.power * v.s,
                    v.s * 0.3,
                  )
                }
                const yourBall =
                  sh?.who === 0
                    ? moving
                    : st.phase === 'cpu' || st.phase === 'between' || st.phase === 'done'
                      ? null
                      : st.ball
                if (yourBall) drawBall(ctx, v, yourBall, L.you)
                const theirs = sh?.who === 1 ? moving : st.cpuBall
                if (theirs) drawBall(ctx, v, theirs, L.cpu)
              },
            }
          }}
        />
      </div>

      {mode === 'play' && (
        <div className="lab-controls">
          {phase === 'between' && (
            <button className="btn" onClick={nextHole}>
              ▶ Hole {idx + 2}
            </button>
          )}
          {phase === 'done' && course.kind !== 'try' && (
            <button className="btn" onClick={() => start(course)}>
              ↻ Play again
            </button>
          )}
          {course.kind === 'try' && (phase === 'done' || phase === 'between') && (
            <button className="btn" onClick={() => setMode('build')}>
              ✎ Back to building
            </button>
          )}
          {phase !== 'done' && !(idx === 0 && strokes === 0 && phase === 'aim') && (
            <button className="btn btn-ghost" onClick={() => start(course)}>
              ↻ Start the round again
            </button>
          )}
        </div>
      )}

      {mode === 'build' && (
        <>
          <p className="mc-line" aria-live="polite">
            {draftHole
              ? 'This hole can be played. Try it, keep it, or send it.'
              : 'The cup cannot be reached from the tee yet: open a way through.'}
          </p>
          <div className="lab-controls">
            <button
              className="btn"
              disabled={!draftHole}
              onClick={() => {
                setMode('play')
                start({ kind: 'try', holes: [draftHole!] })
              }}
            >
              ⛳ Try it
            </button>
            <button className="btn btn-ghost" disabled={!draftHole || full} onClick={keep}>
              {editing !== null
                ? `★ Keep as your hole ${editing + 1}`
                : full
                  ? `All ${MAX_HOLES} kept`
                  : '★ Keep it'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setDraft(BLANK)
                setEditing(null)
              }}
            >
              ＋ New blank hole
            </button>
            <label className="pt-from">
              <span>Start from</span>
              <select
                value=""
                onChange={(e) => {
                  const h = COURSE[Number(e.target.value)]
                  if (h) {
                    setDraft(writeHole(h))
                    setEditing(null)
                  }
                }}
              >
                <option value="">a hole on the course…</option>
                {COURSE.map((h, i) => (
                  <option key={i} value={i}>
                    {i + 1}. {h.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {draftHole && (
            <CopyLink
              text={`Try my mini golf hole:\n${here()}#lab?demo=putt&hole=${pack(draft)}`}
              label="Copy a link to this hole"
            />
          )}
          {saved.holes.length > 0 && (
            <section className="fw-panel" aria-label="Your holes">
              <h3 className="fw-h">Your holes</h3>
              <ol className="pt-mine">
                {saved.holes.map((hText, i) => (
                  <li key={i} className={editing === i ? 'is-editing' : ''}>
                    <span>Hole {i + 1}</span>
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setDraft(hText)
                        setEditing(i)
                        setRemoving(null)
                      }}
                    >
                      ✎ Edit
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        if (removing !== i) return setRemoving(i)
                        setSaved((s) => ({ ...s, holes: s.holes.filter((_, k) => k !== i) }))
                        setRemoving(null)
                        if (editing === i) setEditing(null)
                        else if (editing !== null && editing > i) setEditing(editing - 1)
                      }}
                    >
                      {removing === i ? 'Really remove?' : '✕ Remove'}
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}

      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {r.won}, lost {r.lost}
          {r.tied ? `, tied ${r.tied}` : ''}
          {r.best ? ` · best round on the course ${r.best}` : ''}
        </span>
      </p>
      {mode === 'play' && level !== saved.level && phase !== 'done' && (
        <p className="muted mc-note">The new level starts with the next round.</p>
      )}
      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Look</h3>
          <div className="lab-controls" role="group" aria-label="Look">
            {THEMES.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={saved.theme === t}
                onClick={() => setSaved((s) => ({ ...s, theme: t }))}
              >
                {LOOK[t].name}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.guide}
              onClick={() => setSaved((s) => ({ ...s, guide: !s.guide }))}
            >
              Show the line to the first bounce
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Mini golf against the computer. Drag back from anywhere on the hole and let go: the ball
        goes the other way, harder the further you pull. Grass rolls, sand drags, walls bounce, and
        water costs a stroke and puts you back where you played from. A ball arriving too fast runs
        over the cup. Play each hole out — after {PICK_UP} strokes it is picked up — and then the
        computer plays it; fewest strokes over the round wins. Easy, Fair and Hard all plan their
        putts the same way, and differ in how many they consider and how steady their hand is. Build
        your own holes too: paint grass, walls, sand and water, put down the tee and the cup, try
        it, keep up to {MAX_HOLES}, and send one to someone by link.
      </p>
    </div>
  )
}
