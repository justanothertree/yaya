import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { hashParam, here } from '../lab/links'
import { CanvasStage } from './CanvasStage'
import {
  BEND,
  BONSAI_KEY,
  DEFAULT_DRESS,
  GLAZES,
  LEAVES,
  MAX_BRANCHES,
  MAX_KEPT,
  MAX_SEASONS,
  POTS,
  SEASONS,
  decode,
  encode,
  nearest,
  readSaved,
  replay,
  settleAngle,
  shape,
  type Dress,
  type Op,
  type Saved,
  type Segment,
  type Tree,
} from './bonsai'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(BONSAI_KEY))
  } catch {
    return readSaved(null)
  }
}
const newSeed = () => (Math.random() * 2 ** 32) >>> 0
/** a first tree is a few seasons old, so there is something to shape from the start */
const STARTER: Op[] = Array.from({ length: 7 }, () => ({ kind: 'grow' }) as Op)
const STARTER_SEED = 2718281828

const POT_NAMES: Record<Dress['pot'], string> = {
  oval: 'Oval',
  rectangle: 'Rectangle',
  round: 'Bowl',
  cascade: 'Cascade',
}
const LEAF_NAMES: Record<Dress['leaf'], string> = {
  maple: '🍁 Maple',
  pine: '🌲 Pine',
  blossom: '🌸 Blossom',
}
const SEASON_NAMES: Record<Dress['season'], string> = {
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
  winter: 'Winter',
}
const GLAZE_NAMES = ['Red clay', 'Blue', 'Green', 'Cream', 'Black', 'Rust']

/* ---------------------------------------------------------------------------- drawing */

/** a fixed little hash of a branch id, for where its leaves sit — the same every frame */
const hashOf = (id: string, k: number) => {
  let h = 0x811c9dc5 ^ k
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  return ((h >>> 0) % 10000) / 10000
}

const SKY: Record<Dress['season'], [string, string]> = {
  spring: ['#e9f5e6', '#fdf1f5'],
  summer: ['#dcecf9', '#fbfaf0'],
  autumn: ['#f9e8d6', '#f3ddc6'],
  winter: ['#e3e9f2', '#f7f9fc'],
}
/** leaf colours per kind and season; an empty list is a bare tree */
function foliage(leaf: Dress['leaf'], season: Dress['season']): string[] {
  if (leaf === 'pine')
    return season === 'spring'
      ? ['#4f8a3c', '#7fb85a', '#3d7333']
      : season === 'winter'
        ? ['#2f5a33', '#3a6a3c']
        : ['#2f6e34', '#3f7f3c', '#285e2d']
  if (season === 'winter') return []
  if (season === 'autumn')
    return leaf === 'blossom'
      ? ['#c9572e', '#d9822b', '#a8412b']
      : ['#d9662b', '#e8a03a', '#b8392b', '#c9502a']
  if (season === 'spring')
    return leaf === 'blossom'
      ? ['#f6b8cf', '#fbd3e0', '#ee9fbd']
      : ['#8cc94f', '#a6d86a', '#79b843']
  return leaf === 'blossom' ? ['#4f9a40', '#5aa84a'] : ['#3f8f3a', '#4d9e42', '#357f31']
}

type View = { s: number; baseX: number; baseY: number }

/** where the tree sits and how large: it fills the room above the pot, and never shrinks past a sapling */
function fitView(
  segs: readonly Segment[],
  w: number,
  h: number,
  dress: Dress,
): View & { pot: Pot } {
  const pot = potBox(w, h, dress)
  let minX = -1
  let maxX = 1
  let maxY = 3.2
  for (const g of segs) {
    minX = Math.min(minX, g.x1 - g.width)
    maxX = Math.max(maxX, g.x1 + g.width)
    maxY = Math.max(maxY, g.y1 + 0.3)
  }
  const side = Math.max(-minX, maxX) + 0.35
  const room = pot.top - h * 0.04
  const s = Math.min(room / maxY, (w * 0.48) / side)
  return { s, baseX: w / 2, baseY: pot.top + pot.soil * 0.4, pot }
}

type Pot = { x: number; top: number; w: number; h: number; soil: number }
function potBox(w: number, h: number, dress: Dress): Pot {
  const tall = dress.pot === 'cascade'
  const pw = Math.min(w * (tall ? 0.26 : 0.46), h * (tall ? 0.3 : 0.62))
  const ph =
    pw * (tall ? 0.95 : dress.pot === 'round' ? 0.42 : dress.pot === 'rectangle' ? 0.3 : 0.24)
  const bottom = h * 0.93
  return { x: w / 2, top: bottom - ph, w: pw, h: ph, soil: Math.max(4, pw * 0.07) }
}

function drawPot(ctx: CanvasRenderingContext2D, p: Pot, dress: Dress, w: number, h: number) {
  // the stand it sits on
  ctx.fillStyle = '#5b4434'
  const slabW = Math.min(w * 0.9, p.w * 1.7)
  ctx.fillRect(p.x - slabW / 2, p.top + p.h - 1, slabW, Math.max(4, h * 0.018))
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.fillRect(p.x - slabW / 2, p.top + p.h + h * 0.018 - 2, slabW, Math.max(3, h * 0.03))

  const glaze = GLAZES[dress.glaze]
  const L = p.x - p.w / 2
  const R = p.x + p.w / 2
  const T = p.top
  const B = p.top + p.h
  ctx.fillStyle = glaze
  ctx.beginPath()
  if (dress.pot === 'oval') {
    ctx.moveTo(L, T)
    ctx.lineTo(R, T)
    ctx.quadraticCurveTo(R - p.w * 0.02, B, R - p.w * 0.18, B)
    ctx.lineTo(L + p.w * 0.18, B)
    ctx.quadraticCurveTo(L + p.w * 0.02, B, L, T)
  } else if (dress.pot === 'rectangle') {
    ctx.moveTo(L, T)
    ctx.lineTo(R, T)
    ctx.lineTo(R - p.w * 0.05, B - p.h * 0.18)
    ctx.lineTo(L + p.w * 0.05, B - p.h * 0.18)
  } else if (dress.pot === 'round') {
    ctx.moveTo(L, T)
    ctx.lineTo(R, T)
    ctx.bezierCurveTo(R, B + p.h * 0.1, L, B + p.h * 0.1, L, T)
  } else {
    ctx.moveTo(L, T)
    ctx.lineTo(R, T)
    ctx.lineTo(R - p.w * 0.06, B - p.h * 0.08)
    ctx.lineTo(L + p.w * 0.06, B - p.h * 0.08)
  }
  ctx.closePath()
  ctx.fill()
  // feet, a rim and a soft highlight down one side
  if (dress.pot === 'rectangle' || dress.pot === 'cascade') {
    const fh = dress.pot === 'rectangle' ? p.h * 0.18 : p.h * 0.08
    const fw = p.w * 0.14
    ctx.fillRect(L + p.w * 0.08, B - fh - 1, fw, fh + 1)
    ctx.fillRect(R - p.w * 0.08 - fw, B - fh - 1, fw, fh + 1)
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(L + p.w * 0.12, T + p.h * 0.12, Math.max(2, p.w * 0.04), p.h * 0.5)
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(L - p.w * 0.015, T - 1, p.w * 1.03, Math.max(3, p.h * 0.07))
  ctx.fillStyle = glaze
  ctx.fillRect(L - p.w * 0.015, T - 2, p.w * 1.03, Math.max(2, p.h * 0.05))

  // the soil, then what is laid on it
  ctx.fillStyle = '#4b3527'
  ctx.beginPath()
  ctx.ellipse(p.x, T, p.w * 0.47, p.soil, 0, Math.PI, 0)
  ctx.fill()
  if (dress.moss) {
    ctx.fillStyle = dress.season === 'winter' ? '#7d9a6a' : '#5f8f3a'
    for (let i = 0; i < 9; i++) {
      const x = p.x - p.w * 0.4 + (i / 8) * p.w * 0.8
      const r = p.soil * (0.7 + hashOf('moss', i) * 0.6)
      ctx.beginPath()
      ctx.ellipse(x, T - r * 0.25, r * 1.6, r * 0.75, 0, Math.PI, 0)
      ctx.fill()
    }
  }
  if (dress.stones)
    for (const [dx, r, c] of [
      [-0.3, 1.2, '#9a958c'],
      [0.24, 0.9, '#b7b1a6'],
      [0.33, 0.6, '#85807a'],
    ] as const) {
      ctx.fillStyle = c
      ctx.beginPath()
      ctx.ellipse(
        p.x + dx * p.w,
        T - p.soil * r * 0.4,
        p.soil * r * 1.5,
        p.soil * r,
        0,
        0,
        Math.PI * 2,
      )
      ctx.fill()
    }
  if (dress.season === 'winter') {
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.beginPath()
    ctx.ellipse(p.x, T - 1, p.w * 0.45, p.soil * 0.8, 0, Math.PI, 0)
    ctx.fill()
  }
}

type Paint = {
  segs: readonly Segment[]
  dress: Dress
  tree: Tree
  /** the branch picked, whose whole subtree is lit to show what a cut would take */
  picked: string | null
  /** how far the season's new shoots have grown, 0–1 */
  sprung: number
  /** seconds, for the sway and what drifts down; 0 holds it still */
  t: number
}

function drawBonsai(ctx: CanvasRenderingContext2D, w: number, h: number, p: Paint): View {
  const { segs, dress, picked, sprung, t } = p
  const v = fitView(segs, w, h, dress)
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, SKY[dress.season][0])
  g.addColorStop(1, SKY[dress.season][1])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  const sway = (x: number, y: number): [number, number] => {
    const dx = t ? Math.sin(t * 1.1 + y * 0.7) * 0.012 * y * y : 0
    return [v.baseX + (x + dx) * v.s, v.baseY - y * v.s]
  }
  const fresh = (sg: Segment) => sprung < 1 && sg.born === p.tree.seasons && sg.born > 0
  const end = (sg: Segment): [number, number] => {
    const k = fresh(sg) ? sprung : 1
    return [sg.x0 + (sg.x1 - sg.x0) * k, sg.y0 + (sg.y1 - sg.y0) * k]
  }

  drawPot(ctx, v.pot, dress, w, h)

  // roots spreading over the soil, then the wood, thickest first
  const trunk = segs[0]
  if (trunk) {
    ctx.strokeStyle = '#4a3426'
    ctx.lineCap = 'round'
    for (const side of [-1, 1]) {
      ctx.lineWidth = Math.max(2, trunk.width * v.s * 0.45)
      ctx.beginPath()
      ctx.moveTo(v.baseX, v.baseY - trunk.width * v.s * 0.3)
      ctx.quadraticCurveTo(
        v.baseX + side * trunk.width * v.s * 0.9,
        v.baseY,
        v.baseX + side * trunk.width * v.s * 1.6,
        v.baseY + v.pot.soil * 0.3,
      )
      ctx.stroke()
    }
  }
  const order = [...segs].sort((a, b) => b.width - a.width)
  ctx.lineCap = 'round'
  for (const sg of order) {
    const [x0, y0] = sway(sg.x0, sg.y0)
    const [x1, y1] = sway(...end(sg))
    ctx.strokeStyle = sg.depth < 2 ? '#4a3426' : sg.depth < 5 ? '#5a3f2d' : '#6b4a33'
    ctx.lineWidth = Math.max(1.2, sg.width * v.s)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.stroke()
  }
  // snow along the upper side of the thicker wood
  if (dress.season === 'winter') {
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'
    for (const sg of order) {
      if (sg.width * v.s < 3 || Math.abs(sg.x1 - sg.x0) < Math.abs(sg.y1 - sg.y0) * 0.35) continue
      const [x0, y0] = sway(sg.x0, sg.y0)
      const [x1, y1] = sway(...end(sg))
      ctx.lineWidth = Math.max(1.5, sg.width * v.s * 0.35)
      ctx.beginPath()
      ctx.moveTo(x0, y0 - sg.width * v.s * 0.4)
      ctx.lineTo(x1, y1 - sg.width * v.s * 0.4)
      ctx.stroke()
    }
  }

  // leaves at every tip and along the fine twigs behind it
  const colours = foliage(dress.leaf, dress.season)
  if (colours.length) {
    const r = Math.max(2.2, 0.105 * v.s)
    for (const sg of segs) {
      if (sg.depth < 1 || (!sg.tip && sg.depth < 4)) continue
      const k = fresh(sg) ? sprung : 1
      const [ex, ey] = end(sg)
      const n = sg.tip ? 7 : 3
      for (let i = 0; i < n; i++) {
        const a = hashOf(sg.id, i) * Math.PI * 2
        const d = hashOf(sg.id, i + 9) * 0.2
        const [x, y] = sway(ex + Math.cos(a) * d, ey + Math.sin(a) * d)
        ctx.fillStyle = colours[Math.floor(hashOf(sg.id, i + 20) * colours.length)]
        ctx.beginPath()
        if (dress.leaf === 'pine') ctx.ellipse(x, y, r * 1.7 * k, r * 0.75 * k, 0, 0, Math.PI * 2)
        else ctx.arc(x, y, r * k * (0.75 + hashOf(sg.id, i + 30) * 0.5), 0, Math.PI * 2)
        ctx.fill()
      }
      if (dress.leaf === 'pine' && dress.season === 'winter' && sg.tip) {
        const [x, y] = sway(ex, ey)
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.beginPath()
        ctx.ellipse(x, y - r * 0.5, r * 1.3, r * 0.4, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  // the branch in hand: everything a cut would take, lit
  if (picked !== null) {
    ctx.strokeStyle = 'rgba(255, 176, 0, 0.85)'
    for (const sg of segs) {
      if (sg.id !== picked && !sg.id.startsWith(picked + '.')) continue
      const [x0, y0] = sway(sg.x0, sg.y0)
      const [x1, y1] = sway(...end(sg))
      ctx.lineWidth = Math.max(3, sg.width * v.s * 0.6)
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
    }
    const base = segs.find((sg) => sg.id === picked)
    if (base) {
      const [x, y] = sway(base.x0, base.y0)
      ctx.fillStyle = '#ffb000'
      ctx.strokeStyle = '#3a2a00'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, Math.max(5, base.width * v.s * 0.7 + 3), 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }

  // what drifts down in the season: petals, falling leaves, snow
  if (t && (dress.season === 'winter' || (dress.season !== 'summer' && colours.length))) {
    const fall =
      dress.season === 'winter'
        ? ['#ffffff']
        : dress.season === 'spring' && dress.leaf !== 'blossom'
          ? []
          : colours
    for (let i = 0; i < (fall.length ? 14 : 0); i++) {
      const speed = 0.04 + hashOf('fall', i) * 0.05
      const y = ((hashOf('y', i) + t * speed) % 1) * h
      const x = (hashOf('x', i) * w + Math.sin(t * 0.8 + i) * w * 0.03 + w) % w
      ctx.fillStyle = fall[i % fall.length]
      ctx.globalAlpha = 0.75
      ctx.beginPath()
      ctx.ellipse(x, y, 3.2, 2, t + i, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }
  return v
}

/* ---------------------------------------------------------------------------- the room */

type Start = { seed: number; ops: Op[]; dress: Dress; fromLink: boolean }
function startTree(saved: Saved): Start {
  const linked = hashParam('tree')
  const got = linked ? decode(linked) : null
  if (got) return { ...got, fromLink: true }
  const mine = saved.current ? decode(saved.current) : null
  return mine
    ? { ...mine, fromLink: false }
    : { seed: STARTER_SEED, ops: STARTER, dress: DEFAULT_DRESS, fromLink: false }
}

/** the branches around one, for walking the tree with arrow keys */
function neighbours(tree: Tree, id: string | null) {
  const kids = (p: string) =>
    [...tree.branches.values()]
      .filter((b) => b.parent === p)
      .map((b) => b.id)
      .sort()
  if (id === null) return { up: kids('')[0] ?? null, down: null, left: null, right: null }
  const b = tree.branches.get(id)
  const sibs = b && b.parent !== null ? kids(b.parent) : []
  const i = sibs.indexOf(id)
  return {
    up: kids(id)[0] ?? null,
    down: b?.parent ? b.parent : null,
    left: i > 0 ? sibs[i - 1] : null,
    right: i >= 0 && i < sibs.length - 1 ? sibs[i + 1] : null,
  }
}

export function BonsaiDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [start] = useState(() => startTree(saved))
  const [seed, setSeed] = useState(start.seed)
  const [ops, setOps] = useState<Op[]>(start.ops)
  const [dress, setDress] = useState<Dress>(start.dress)
  const [fromLink, setFromLink] = useState(start.fromLink)
  const [picked, setPicked] = useState<string | null>(null)
  const [name, setName] = useState('')
  /** a tree swapped out by planting a new seed, so Undo can bring it back */
  const [before, setBefore] = useState<{ seed: number; ops: Op[] } | null>(null)
  /** the branch being bent by a drag, and its angle so far — committed as one wire on release */
  const [bending, setBending] = useState<{ id: string; angle: number } | null>(null)

  const tree = useMemo(() => {
    const t = replay(seed, ops)
    return bending ? replay(seed, [...ops, { kind: 'wire', ...bending }]) : t
  }, [seed, ops, bending])
  const segs = useMemo(() => shape(tree), [tree])
  const code = useMemo(() => encode(seed, ops, dress), [seed, ops, dress])
  const grownAt = useRef(-Infinity)
  const view = useRef<View | null>(null)
  const now = useRef({ tree, segs, dress, picked })
  now.current = { tree, segs, dress, picked }

  useEffect(() => {
    try {
      localStorage.setItem(BONSAI_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(() => {
    if (!fromLink) setSaved((s) => ({ ...s, current: code }))
  }, [code, fromLink])
  // a picked branch that a cut or an undo took away is no longer in hand
  useEffect(() => {
    if (picked !== null && !tree.branches.has(picked)) setPicked(null)
  }, [tree, picked])

  const act = (op: Op) => {
    setOps((o) => {
      const last = o[o.length - 1]
      // bending the same branch again replaces the last bend, so a link stays short
      if (op.kind === 'wire' && last?.kind === 'wire' && last.id === op.id)
        return [...o.slice(0, -1), op]
      return [...o, op]
    })
    setFromLink(false)
    setBefore(null)
  }
  const seasons = tree.seasons
  const full = tree.branches.size >= MAX_BRANCHES - 3
  const growOne = () => {
    if (seasons >= MAX_SEASONS) return
    grownAt.current = performance.now()
    act({ kind: 'grow' })
  }
  const cutPicked = () => {
    if (picked === null) return
    const parent = tree.branches.get(picked)?.parent ?? null
    act({ kind: 'cut', id: picked })
    setPicked(parent === '' ? null : parent)
  }
  const bend = (by: number) => {
    if (picked === null) return
    const b = tree.branches.get(picked)
    if (b) act({ kind: 'wire', id: picked, angle: settleAngle(b.angle + by) })
  }
  const undo = () => {
    if (ops.length) {
      setOps((o) => o.slice(0, -1))
      setFromLink(false)
    } else if (before) {
      setSeed(before.seed)
      setOps(before.ops)
      setBefore(null)
    }
  }
  const plant = () => {
    setBefore({ seed, ops })
    setSeed(newSeed())
    setOps([])
    setPicked(null)
    setFromLink(false)
  }

  /** a pointer's place on the canvas, in tree units */
  const toTree = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    const v = view.current
    if (!v) return null
    const px = ((e.clientX - r.left) / r.width) * c.width
    const py = ((e.clientY - r.top) / r.height) * c.height
    return { x: (px - v.baseX) / v.s, y: (v.baseY - py) / v.s, px: c.width / r.width / v.s }
  }
  const angleToward = (id: string, x: number, y: number) => {
    const sg = segs.find((s) => s.id === id)
    const b = tree.branches.get(id)
    if (!sg || !b) return null
    const abs = Math.atan2(sg.x1 - sg.x0, sg.y1 - sg.y0)
    const parentDir = abs - b.angle
    let a = Math.atan2(x - sg.x0, y - sg.y0) - parentDir
    while (a > Math.PI) a -= Math.PI * 2
    while (a < -Math.PI) a += Math.PI * 2
    return settleAngle(Math.max(-BEND, Math.min(BEND, a)))
  }
  const press = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null)
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = toTree(e)
    if (!p) return
    const hit = nearest(segs, p.x, p.y, Math.max(0.12, 22 * p.px))
    if (hit === null) {
      setPicked(null)
      return
    }
    setPicked(hit)
    press.current = { id: hit, x: p.x, y: p.y, moved: false }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* an enhancement: the drag still works while the pointer stays on the canvas */
    }
  }
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const pr = press.current
    if (!pr) return
    const p = toTree(e)
    if (!p) return
    if (!pr.moved && Math.hypot(p.x - pr.x, p.y - pr.y) < 10 * p.px) return
    pr.moved = true
    const a = angleToward(pr.id, p.x, p.y)
    if (a !== null) setBending({ id: pr.id, angle: a })
  }
  const onUp = () => {
    const pr = press.current
    press.current = null
    if (pr?.moved && bending) act({ kind: 'wire', ...bending })
    setBending(null)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const walk: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    }
    if (walk[e.key]) {
      e.preventDefault()
      e.stopPropagation()
      const next = neighbours(tree, picked)[walk[e.key]]
      if (next !== null || walk[e.key] === 'down') setPicked(next)
    } else if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'x') {
      e.preventDefault()
      cutPicked()
    } else if (e.key === '[' || e.key === ']') {
      e.preventDefault()
      bend(e.key === '[' ? -0.15 : 0.15)
    } else if (e.key === 'g') {
      e.preventDefault()
      growOne()
    } else if (e.key === 'z') {
      e.preventDefault()
      undo()
    } else if (e.key === 'Escape') setPicked(null)
  }

  const download = () => {
    const c = document.createElement('canvas')
    c.width = 1200
    c.height = 1200
    const ctx = c.getContext('2d')
    if (!ctx) return
    drawBonsai(ctx, c.width, c.height, { segs, dress, tree, picked: null, sprung: 1, t: 0 })
    c.toBlob((b) => {
      if (!b) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = `${(name.trim() || 'my-bonsai').replace(/[^\w-]+/g, '-').toLowerCase()}.png`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    }, 'image/png')
  }
  const keep = () => {
    const label = name.trim() || `Tree ${saved.kept.length + 1}`
    setSaved((s) => ({
      ...s,
      kept: [{ name: label, code }, ...s.kept.filter((k) => k.name !== label)].slice(0, MAX_KEPT),
    }))
    setName(label)
  }
  const open = (c: string, n: string) => {
    const d = decode(c)
    if (!d) return
    setBefore({ seed, ops })
    setSeed(d.seed)
    setOps(d.ops)
    setDress(d.dress)
    setName(n)
    setPicked(null)
    setFromLink(false)
  }
  const setD = (p: Partial<Dress>) => {
    setDress((d) => ({ ...d, ...p }))
    setFromLink(false)
  }

  const cuts = ops.filter((o) => o.kind === 'cut').length
  const wires = new Set(ops.flatMap((o) => (o.kind === 'wire' ? [o.id] : []))).size
  const pickedBranch = picked !== null ? tree.branches.get(picked) : undefined
  const takes =
    picked !== null
      ? segs.filter((s) => s.id === picked || s.id.startsWith(picked + '.')).length
      : 0

  return (
    <div className="lab-keys bz-room">
      {fromLink && (
        <p className="beat-banner">
          🌳 <strong>A bonsai somebody grew and shaped</strong> — every cut and bend came with it.
          Grow it on, prune it, bend it, re-pot it: change anything and it becomes yours to keep.
        </p>
      )}
      <div
        className="bz-canvas-wrap"
        tabIndex={0}
        role="group"
        aria-label="The tree. Arrow keys walk its branches, Delete cuts, [ and ] wire, G grows."
        onKeyDown={onKey}
      >
        <CanvasStage
          className="bz-stage"
          label={`A bonsai, ${seasons} season${seasons === 1 ? '' : 's'} old with ${tree.branches.size} branches, in a ${GLAZE_NAMES[dress.glaze].toLowerCase()} ${POT_NAMES[dress.pot].toLowerCase()} pot, in ${dress.season}.${picked !== null ? ' A branch is picked.' : ''} Arrow keys walk the branches.`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          make={(ctx, canvas) => {
            const still =
              typeof matchMedia === 'function' &&
              matchMedia('(prefers-reduced-motion: reduce)').matches
            let last = ''
            let t = 0
            return {
              frame: (dt) => {
                t += dt
                const n = now.current
                const sprung = still ? 1 : Math.min(1, (performance.now() - grownAt.current) / 650)
                // held still, a frame is only drawn when something in it changed
                const key = `${canvas.width}x${canvas.height}|${n.tree.seasons}|${n.segs.length}|${encode(n.tree.seed, [], n.dress)}|${n.picked}|${n.segs.map((s) => s.x1.toFixed(3)).join()}|${sprung}`
                if (still && key === last) return
                last = key
                view.current = drawBonsai(ctx, canvas.width, canvas.height, {
                  ...n,
                  sprung,
                  t: still ? 0 : t + 1,
                })
              },
            }
          }}
        />
      </div>
      <p className="muted bz-status" aria-live="polite">
        Season {seasons} of {MAX_SEASONS} · {tree.branches.size} branches
        {cuts ? ` · ${cuts} cut${cuts === 1 ? '' : 's'}` : ''}
        {wires ? ` · ${wires} wired` : ''}
        {seasons >= MAX_SEASONS
          ? ' · fully grown'
          : full
            ? ' · as full as a tree gets — cut something back to let it grow'
            : ''}
      </p>

      <div className="lab-controls">
        <button className="btn" onClick={growOne} disabled={seasons >= MAX_SEASONS}>
          🌱 Grow a season
        </button>
        <button className="btn btn-ghost" onClick={undo} disabled={!ops.length && !before}>
          ↶ Undo
        </button>
        <button className="btn btn-ghost" onClick={plant}>
          🌰 Plant a new seed
        </button>
      </div>

      <div className="lab-controls bz-branch" role="group" aria-label="The picked branch">
        {pickedBranch ? (
          <>
            <span className="fw-label">
              Branch picked{takes > 1 ? ` (and ${takes - 1} growing from it)` : ''}
            </span>
            <button className="btn btn-ghost" onClick={cutPicked}>
              ✂️ Cut it off
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => bend(-0.15)}
              disabled={pickedBranch.angle <= -BEND + 0.001}
            >
              ↺ Wire it left
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => bend(0.15)}
              disabled={pickedBranch.angle >= BEND - 0.001}
            >
              ↻ Wire it right
            </button>
            <button className="btn btn-ghost" onClick={() => setPicked(null)}>
              Let go
            </button>
          </>
        ) : (
          <span className="muted">
            Tap a branch to pick it, then cut it off or wire it — or drag a branch to bend it.
          </span>
        )}
      </div>

      <div className="fw-panel">
        <section aria-label="The tree">
          <h3 className="fw-h">The tree</h3>
          <div className="lab-controls" role="group" aria-label="Kind of tree">
            {LEAVES.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={dress.leaf === l}
                onClick={() => setD({ leaf: l })}
              >
                {LEAF_NAMES[l]}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Season">
            {SEASONS.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={dress.season === s}
                onClick={() => setD({ season: s })}
              >
                {SEASON_NAMES[s]}
              </button>
            ))}
          </div>
        </section>
        <section aria-label="The pot">
          <h3 className="fw-h">The pot</h3>
          <div className="lab-controls" role="group" aria-label="Pot shape">
            {POTS.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={dress.pot === p}
                onClick={() => setD({ pot: p })}
              >
                {POT_NAMES[p]}
              </button>
            ))}
          </div>
          <div className="fw-swatches" role="group" aria-label="Glaze">
            <span className="fw-label">Glaze</span>
            {GLAZES.map((c, i) => (
              <button
                key={c}
                className="fw-swatch"
                style={{ background: c }}
                aria-label={`${GLAZE_NAMES[i]} glaze`}
                aria-pressed={dress.glaze === i}
                onClick={() => setD({ glaze: i })}
              />
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={dress.moss}
              onClick={() => setD({ moss: !dress.moss })}
            >
              Moss
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={dress.stones}
              onClick={() => setD({ stones: !dress.stones })}
            >
              Stones
            </button>
          </div>
        </section>
      </div>

      <div className="lab-controls">
        <label className="fw-name">
          <span className="sr-only">Name this tree</span>
          <input
            value={name}
            maxLength={30}
            placeholder="Name this tree"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="btn btn-ghost" onClick={keep}>
          Keep this tree
        </button>
        <button className="btn btn-ghost" onClick={download}>
          ⬇ Save as picture
        </button>
        {saved.kept.map((k) => (
          <span key={k.name} className="fw-kept">
            <button className="btn btn-ghost" onClick={() => open(k.code, k.name)}>
              {k.name}
            </button>
            <button
              className="btn btn-ghost"
              aria-label={`Forget ${k.name}`}
              onClick={() => setSaved((s) => ({ ...s, kept: s.kept.filter((x) => x !== k) }))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <CopyLink
        text={`🌳 A bonsai I grew${name.trim() ? `, “${name.trim()}”` : ''}:\n${here()}#lab?demo=bonsai&tree=${code}`}
        label="🔗 Copy a link to this tree"
      />
      <p className="muted lab-hint">
        Grow it a season at a time: every tip forks, reaches on or rests, and the wood thickens
        where it feeds more twigs. Shape it as you go — cut a branch and everything growing from it
        goes, and the tip you cut back to buds again next season; wire a branch and it holds the
        angle you gave it. The same seed always grows the same way, so a link carries the seed and
        every cut and bend, and a friend gets your very tree. Keys on the tree: arrows walk the
        branches (up to a child, down to the parent, left and right between siblings), Delete cuts,
        [ and ] wire left and right, G grows a season, Z undoes.
      </p>
    </div>
  )
}
