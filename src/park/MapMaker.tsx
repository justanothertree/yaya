import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArtThumb } from '../draw/ArtThumb'
import { gallery, subscribeGallery } from '../draw/gallery'
import { paintDrawing, paintStroke, type Drawing, type Stroke, type Tool } from '../draw/strokes'
import { MapGuide } from './MapGuide'
import { cropToInk, MAX_PIECES, worldOf, type Door, type MapDoc, type Piece } from './mapDoc'
import { MAP_GUIDE, type PlaceKind } from './mapOf'
import { mapBytes, MAP_LIMIT, parkMaps, removeMap, saveMap, subscribeMaps } from './maps'
import { downBy, outBy } from './strike'
import { PARK, type Spot } from './walk'
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
 * How far in you can go, and how the wheel steps.
 *
 * ⚠️ THE FIELD IS THREE SCREENS ACROSS AND THE CARD IS ONE COLUMN WIDE, which is the whole
 * reason this exists — reported as there being no way to zoom in or move around with any of the
 * map tools. At 1× a creature is about eight pixels tall on a desk and four on a phone, so
 * placing anything small was aiming at a speck. Six times in makes a creature the size it is in
 * the game, which is as far as anybody needs to go.
 */
const ZOOM = { min: 1, max: 6, step: 1.18 }

/** how big a stamp is baked before being blitted — the same argument as SPRITE in ParkRoom */
const SPRITE = 192

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
  const [mode, setMode] = useState<'stamp' | 'draw' | 'spawn' | 'block' | 'door'>('stamp')
  const [doors, setDoors] = useState<Door[]>([])
  /** which kept map the next door leads to; '' until one is chosen */
  const [leadsTo, setLeadsTo] = useState('')
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
  const [alpha, setAlpha] = useState(1)
  /**
   * ⚠️ REDO IS A SECOND STACK, and undo is what fills it. The paint room has had this
   * since it had undo; the ground shipped with a one-way Undo, which makes the button dangerous
   * rather than safe — an undo you cannot take back is a delete with a friendly name.
   */
  const [redo, setRedo] = useState<Stroke[]>([])

  const field = useRef<HTMLDivElement | null>(null)
  const stage = useRef<HTMLDivElement | null>(null)
  const sheet = useRef<HTMLCanvasElement | null>(null)
  const props = useRef<HTMLCanvasElement | null>(null)
  const fence = useRef<HTMLCanvasElement | null>(null)
  /**
   * What part of the world you are looking at: the world fraction at the field's top-left, and
   * how far in.
   *
   * ⚠️ THE SAME MODEL THE PAINT ROOM USES, on purpose — `off` plus `scale`, zoom toward the
   * pointer, and an offset clamped to `1 - 1/scale` so the view can never leave the paper. It
   * is the room next door and somebody moving between them should not have to learn a second
   * set of rules.
   *
   * ⚠️ A REF, BECAUSE PANNING IS SIXTY FRAMES A SECOND. The zoom is mirrored into state for
   * the readout; the offset never is, and the things that depend on it are moved by hand in
   * `place`.
   */
  const view = useRef({ x: 0, y: 0, z: 1 })
  const [zoom, setZoom] = useState(1)
  /** a middle-button or space-held drag that moves the view instead of drawing on it */
  const shove = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const [spacing, setSpacing] = useState(false)
  /**
   * Every finger currently down, and what a two-finger gesture started from.
   *
   * ⚠️ BECAUSE A PHONE HAS NO ctrl KEY AND NO MIDDLE BUTTON, which is where the other
   * two ways in fail — and the phone is where this matters most: the field is three hundred
   * pixels wide there and holds three screenfuls of park. Without this, zooming in on a phone
   * would work and then strand you, able to see a quarter of the map and unable to reach the
   * rest.
   */
  const fingers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{
    d: number
    cx: number
    cy: number
    z: number
    wx: number
    wy: number
  } | null>(null)
  /** each palette drawing rasterised once, then blitted wherever it was stamped */
  const sprites = useRef(new Map<Drawing, HTMLCanvasElement>())
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
  /** how many pieces there were when this stamping gesture began, so a pinch can undo it */
  const sank = useRef(0)
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
        ? {
            v: 1,
            name: name.trim() || 'Map',
            palette,
            pieces,
            ground: inkDoc,
            spawn,
            block,
            doors,
          }
        : null,
    [name, palette, pieces, inkDoc, spawn, block, doors],
  )
  /**
   * ⚠️ THE PARK IS THE SIZE IT IS, AND THIS SAID OTHERWISE. It read out worldOf — how
   * big a world would hold everything placed — as though that were the size you get, so
   * stamping something big against the right edge made it announce "4×3 screens" while the park
   * has been a fixed three by three throughout. A readout that promises room nobody can walk in
   * is worse than no readout.
   *
   * So it says the park's own size, and uses worldOf for the thing worldOf is actually good
   * for: noticing that a piece hangs over the edge of the world. Which is worth knowing — the
   * walker is held inside 0..1, so the far half of that piece is somewhere nobody can stand.
   */
  const needs = doc ? worldOf(doc) : null
  const overEdge = !!needs && (needs.across > PARK.across || needs.down > PARK.down)
  const bytes = doc ? mapBytes(doc) : 0

  /**
   * Everything already committed, onto the off-screen copy — only when it actually changes.
   *
   * ⚠️ THE CANVAS IS THE FIELD, AND THE VIEW IS A TRANSFORM ON IT. The obvious way to zoom is
   * to make the canvas as big as the zoomed world and let CSS scale it, and it is wrong twice:
   * at six times in it would be a fifty-megapixel buffer, and it would be a six-times
   * magnification of pixels drawn for one — soft edges on work somebody zoomed in to do
   * precisely. Drawing through a transform means every zoom level is rendered at the screen's
   * own resolution and the buffer never changes size.
   *
   * ⚠️ AND paintDrawing's WIDTH IS THE ZOOMED WORLD, not the field, which is what makes a
   * stroke's width scale with the zoom — `w` is a fraction of the short side, so handing it the
   * field's size would draw hairlines at 6× on a picture whose lines are a creature thick.
   */
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
    bc.clearRect(0, 0, pw, ph)
    if (inkDoc) {
      const { x, y, z } = view.current
      bc.translate(-x * z * pw, -y * z * ph)
      paintDrawing(bc, inkDoc, pw * z, ph * z)
    }
  }, [inkDoc])

  /**
   * Every stamped piece, on one canvas.
   *
   * ⚠️ THE SAME ARGUMENT Scenery MAKES IN THE PARK, and it became true here the moment the
   * piece limit went from four hundred to two thousand: each one was an element carrying its own
   * ArtThumb canvas, which is two thousand canvases in a card, rebuilt by React whenever the
   * view moved. A palette holds at most twenty-four pictures however many pieces there are, so
   * this is twenty-four bakes and however many drawImage calls survive the cull.
   */
  const stand = useCallback(() => {
    const c = props.current
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
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, pw, ph)
    const { x, y, z } = view.current
    if (sprites.current.size > 48) sprites.current.clear()
    for (const p of pieces) {
      const art = palette[p.art]
      if (!art) continue
      const ar = art.ratio > 0.05 && art.ratio < 20 ? art.ratio : 1
      /* a width in world-x is that fraction of the zoomed world; the height follows the
         picture's own proportions, which is right because the field is the world's shape */
      const mw = p.wide * z * pw
      const mh = mw / ar
      const cx = (p.at.x - x) * z * pw
      const cy = (p.at.y - y) * z * ph
      if (cx + mw / 2 < 0 || cx - mw / 2 > pw || cy + mh / 2 < 0 || cy - mh / 2 > ph) continue
      let sp = sprites.current.get(art)
      if (!sp) {
        sp = document.createElement('canvas')
        sp.width = SPRITE
        sp.height = Math.max(1, Math.round(SPRITE / ar))
        const sc = sp.getContext('2d')
        if (sc) paintDrawing(sc, art, sp.width, sp.height)
        sprites.current.set(art, sp)
      }
      ctx.drawImage(sp, cx - mw / 2, cy - mh / 2, mw, mh)
      if (p.kind === 'wall') {
        ctx.save()
        ctx.strokeStyle = 'rgba(200,180,120,.55)'
        ctx.setLineDash([4, 4])
        ctx.strokeRect(cx - mw / 2, cy - mh / 2, mw, mh)
        ctx.restore()
      }
    }
  }, [pieces, palette])

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
    if (live.current) {
      /* the same transform `settle` painted the committed strokes with, or the one under your
         hand would land somewhere else entirely the moment you zoomed in */
      const { x, y, z } = view.current
      ctx.translate(-x * z * c.width, -y * z * c.height)
      paintStroke(ctx, live.current, c.width * z, c.height * z)
    }
  }, [])

  /** put the world layer where the view says, without asking React to redraw two thousand things */
  const place = useCallback(() => {
    const w = stage.current
    if (!w) return
    const { x, y, z } = view.current
    w.style.width = `${z * 100}%`
    w.style.height = `${z * 100}%`
    w.style.left = `${-x * z * 100}%`
    w.style.top = `${-y * z * 100}%`
  }, [])

  const redraw = useCallback(() => {
    place()
    settle()
    show()
    stand()
  }, [place, settle, show, stand])

  /** the view can never leave the paper: at 1x it IS the paper, further in it can roam */
  const rein = (z: number) => {
    const span = 1 - 1 / z
    view.current.x = Math.max(0, Math.min(span, view.current.x))
    view.current.y = Math.max(0, Math.min(span, view.current.y))
  }

  /**
   * ⚠️ TOWARD THE POINTER, NOT THE MIDDLE. Zooming about the centre slides the thing you were
   * looking at off to one side and you spend the whole time chasing it — the same note the paint
   * room's wheel carries, and the same arithmetic.
   */
  const closer = (to: number, fx = 0.5, fy = 0.5) => {
    const now = view.current
    /* going all the way out has only one answer for where the view sits, and it is the corner */
    if (to <= ZOOM.min) {
      now.x = 0
      now.y = 0
      now.z = 1
      setZoom(1)
      redraw()
      return
    }
    const next = Math.max(ZOOM.min, Math.min(ZOOM.max, to))
    const wx = now.x + fx / now.z
    const wy = now.y + fy / now.z
    now.x = wx - fx / next
    now.y = wy - fy / next
    now.z = next
    rein(next)
    setZoom(next)
    redraw()
  }
  /**
   * ⚠️ REACHED THROUGH A REF BY THE WHEEL LISTENER, which is wired once. Called
   * directly it would be the `closer` from the first render forever, holding the first `stand`
   * — so zooming would repaint the pieces you had when the field mounted, which is none.
   */
  const zoomer = useRef(closer)
  zoomer.current = closer

  useEffect(() => {
    redraw()
    /* ⚠️ a window listener rather than a ResizeObserver: the field is a percentage of the
       card and the card is a percentage of the page, so the only thing that changes its
       size is the window changing. An observer here would also be untestable — see CLAUDE.md */
    window.addEventListener('resize', redraw)
    return () => window.removeEventListener('resize', redraw)
  }, [redraw])

  /**
   * ⚠️ SPACE IS HELD, NOT PRESSED, which is why this is a key listener and not a button.
   * Every mode already spends a drag on something — stamping, drawing, painting a zone — so
   * the pan gesture has to be one that cannot be confused with any of them. Space-drag and the
   * middle button are what every drawing program uses for exactly this reason.
   */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const t = e.target as HTMLElement | null
      /* not while somebody is typing the map's name */
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      setSpacing(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacing(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

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
      e.preventDefault()
      /**
       * ⚠️ PLAIN WHEEL RESIZES AND ctrl/⌘ ZOOMS, which is the opposite way round from the
       * paint room next door — deliberately, and it is the one place the two rooms differ.
       * Resizing what you are about to put down was asked for on the bare wheel, and taking it
       * back to make room for zoom would be undoing the thing that was wanted. The modifier is
       * the browser's own zoom gesture, so it is the one people already reach for.
       */
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect()
        zoomer.current(
          view.current.z * (e.deltaY < 0 ? ZOOM.step : 1 / ZOOM.step),
          (e.clientX - r.left) / r.width,
          (e.clientY - r.top) / r.height,
        )
        return
      }
      const { mode: m, fat: f, nib: n, zfat: z } = now.current
      if (m === 'spawn' || m === 'door') return
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

  /**
   * Where a press landed IN THE WORLD, not on the screen.
   *
   * ⚠️ THROUGH THE VIEW, or everything would land where the cursor is rather than where
   * it is pointing the moment you zoom in — the inverse of what `place` and the canvases do to
   * put the world on screen. The paint room's `at` is the same three lines for the same reason.
   */
  const spotOf = (e: React.PointerEvent | React.MouseEvent) => {
    const r = field.current?.getBoundingClientRect()
    if (!r || r.width < 2) return null
    const { x, y, z } = view.current
    return {
      x: Math.max(0, Math.min(1, x + (e.clientX - r.left) / r.width / z)),
      y: Math.max(0, Math.min(1, y + (e.clientY - r.top) / r.height / z)),
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
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    /**
     * ⚠️ A SECOND FINGER CANCELS THE FIRST ONE'S WORK. Putting two fingers on a drawing
     * surface means "move the paper", never "draw two lines" — and the stroke already begun is
     * thrown away rather than committed, because it was the beginning of a gesture that turned
     * out to be a pinch. Committing it would leave a stray mark every time somebody zoomed.
     */
    if (fingers.current.size === 2) {
      const [a, b] = [...fingers.current.values()]
      const r = field.current?.getBoundingClientRect()
      live.current = null
      /* ⚠️ AND THE STAMP THE FIRST FINGER ALREADY PUT DOWN GOES WITH IT. A touch places
         one immediately — that is what makes a tap work — so reaching in to zoom left a tree
         behind every time. The count at the start of the gesture is the whole undo. */
      if (held.current) setPieces((was) => was.slice(0, sank.current))
      held.current = false
      sown.current = null
      shove.current = null
      if (r && r.width > 1) {
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        const { x, y, z } = view.current
        pinch.current = {
          d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          cx,
          cy,
          z,
          /* the world point between the fingers, which is the one that must not move */
          wx: x + (cx - r.left) / r.width / z,
          wy: y + (cy - r.top) / r.height / z,
        }
      }
      redraw()
      return
    }
    if (fingers.current.size > 2) return
    /**
     * ⚠️ THE MIDDLE BUTTON, OR SPACE HELD, AND NOTHING ELSE. Every mode already spends
     * its drag: left-drag stamps a line, or draws, or paints a zone. A pan that shared any of
     * those would be a gesture you could not predict — the lesson the erase MODE already
     * learned about a press meaning two things.
     */
    if (e.button === 1 || (spacing && e.button === 0)) {
      /* the browser's autoscroll steals the middle button unless this is stopped */
      e.preventDefault()
      shove.current = { x: e.clientX, y: e.clientY, ox: view.current.x, oy: view.current.y }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* the drag still works while the pointer stays inside */
      }
      return
    }
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
    if (mode === 'door') {
      if (!leadsTo) {
        setSaid('Choose which map it leads to first.')
        return
      }
      if (doors.length >= 8) {
        setSaid('Eight doors is as many as one map holds.')
        return
      }
      setDoors((was) => [...was, { at: s, wide: outBy(3), to: leadsTo }])
      setSaid(`A door to "${leadsTo}".`)
      return
    }
    if (mode === 'stamp') {
      held.current = true
      sank.current = pieces.length
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
    live.current = { t: tool, c: ink, a: alpha, w: downBy(nib), p: [s.x, s.y] }
    show()
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (fingers.current.has(e.pointerId))
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const grip = pinch.current
    if (grip) {
      if (fingers.current.size < 2) return
      const [a, b] = [...fingers.current.values()]
      const r = field.current?.getBoundingClientRect()
      if (!r || r.width < 2) return
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      const z = Math.max(ZOOM.min, Math.min(ZOOM.max, (grip.z * d) / grip.d))
      /* keep the world point that was between the fingers between the fingers */
      view.current.z = z
      view.current.x = grip.wx - (cx - r.left) / r.width / z
      view.current.y = grip.wy - (cy - r.top) / r.height / z
      rein(z)
      setZoom(z)
      redraw()
      return
    }
    const push = shove.current
    if (push) {
      const r = field.current?.getBoundingClientRect()
      if (!r || r.width < 2) return
      const { z } = view.current
      view.current.x = push.ox - (e.clientX - push.x) / r.width / z
      view.current.y = push.oy - (e.clientY - push.y) / r.height / z
      rein(z)
      redraw()
      return
    }
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
    fingers.current.delete(e.pointerId)
    if (pinch.current) {
      /* ⚠️ lifting ONE of two fingers ends the gesture rather than handing the drag to the
         other one — otherwise letting go of a pinch draws a line to wherever the remaining
         thumb happens to be resting */
      if (fingers.current.size < 2) pinch.current = null
      return
    }
    const k = live.current
    live.current = null
    held.current = false
    sown.current = null
    const wasShoving = !!shove.current
    shove.current = null
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* nothing to release */
    }
    if (wasShoving || !k) return
    /**
     * ⚠️ A TAP IS A DOT, NOT NOTHING. A two-point tool dragged nowhere would be a zero-sized
     * box, and a path of one point has no direction to be drawn along — so both get a second
     * point a hair away, which is what every freehand tool here already draws for a tap.
     */
    if (k.p.length < 4) k.p = [k.p[0], k.p[1], k.p[0] + 0.0004, k.p[1] + 0.0004]
    setGround((g) => [...g, k])
    /* ⚠️ a new stroke ends the branch you could have redone into — the rule every editor
       follows, and the one that stops Redo putting back something from a different picture */
    setRedo([])
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
        {/* ⚠️ ALWAYS THERE, IN EVERY MODE, and next to the field rather than inside a
            tool row. Zoom is not a property of the brush you are holding; it is where you are
            standing, and it has to work while you are placing a door as much as while you are
            drawing. The buttons exist because ctrl-wheel is a thing you have to be told and a
            plus sign is not — see the note under the field. */}
        <span className="map-zoom" role="group" aria-label="How close">
          <button
            className="btn"
            aria-label="Further out"
            disabled={zoom <= ZOOM.min}
            onClick={() => closer(zoom / ZOOM.step)}
          >
            −
          </button>
          <button
            className="btn"
            onClick={() => closer(1)}
            disabled={zoom === 1 && view.current.x === 0 && view.current.y === 0}
            title="Show the whole map"
          >
            {zoom === 1 ? 'All of it' : `${zoom.toFixed(1)}×`}
          </button>
          <button
            className="btn"
            aria-label="Closer in"
            disabled={zoom >= ZOOM.max}
            onClick={() => closer(zoom * ZOOM.step)}
          >
            +
          </button>
        </span>
        <span className="muted map-count">
          {pieces.length} thing{pieces.length === 1 ? '' : 's'}
          {ground.length ? ` · ${ground.length} line${ground.length === 1 ? '' : 's'}` : ''}
          {doc ? ` · ${PARK.across}×${PARK.down} screens` : ''}
          {overEdge ? ' · something hangs over the edge' : ''}
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
          className={'btn' + (mode === 'door' ? ' is-on' : '')}
          aria-pressed={mode === 'door'}
          onClick={() => {
            setMode('door')
            setErasing(false)
          }}
        >
          🚪 Doors
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

      {mode === 'door' ? (
        <div className="map-row" role="group" aria-label="Doors">
          {mine.length === 0 ? (
            <p className="muted">
              Keep another map first — a door has to lead somewhere that exists.
            </p>
          ) : (
            <>
              <label className="map-size">
                <span className="muted">Leads to</span>
                <select value={leadsTo} onChange={(e) => setLeadsTo(e.target.value)}>
                  <option value="">Choose a map…</option>
                  {mine
                    /* ⚠️ not this one. A door back to the map you are standing on would drop
                       you at its own spawn, which reads as the door doing nothing. */
                    .filter((m) => m.name.toLowerCase() !== (name.trim() || 'Map').toLowerCase())
                    .map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="btn"
                disabled={!doors.length}
                onClick={() => setDoors((was) => was.slice(0, -1))}
              >
                ↶ Take the last one out
              </button>
              <span className="muted map-count">{doors.length} of 8</span>
            </>
          )}
        </div>
      ) : mode === 'block' ? (
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
            <label className="map-size">
              <span className="muted">Solid</span>
              <input
                type="range"
                min={0.08}
                max={1}
                step={0.02}
                value={alpha}
                onChange={(e) => setAlpha(Number(e.target.value))}
              />
              <span className="muted map-size-say">{Math.round(alpha * 100)}%</span>
            </label>
            <button
              className="btn"
              disabled={!ground.length}
              /**
               * ⚠️ BOTH STACKS MOVED FROM OUT HERE, not from inside an updater. Written as
               * `setGround(g => { setRedo(...); return g.slice(0,-1) })` it is a state updater
               * with a side effect in it, and React calls updaters TWICE in development to
               * catch exactly that — so one Undo pushed the stroke onto the redo stack twice
               * and one Redo put two copies of it back. Measured: draw one line, undo, redo,
               * and the room says two lines. A click is a discrete event, so the values closed
               * over here are the current ones and no updater is needed.
               */
              onClick={() => {
                const last = ground[ground.length - 1]
                if (!last) return
                setGround(ground.slice(0, -1))
                setRedo([...redo, last])
              }}
            >
              ↶ Undo
            </button>
            <button
              className="btn"
              disabled={!redo.length}
              onClick={() => {
                const back = redo[redo.length - 1]
                if (!back) return
                setRedo(redo.slice(0, -1))
                setGround([...ground, back])
              }}
            >
              ↷ Redo
            </button>
            <button
              className="btn"
              disabled={!ground.length}
              onClick={() => {
                setRedo(ground)
                setGround([])
                setSaid('The ground is bare again — Redo puts it back.')
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
          (mode === 'spawn' || mode === 'door' ? ' is-placing' : '') +
          /* ⚠️ a STAMPING drag is a drag too, so touch-action has to be none for it as well —
             see .map-field.is-drawing, which is why this is not just `drawing` any more */
          (mode !== 'spawn' && mode !== 'door' ? ' is-drawing' : '')
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
        {/* ⚠️ AND EVERY STAMP ON ONE CANVAS ABOVE IT — see `stand`. These used to be an
            element each, which was fine at a cap of four hundred and is two thousand canvases
            now. */}
        <canvas ref={props} className="map-things" aria-hidden />
        {/**
          ⚠️ THE WORLD LAYER, AND ONLY THE FEW THINGS THAT HAVE TO BE ELEMENTS ARE IN IT.
          The canvases above draw through the view themselves, at the screen's own resolution;
          everything in here is moved and scaled by `place` instead, which is one style write
          rather than a React pass. A door carries text, the guide is lines with a creature in
          them, and the spawn is one ring — nine elements at the very most.
        */}
        <div ref={stage} className="map-stage">
          {/* ⚠️ HOW BIG A SCREEN IS, DRAWN ON THE FIELD. This field is the WHOLE world, which
              is three screenfuls across — so two stamps at opposite ends are nowhere near each
              other and nothing said so. That is the same mistake the old paint-room guide was
              built to stop ("every test map came out bigger than any landmark the real park
              has"), which is why this is that guide rather than a second one: same lines, same
              creature-inside-a-place reference, derived from the same PARK numbers. */}
          <MapGuide />
          {/* only while you are painting it — see the effect that draws this */}
          {mode === 'block' && <canvas ref={fence} className="map-fence" aria-hidden />}
          {doors.map((d, i) => (
            <span
              key={i}
              className="map-door"
              style={{
                left: `${d.at.x * 100}%`,
                top: `${d.at.y * 100}%`,
                width: `${d.wide * 100}%`,
              }}
              title={`To ${d.to}`}
            >
              <b>{d.to}</b>
            </span>
          ))}
          {/* ⚠️ ON TOP, because it is the one thing on this field that is not scenery — it
              answers "where do I come in", and a tree drawn over it would hide the answer. Not
              in the DOM at all until it has been set, so an unset map says so by showing
              nothing rather than by parking a marker in the middle. */}
          {spawn && (
            <span
              className="map-spawn"
              style={{ left: `${spawn.x * 100}%`, top: `${spawn.y * 100}%` }}
              aria-hidden
            />
          )}
        </div>
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
                  setDoors(m.doc.doors)
                  setRedo([])
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
        {
          'Hold ctrl (or ⌘) and scroll to zoom; drag with the middle button, or hold space, to move about. '
        }
      </p>
      <p className="muted map-note">
        {mode === 'door'
          ? 'Choose a map, then press the field to put a door there. Walk into it in the park and you come out where that map starts.'
          : mode === 'block'
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
