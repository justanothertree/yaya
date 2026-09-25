import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArtThumb } from '../draw/ArtThumb'
import { gallery, subscribeGallery } from '../draw/gallery'
import { paintDrawing, paintStroke, type Drawing, type Stroke, type Tool } from '../draw/strokes'
import { MapGuide } from './MapGuide'
import { cropToInk, MAX_PIECES, worldOf, type MapDoc, type Piece } from './mapDoc'
import { MAP_GUIDE, type PlaceKind } from './mapOf'
import { mapBytes, MAP_LIMIT, parkMaps, removeMap, saveMap, subscribeMaps } from './maps'
import { downBy, outBy } from './strike'
import type { Spot } from './walk'
import { blankZone, brushZone, packZone, readZone, ZONE, zoneIsEmpty } from './zone'

/**
 * Making a map by putting things on it, and by drawing on it.
 *
 * ⚠️ WHY THIS EXISTS BESIDE THE OTHER ONE. The first map maker read a DRAWING: one named layer
 * was one place, so a field of twenty rocks meant twenty layers against a cap of twenty-four,
 * each named by hand. Asked for instead as drawing a thing once and stamping it everywhere,
 * which is a different shape of data and therefore a different room — see mapDoc.
 *
 * ⚠️ NOTHING IS NAMED HERE. That is the whole gain. A stamp carries its kind and its height
 * from the two pickers above the field, chosen once and reused for every press, so placing the
 * fiftieth rock costs one click and no typing.
 *
 * ⚠️ AND THE PIECES POINT AT A PALETTE THIS BUILDS AS IT GOES. A drawing joins the map the
 * first time it is stamped and never again, so fifty rocks are fifty positions and one picture
 * — see mapDoc, where that is the reason a map can carry its own art at all.
 *
 * ⚠️ TWO MODES, BECAUSE STAMPING IS NOT DRAWING. Reported as the paint tools not working in
 * the map editor, which was exactly right: there was no surface to draw on. Some of a map is
 * made once and repeated — a rock, a tree — and some of it is not: a worn path, a shoreline,
 * a patch of sand. The first is a stamp and the second is ink, and a map wants both.
 */

/**
 * What a piece DOES, in the only three answers that change anything.
 *
 * ⚠️ THE OLD LIST WAS THE PARK'S VOCABULARY, NOT A MAP-MAKER'S. Rocks, trees, water, ring
 * and "just a place" are the five kinds the built-in park happens to contain, and offering them
 * asked somebody to sort their own drawing into somebody else's categories — reported as not
 * understanding what they were for, which is fair, because for a stamped map they decided almost
 * nothing: the picture is the picture whichever word is picked.
 *
 * ⚠️ WHAT ACTUALLY DIFFERS IS WHETHER YOU CAN WALK THROUGH IT AND WHETHER YOU STAND ON
 * TOP. So it asks that, and nothing else. Naming an area is a separate want and can wait for
 * somebody to have it.
 */
const DOES: Array<[string, string, PlaceKind, number]> = [
  ['past', 'Walk over it', 'flat', 0],
  ['solid', 'Solid — blocks you', 'wall', 0],
  ['stand', 'Stand on top', 'rocks', 0.5],
]

/**
 * ⚠️ ONLY ASKED WHEN IT MATTERS. Height means nothing for scenery you walk over and
 * nothing for a wall you cannot climb, so the question only appears for something you stand on
 * — which is half of why the old three-way was confusing: it was asked of everything.
 *
 * ⚠️ IN CREATURES, because that is the only ruler on this page. "Only with wings" was the
 * park's own rule wearing a costume; this says the number and lets the reference creature in
 * the guide underneath show what it means.
 */
const HIGHS: Array<[number, string]> = [
  [0.5, 'Half a creature high'],
  [0.8, 'A creature high — needs wings'],
  [1.4, 'Twice that'],
]

/**
 * How big a stamp is, in creatures across.
 *
 * ⚠️ A RANGE RATHER THAN THREE WORDS. It was Small / Middling / Big, which is three
 * answers to a question with infinitely many — and reported as wanting to resize whatever you
 * like. The three old sizes were 3.3, 6.5 and 11 creatures wide, so this covers them and a good
 * deal either side.
 *
 * ⚠️ AND SAID IN CREATURES, like every other measurement on this page. The stored number
 * is a fraction of the world, which means nothing to anybody; outBy is the one conversion, and
 * it is the same one the fighting code measures reach with.
 */
const FAT = { min: 0.5, max: 24, step: 0.25, start: 6 }

/** how fat a line is, the same way, so both sliders read in the same unit */
const NIB = { min: 0.1, max: 10, step: 0.05, start: 1 }

/**
 * ⚠️ MULTIPLICATIVE, NOT A FIXED AMOUNT. A wheel notch that adds a quarter of a creature is a
 * crawl at the big end and a jump at the small end; a notch that multiplies feels the same
 * wherever you are, which is what every drawing program's brush size does.
 */
const WHEEL = 1.12

/**
 * The tools that can draw on the ground.
 *
 * ⚠️ NOT EVERY TOOL THE PAINT ROOM HAS, and the two that are missing are missing for a
 * reason rather than for time. FILL is the important one: a fill is replayed as a flood at
 * whatever size the canvas happens to be, so a shape whose outline is watertight on an
 * 800-pixel editor field can leak through a one-pixel gap when the same ground is baked three
 * thousand pixels wide for the park — and what leaks is the whole world. That is the exact
 * failure already reported once in the paint room, and it would be worse here because a map
 * is walked rather than looked at. TEXT is out because it wants a prompt and a baseline drag,
 * which is a second interaction for a thing nobody has asked to write on the grass.
 *
 * ⚠️ EVERYTHING HERE IS PURE GEOMETRY, so it scales exactly. What you draw on the field is
 * what the park bakes, at any size, with no replay that can decide differently.
 */
const INKS: Array<[Tool, string, string]> = [
  ['brush', '🖌', 'Brush'],
  ['marker', '🖍', 'Marker'],
  ['crayon', '🖤', 'Crayon'],
  ['spray', '💨', 'Spray'],
  ['pencil', '✏', 'Pencil'],
  ['line', '╱', 'Line'],
  ['rect', '▭', 'Box'],
  ['ellipse', '◯', 'Ellipse'],
  ['eraser', '🧽', 'Rub out'],
]

/** the ones that are a drag from one corner to another rather than a path */
const TWO_POINT = new Set<Tool>(['line', 'rect', 'ellipse'])

/**
 * Colours for ground.
 *
 * ⚠️ ITS OWN LIST RATHER THAN THE PAINT ROOM'S TWELVE, because the paint room's are picked to
 * be told apart on white paper and these are picked to be walked on. Grass, deep grass, water,
 * sand, dirt, path and stone are what a map is mostly made of, and getting to a believable
 * green by dragging a colour wheel is the sort of small tax that stops somebody starting.
 *
 * ⚠️ WITH FOUR BRIGHT ONES ON THE END, because it is not only terrain — a marked route or a
 * finish line is a map too, and a palette that only offers mud says otherwise.
 */
const GROUND_INK = [
  '#4a7c3f',
  '#2f5228',
  '#7aa25c',
  '#2f6f9e',
  '#5fb6d6',
  '#d8c48a',
  '#8b5a2b',
  '#6b6b6b',
  '#efefef',
  '#1b1b1b',
  '#e02020',
  '#f5a623',
]

/**
 * How fat a line is, said in creatures.
 *
 * ⚠️ DERIVED, LIKE EVERY OTHER MEASUREMENT ON THIS PAGE. A stroke's `w` is a fraction of the
 * canvas's SHORT side, and this canvas's short side is the whole world's height — so a number
 * typed here would mean nothing at all and would be wrong the day the park is resized. downBy
 * turns creature-heights into exactly that fraction, and it is the same function the fighting
 * code measures reach with.
 */
/** a size, said the way the rest of the page says sizes */
const say = (creatures: number) =>
  creatures < 1
    ? `${Math.round(creatures * 100)}% of a creature`
    : `${+creatures.toFixed(2)} creatures`

/** how far the pointer has to move before a path records another point — see simplifyDrawing */
const STEP = 0.0025
/** a path this long is already more detail than a world-sized stroke can show */
const MAX_POINTS = 400
/**
 * ⚠️ A CEILING WITH A REASON RATHER THAN A ROUND NUMBER. A map is capped at 200KB and the
 * ground is packed alongside the palette, so the real limit is bytes and the room already
 * reports those. This is the second one: it stops a single held-down press turning into a
 * document nobody can undo their way out of, and it is far above any hand-drawn map.
 */
const MAX_GROUND = 800

export function MapMaker() {
  const kept = useSyncExternalStore(subscribeGallery, gallery, gallery)
  /** the maps already kept, live — so one saved here is in this list without a reload */
  const mine = useSyncExternalStore(subscribeMaps, parkMaps, parkMaps)
  const [name, setName] = useState('')
  const [palette, setPalette] = useState<Drawing[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [pick, setPick] = useState(0)
  const [does, setDoes] = useState('past')
  const [high, setHigh] = useState(0.5)
  /** how wide a stamp is, IN CREATURES — the world-unit width is outBy of this */
  const [fat, setFat] = useState(FAT.start)
  const [erasing, setErasing] = useState(false)
  const [scatter, setScatter] = useState(true)
  const [said, setSaid] = useState<string | null>(null)
  const wide = outBy(fat)

  /** stamping things down, drawing the ground under them, or saying where you arrive */
  const [mode, setMode] = useState<'stamp' | 'draw' | 'spawn' | 'block'>('stamp')
  /**
   * ⚠️ A REF, NOT STATE, AND A TICK BESIDE IT. The grid is 23040 cells painted at
   * pointer speed; copying it on every move to satisfy React would be twenty-three thousand
   * bytes per frame for a picture React does not draw anyway — the canvas does. So the array
   * is mutated in place and a counter says when it changed, which is the same split the ground
   * already makes between `done` and what is on screen.
   */
  const cells = useRef<Uint8Array>(blankZone())
  const [blockTick, setBlockTick] = useState(0)
  const [blocking, setBlocking] = useState(true)
  const [zfat, setZfat] = useState(2)
  const [ground, setGround] = useState<Stroke[]>([])
  const [spawn, setSpawn] = useState<Spot | null>(null)
  const [tool, setTool] = useState<Tool>('brush')
  const [ink, setInk] = useState(GROUND_INK[0])
  const [nib, setNib] = useState(NIB.start)

  const field = useRef<HTMLDivElement | null>(null)
  const sheet = useRef<HTMLCanvasElement | null>(null)
  const fence = useRef<HTMLCanvasElement | null>(null)
  /**
   * ⚠️ TWO SURFACES, THE SAME WAY THE PAINT ROOM DOES IT. Everything committed is painted
   * once onto `done`; the stroke being dragged is drawn on a copy of it each move. Repainting
   * the whole ground on every pointermove would get slower with every line already there,
   * which is the one thing a drawing surface must not do.
   */
  const done = useRef<HTMLCanvasElement | null>(null)
  const live = useRef<Stroke | null>(null)
  /** where the last stamp of a drag went, so the next one keeps its distance — see `sow` */
  const sown = useRef<Spot | null>(null)
  /** whether a stamping drag is in progress — the drawing modes use `live` for the same job */
  const held = useRef(false)
  /** ⚠️ read inside a non-passive wheel listener, which is wired once and cannot re-close */
  const now = useRef({ mode, fat, nib, zfat })
  now.current = { mode, fat, nib, zfat }

  /**
   * ⚠️ CROPPED ONCE, HERE, AND MEMOISED. A stamp is the thing somebody drew, not the sheet
   * it was drawn on — see cropToInk. Doing it in a memo also keeps each cropped drawing's
   * identity stable, which is what lets `palette.indexOf` go on recognising a repeat stamp as
   * the same picture instead of adding a second copy of it.
   */
  const stamps = useMemo(
    () => kept.map((a) => ({ id: a.id, name: a.name, art: cropToInk(a.art) })),
    [kept],
  )
  const chosen = stamps[pick]?.art ?? null

  /**
   * The ground as a drawing.
   *
   * ⚠️ ITS PAPER IS THE WORLD, which is the one thing that has to be said here and nowhere
   * else. `ratio` is what every reader uses to know the shape of the page a drawing was made
   * on, and this page is the park — so a circle drawn on the field is a circle in the park,
   * and a stroke width that is a fraction of the short side is a fraction of the world's
   * height wherever it is later baked.
   */
  const inkDoc: Drawing | null = useMemo(
    () =>
      ground.length
        ? { v: 1, name: 'ground', ratio: MAP_GUIDE.paper, bg: null, strokes: ground }
        : null,
    [ground],
  )

  /* ⚠️ packed only when it actually changed, not on every render: see blockTick */
  const block = useMemo(
    () => (zoneIsEmpty(cells.current) ? null : packZone(cells.current)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockTick],
  )

  const doc: MapDoc | null = useMemo(
    () =>
      (palette.length && pieces.length) || inkDoc || block
        ? { v: 1, name: name.trim() || 'Map', palette, pieces, ground: inkDoc, spawn, block }
        : null,
    [name, palette, pieces, inkDoc, spawn, block],
  )
  const world = doc ? worldOf(doc) : null
  const bytes = doc ? mapBytes(doc) : 0

  /** everything already committed, onto the off-screen copy — only when it actually changes */
  const settle = useCallback(() => {
    const c = sheet.current
    if (!c) return
    const r = c.getBoundingClientRect()
    if (r.width < 2) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const pw = Math.round(r.width * dpr)
    const ph = Math.round(r.height * dpr)
    if (c.width !== pw || c.height !== ph) {
      c.width = pw
      c.height = ph
    }
    let back = done.current
    if (!back) {
      back = document.createElement('canvas')
      done.current = back
    }
    if (back.width !== pw || back.height !== ph) {
      back.width = pw
      back.height = ph
    }
    const bc = back.getContext('2d')
    if (!bc) return
    bc.setTransform(1, 0, 0, 1, 0, 0)
    if (inkDoc) paintDrawing(bc, inkDoc, pw, ph)
    else bc.clearRect(0, 0, pw, ph)
  }, [inkDoc])

  /** what you can see: everything committed, plus the one being dragged right now */
  const show = useCallback(() => {
    const c = sheet.current
    const back = done.current
    if (!c || !back) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(back, 0, 0)
    if (live.current) paintStroke(ctx, live.current, c.width, c.height)
  }, [])

  useEffect(() => {
    settle()
    show()
    /* ⚠️ a window listener rather than a ResizeObserver: the field is a percentage of the
       card and the card is a percentage of the page, so the only thing that changes its
       size is the window changing. An observer here would also be untestable — see CLAUDE.md */
    const again = () => {
      settle()
      show()
    }
    window.addEventListener('resize', again)
    return () => window.removeEventListener('resize', again)
  }, [settle, show])

  /**
   * The wheel resizes whatever you are about to put down.
   *
   * ⚠️ addEventListener WITH passive:false, NOT onWheel. React attaches wheel handlers
   * passively, and a passive listener may not call preventDefault — so through JSX the size
   * would change AND the page would scroll out from under the field at the same time. This is
   * the one thing here that cannot be written as a prop.
   *
   * ⚠️ AND IT READS ITS SETTINGS FROM A REF. Wired once, so a listener closing over
   * `fat` would go on adding to whatever `fat` was when the field mounted.
   */
  useEffect(() => {
    const el = field.current
    if (!el) return
    const turn = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      const { mode: m, fat: f, nib: n, zfat: z } = now.current
      if (m === 'spawn') return
      e.preventDefault()
      const by = e.deltaY < 0 ? WHEEL : 1 / WHEEL
      const fat = (v: number) =>
        Math.max(FAT.min, Math.min(FAT.max, Math.round((v * by) / FAT.step) * FAT.step))
      if (m === 'stamp') setFat(fat(f))
      else if (m === 'block') setZfat(fat(z))
      else setNib(Math.max(NIB.min, Math.min(NIB.max, Math.round((n * by) / NIB.step) * NIB.step)))
    }
    el.addEventListener('wheel', turn, { passive: false })
    return () => el.removeEventListener('wheel', turn)
  }, [])

  /**
   * The painted zone, drawn over everything.
   *
   * ⚠️ OVER, NOT UNDER, and only while you are painting it. It is a RULE rather than
   * scenery — nothing in the park will ever draw it — so on the field it has to be visible
   * through whatever it covers, which is the one job a translucent wash over the top does and
   * a layer underneath cannot. Hidden in the other modes because a red film over the whole map
   * is not what you want to look at while placing a tree.
   */
  useEffect(() => {
    const c = fence.current
    if (!c) return
    const r = c.getBoundingClientRect()
    if (r.width < 2) return
    if (c.width !== ZONE.w || c.height !== ZONE.h) {
      c.width = ZONE.w
      c.height = ZONE.h
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, ZONE.w, ZONE.h)
    /* ⚠️ one cell is one PIXEL of this canvas and CSS stretches it to the field. Drawing
       rectangles at field resolution would be 23040 fillRects a frame; this is one image the
       size of the grid, and image-rendering:pixelated keeps the edges honest. */
    const img = ctx.createImageData(ZONE.w, ZONE.h)
    const g = cells.current
    for (let i = 0; i < g.length; i++) {
      if (!g[i]) continue
      const o = i * 4
      img.data[o] = 220
      img.data[o + 1] = 60
      img.data[o + 2] = 60
      img.data[o + 3] = 150
    }
    ctx.putImageData(img, 0, 0)
  }, [blockTick, mode])

  /** where a press landed, as a fraction of the world */
  const spotOf = (e: React.PointerEvent | React.MouseEvent) => {
    const r = field.current?.getBoundingClientRect()
    if (!r || r.width < 2) return null
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    }
  }

  /**
   * ⚠️ THE PRESS IS SPENT ON ONE THING. Stamping and removing are a MODE rather than two
   * buttons on the same press, because a click that both places a rock and might delete the one
   * underneath is a click nobody can predict — the lesson the paint room's text tool already
   * learned about a control that swallowed the next drag.
   */

  /**
   * Put one down.
   *
   * ⚠️ AND A DRAG PUTS DOWN MANY, which is what a brush made out of a drawing IS. Asked for as
   * making brushes from the things you draw, and the honest reading of it is not a new kind of
   * ink: it is the stamp you already have, repeated along the gesture. That means a forest of
   * fifty trees is fifty positions and ONE picture in the palette, every one of them a real
   * place you can walk into — which a painted forest could never be.
   *
   * ⚠️ SPACED BY ITS OWN WIDTH, so the gap looks the same whatever size you are stamping.
   * A fixed spacing lays big trees far apart and small ones in a solid smear.
   */
  const sow = (s: Spot) => {
    if (!chosen) return
    if (pieces.length >= MAX_PIECES) {
      setSaid('That is as many things as one map holds.')
      return
    }
    /* ⚠️ the drawing joins the palette once, on its first stamp, and every later copy is an index */
    let at = palette.indexOf(chosen)
    if (at < 0) {
      at = palette.length
      setPalette((was) => (was.includes(chosen) ? was : [...was, chosen]))
    }
    const row = DOES.find((d) => d[0] === does) ?? DOES[0]
    /**
     * ⚠️ SCATTER IS A CHOICE, because both answers are right for different things. Dragging
     * a hedge wants them in a line and evenly sized; dragging a wood wants them not to look
     * planted. Off by default would make the first drag of a forest look like fence posts.
     */
    const jig = scatter ? 1 + (Math.random() - 0.5) * 0.45 : 1
    const off = scatter ? wide * 0.22 : 0
    sown.current = s
    setPieces((was) => [
      ...was,
      {
        art: at,
        at: {
          x: Math.max(0, Math.min(1, s.x + (Math.random() - 0.5) * off)),
          y: Math.max(0, Math.min(1, s.y + (Math.random() - 0.5) * off)),
        },
        wide: wide * jig,
        kind: row[2],
        top: row[0] === 'stand' ? high : 0,
      },
    ])
    setSaid(null)
  }

  /** take off whatever the press is over — and keep taking them off while the press moves */
  const rub = (s: Spot) => {
    setPieces((was) => {
      /* the nearest piece to the press, within its own half-width — so a miss removes nothing */
      let best = -1
      let near = Infinity
      was.forEach((p, i) => {
        const d = Math.hypot(p.at.x - s.x, p.at.y - s.y)
        if (d < p.wide / 2 && d < near) {
          near = d
          best = i
        }
      })
      return best < 0 ? was : was.filter((_, i) => i !== best)
    })
  }

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const s = spotOf(e)
    if (!s) return
    /* ⚠️ capture on every mode, not only drawing. A drag that lays a line of trees has exactly
       the same reason to keep receiving moves after the pointer leaves the field. */
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* it still works; it just stops at the edge */
    }
    if (mode === 'spawn') {
      setSpawn(s)
      setSaid('That is where you will arrive.')
      return
    }
    if (mode === 'stamp') {
      held.current = true
      if (erasing) rub(s)
      else sow(s)
      return
    }
    if (mode === 'block') {
      held.current = true
      brushZone(cells.current, s.x, s.y, outBy(zfat) / 2, blocking)
      setBlockTick((n) => n + 1)
      return
    }
    if (ground.length >= MAX_GROUND) {
      setSaid(
        'That is as much ink as one map holds. Rub some out, or keep this one and start another.',
      )
      return
    }
    live.current = { t: tool, c: ink, a: 1, w: downBy(nib), p: [s.x, s.y] }
    show()
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (held.current) {
      const s = spotOf(e)
      if (!s) return
      if (mode === 'block') {
        brushZone(cells.current, s.x, s.y, outBy(zfat) / 2, blocking)
        setBlockTick((n) => n + 1)
        return
      }
      if (erasing) return rub(s)
      /* far enough from the last one to be a separate thing rather than a smear */
      const last = sown.current
      const gap = wide * (scatter ? 0.72 : 0.92)
      if (!last || Math.hypot(s.x - last.x, s.y - last.y) >= gap) sow(s)
      return
    }
    const k = live.current
    if (!k) return
    const s = spotOf(e)
    if (!s) return
    if (TWO_POINT.has(k.t)) {
      /* a box is where you started and where you are; there is never a third point */
      k.p = [k.p[0], k.p[1], s.x, s.y]
    } else {
      const n = k.p.length
      const far = Math.hypot(s.x - k.p[n - 2], s.y - k.p[n - 1])
      if (far < STEP || n / 2 >= MAX_POINTS) return
      k.p.push(s.x, s.y)
    }
    show()
  }

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    const k = live.current
    live.current = null
    held.current = false
    sown.current = null
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* nothing to release */
    }
    if (!k) return
    /**
     * ⚠️ A TAP IS A DOT, NOT NOTHING. A two-point tool dragged nowhere would be a zero-sized
     * box, and a path of one point has no direction to be drawn along — so both get a second
     * point a hair away, which is what every freehand tool here already draws for a tap.
     */
    if (k.p.length < 4) k.p = [k.p[0], k.p[1], k.p[0] + 0.0004, k.p[1] + 0.0004]
    setGround((g) => [...g, k])
    setSaid(null)
  }

  const keep = () => {
    if (!doc) return setSaid('Put something on it first.')
    if (bytes > MAP_LIMIT.bytes)
      return setSaid(
        `Too big to keep — ${Math.round(bytes / 1024)}KB of ${Math.round(MAP_LIMIT.bytes / 1024)}KB. Use simpler drawings.`,
      )
    setSaid(saveMap(doc) ? `Kept "${doc.name}".` : 'That could not be kept.')
  }

  const drawing = mode === 'draw'

  return (
    <section className="card map-maker">
      <div className="map-bar">
        <label className="sr-only" htmlFor="map-name">
          What to call it
        </label>
        <input
          id="map-name"
          className="map-name"
          value={name}
          placeholder="Name this place"
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
        />
        {/* ⚠️ IT SAYS WHICH IT IS. Keeping under a name already taken REPLACES it — the rule
            the gallery and the minions share — and a button that said "keep" either way would
            be the only warning somebody got that their other map had gone. */}
        <button className="btn" onClick={keep} disabled={!doc}>
          {mine.some((m) => m.name.toLowerCase() === (name.trim() || 'Map').toLowerCase())
            ? '⬇ Replace that map'
            : '⬇ Keep the map'}
        </button>
        <span className="muted map-count">
          {pieces.length} thing{pieces.length === 1 ? '' : 's'}
          {ground.length ? ` · ${ground.length} line${ground.length === 1 ? '' : 's'}` : ''}
          {world ? ` · ${world.across}×${world.down} screens` : ''}
        </span>
      </div>

      {/* ⚠️ THE TWO JOBS ARE THE FIRST THING ON THE PAGE, because they decide what every
          control under them means. Tabs rather than a toggle: a toggle says "on or off" about
          one thing, and these are two different things you can be doing. */}
      <div className="map-modes" role="group" aria-label="What you are doing">
        <button
          className={'btn' + (drawing ? '' : ' is-on')}
          aria-pressed={!drawing}
          onClick={() => setMode('stamp')}
        >
          🧷 Stamp things
        </button>
        <button
          className={'btn' + (drawing ? ' is-on' : '')}
          aria-pressed={drawing}
          onClick={() => {
            setMode('draw')
            setErasing(false)
          }}
        >
          🖌 Draw the ground
        </button>
        {/* ⚠️ ITS OWN TAB, though it is one press, because it is a different KIND of press
            — it puts nothing on the map, it answers a question about the map. Folded in beside
            the eraser it would be a third thing the same click could mean. */}
        {/* ⚠️ ITS OWN TAB, AND NOT A KIND OF STAMP. Where you may walk is a fact about
            the MAP; a solid stamp is a property of one thing standing on it. Reported as a
            solid you could get round the edges of, which is what a box round a picture always
            is — a tree blocks its empty corners and two trees leave a gap between them. */}
        <button
          className={'btn' + (mode === 'block' ? ' is-on' : '')}
          aria-pressed={mode === 'block'}
          onClick={() => {
            setMode('block')
            setErasing(false)
          }}
        >
          🚧 No-walk zones
        </button>
        <button
          className={'btn' + (mode === 'spawn' ? ' is-on' : '')}
          aria-pressed={mode === 'spawn'}
          onClick={() => {
            setMode('spawn')
            setErasing(false)
          }}
        >
          ◎ Where you start
        </button>
      </div>

      {mode === 'block' ? (
        <div className="map-row" role="group" aria-label="Painting where you cannot walk">
          <button
            className={'btn' + (blocking ? ' is-on' : '')}
            aria-pressed={blocking}
            onClick={() => setBlocking(true)}
          >
            🚧 Block
          </button>
          <button
            className={'btn' + (!blocking ? ' is-on' : '')}
            aria-pressed={!blocking}
            onClick={() => setBlocking(false)}
          >
            🧽 Open it back up
          </button>
          <label className="map-size">
            <span className="muted">Fat</span>
            <input
              type="range"
              min={FAT.min}
              max={FAT.max}
              step={FAT.step}
              value={zfat}
              onChange={(e) => setZfat(Number(e.target.value))}
            />
            <span className="muted map-size-say">{say(zfat)}</span>
          </label>
          <button
            className="btn"
            disabled={!block}
            onClick={() => {
              cells.current = blankZone()
              setBlockTick((n) => n + 1)
              setSaid('Every zone is gone — the whole map is walkable again.')
            }}
          >
            Clear the zones
          </button>
        </div>
      ) : mode === 'spawn' ? null : drawing ? (
        <>
          <div className="map-row" role="group" aria-label="What to draw with">
            {INKS.map(([t, icon, label]) => (
              <button
                key={t}
                className={'map-tool' + (t === tool ? ' is-on' : '')}
                aria-pressed={t === tool}
                aria-label={label}
                title={label}
                onClick={() => setTool(t)}
              >
                {icon}
              </button>
            ))}
            <label className="map-size">
              <span className="muted">Fat</span>
              <input
                type="range"
                min={NIB.min}
                max={NIB.max}
                step={NIB.step}
                value={nib}
                onChange={(e) => setNib(Number(e.target.value))}
              />
              <span className="muted map-size-say">{say(nib)}</span>
            </label>
            <button
              className="btn"
              disabled={!ground.length}
              onClick={() => setGround((g) => g.slice(0, -1))}
            >
              ↶ Undo
            </button>
            <button
              className="btn"
              disabled={!ground.length}
              onClick={() => {
                setGround([])
                setSaid('The ground is bare again.')
              }}
            >
              Clear the ground
            </button>
          </div>
          {/* ⚠️ THE ERASER DOES NOT USE A COLOUR, so the swatches go when it is picked rather
              than sitting there implying one of them is about to be rubbed out. */}
          {tool !== 'eraser' && (
            <div className="map-row" role="group" aria-label="What colour">
              {GROUND_INK.map((c) => (
                <button
                  key={c}
                  className={'map-ink-pick' + (c === ink ? ' is-on' : '')}
                  style={{ background: c }}
                  aria-pressed={c === ink}
                  aria-label={c}
                  title={c}
                  onClick={() => setInk(c)}
                />
              ))}
              <label className="map-ink-any" title="Any colour">
                <span className="sr-only">Any colour</span>
                <input type="color" value={ink} onChange={(e) => setInk(e.target.value)} />
              </label>
            </div>
          )}
        </>
      ) : (
        <>
          {/* ⚠️ THE PICTURES, NOT THEIR NAMES — the same reason the gallery menu shows thumbnails:
              a list of "rock" and "rock1" is a list you have to open twice to tell apart. */}
          {kept.length === 0 ? (
            <p className="muted">
              Nothing drawn yet — make something in Paint and it turns up here. You can still draw
              the ground.
            </p>
          ) : (
            <div className="map-palette" role="group" aria-label="What to stamp">
              {stamps.map((a, i) => (
                <button
                  key={a.id}
                  className={'map-stamp' + (i === pick ? ' is-on' : '')}
                  aria-pressed={i === pick}
                  title={a.name}
                  onClick={() => {
                    setPick(i)
                    setErasing(false)
                  }}
                >
                  <ArtThumb art={a.art} w={44} h={34} />
                </button>
              ))}
            </div>
          )}

          <div className="map-row">
            <label>
              <span className="sr-only">What it does</span>
              <select value={does} onChange={(e) => setDoes(e.target.value)}>
                {DOES.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {does === 'stand' && (
              <label>
                <span className="sr-only">How high</span>
                <select value={high} onChange={(e) => setHigh(Number(e.target.value))}>
                  {HIGHS.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="map-size">
              <span className="muted">Size</span>
              <input
                type="range"
                min={FAT.min}
                max={FAT.max}
                step={FAT.step}
                value={fat}
                onChange={(e) => setFat(Number(e.target.value))}
              />
              <span className="muted map-size-say">{say(fat)}</span>
            </label>
            {/* the difference between a hedge and a wood, and both are things people want */}
            <button
              className={'btn' + (scatter ? ' is-on' : '')}
              aria-pressed={scatter}
              title="Vary the size and spacing as you drag"
              onClick={() => setScatter((v) => !v)}
            >
              ✧ Scatter
            </button>
            <button
              className={'btn' + (erasing ? ' is-on' : '')}
              aria-pressed={erasing}
              onClick={() => setErasing((v) => !v)}
            >
              {erasing ? '✕ Taking things off' : '✕ Take things off'}
            </button>
          </div>
        </>
      )}

      {/* ⚠️ THE FIELD IS THE MAP, one press one thing. It is the world's own shape rather than
          whatever the card is wide, so where you put something is where it is — the one promise
          the first map maker made and kept, and the only part of it worth carrying over. */}
      <div
        ref={field}
        className={
          'map-field' +
          (erasing && mode === 'stamp' ? ' is-erasing' : '') +
          (mode === 'spawn' ? ' is-placing' : '') +
          /* ⚠️ a STAMPING drag is a drag too, so touch-action has to be none for it as well —
             see .map-field.is-drawing, which is why this is not just `drawing` any more */
          (mode !== 'spawn' ? ' is-drawing' : '')
        }
        /* ⚠️ THE WORLD'S SHAPE, NOT A SQUARE. Three screens by three is square in screenfuls
           and 16:10 in pixels — see MAP_GUIDE.paper, which is where that sum lives. */
        style={{ aspectRatio: String(MAP_GUIDE.paper) }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        role="presentation"
      >
        {/* ⚠️ UNDER EVERYTHING, because it is the ground. It takes no pointer events either:
            the press belongs to the field, which is the only thing that knows which mode it
            is in. */}
        <canvas ref={sheet} className="map-ink" aria-hidden />
        {/* ⚠️ HOW BIG A SCREEN IS, DRAWN ON THE FIELD. This field is the WHOLE world, which
            is three screenfuls across — so two stamps at opposite ends are nowhere near each
            other and nothing said so. That is the same mistake the old paint-room guide was
            built to stop ("every test map came out bigger than any landmark the real park
            has"), which is why this is that guide rather than a second one: same lines, same
            creature-inside-a-place reference, derived from the same PARK numbers. */}
        <MapGuide />
        {/* only while you are painting it — see the effect that draws this */}
        {mode === 'block' && <canvas ref={fence} className="map-fence" aria-hidden />}
        {/* ⚠️ ON TOP OF THE PIECES, because it is the one thing on this field that is not
            scenery — it answers "where do I come in", and a tree drawn over it would hide the
            answer. Not in the DOM at all until it has been set, so an unset map says so by
            showing nothing rather than by parking a marker in the middle. */}
        {spawn && (
          <span
            className="map-spawn"
            style={{ left: `${spawn.x * 100}%`, top: `${spawn.y * 100}%` }}
            aria-hidden
          />
        )}
        {pieces.map((p, i) => {
          const art = palette[p.art]
          if (!art) return null
          const ar = art.ratio > 0.05 && art.ratio < 20 ? art.ratio : 1
          return (
            <span
              key={i}
              className={'map-piece is-' + p.kind}
              style={{
                left: `${p.at.x * 100}%`,
                top: `${p.at.y * 100}%`,
                width: `${p.wide * 100}%`,
                /* ⚠️ RIGHT ONLY BECAUSE THE PAPER IS THE WORLD'S SHAPE. `aspect-ratio` keeps
                   the drawing's own proportions in PIXELS, which is the park's answer exactly
                   when a pixel here means the same distance in both directions. On the square
                   field this used to sit on, every stamp was four fifths as tall as it would
                   really be — see MAP_GUIDE.paper. */
                aspectRatio: String(ar),
              }}
              aria-hidden
            >
              <ArtThumb art={art} w={220} h={Math.round(220 / ar)} />
            </span>
          )
        })}
      </div>

      {said && (
        <p className="muted" role="status">
          {said}
        </p>
      )}
      {/**
        ⚠️ THE ONES ALREADY KEPT, WITH A WAY OUT OF THEM. The store holds twelve and had no
        way to delete one or to fix one after keeping it — a cap with no door, and a typo in a
        name meaning start again. Pressing one loads it back in to work on; the ✕ puts it out.
      */}
      {mine.length > 0 && (
        <div className="map-kept">
          <span className="muted map-count">
            {mine.length} of {MAP_LIMIT.items} kept
          </span>
          {mine.map((m) => (
            <span key={m.id} className="map-kept-one">
              <button
                className="map-kept-open"
                title={`Work on ${m.name}`}
                onClick={() => {
                  setName(m.doc.name)
                  setPalette(m.doc.palette)
                  setPieces(m.doc.pieces)
                  setGround(m.doc.ground?.strokes ?? [])
                  setSpawn(m.doc.spawn)
                  cells.current = readZone(m.doc.block) ?? blankZone()
                  setBlockTick((n) => n + 1)
                  setErasing(false)
                  setSaid(`Working on "${m.doc.name}".`)
                }}
              >
                🗺 {m.name}
                <span className="muted"> · {m.doc.pieces.length}</span>
              </button>
              <button
                className="map-kept-bin"
                aria-label={`Delete ${m.name}`}
                title={`Delete ${m.name}`}
                onClick={() => {
                  removeMap(m.id)
                  setSaid(`Deleted "${m.name}".`)
                }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <p className="muted map-note">
        {mode === 'block'
          ? 'Paint where nobody may walk. It is never drawn in the park — it is the rule, and the scenery is the picture, so put something there people can see.'
          : mode === 'spawn'
            ? 'Press the field to say where you arrive. Without one you start in the middle of everything you placed.'
            : mode === 'draw'
              ? 'Drag on the field to draw. The whole field is the park, so a line across it is a walk of three screens. The wheel changes how fat the line is.'
              : 'Pick a picture, then press to put it down — or DRAG to lay a line of them. The same picture can go down as many times as you like, and is only kept once. The wheel changes the size.'}
      </p>
    </section>
  )
}
