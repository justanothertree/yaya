import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArtThumb } from '../draw/ArtThumb'
import { gallery, subscribeGallery } from '../draw/gallery'
import { paintDrawing, paintStroke, type Drawing, type Stroke, type Tool } from '../draw/strokes'
import { MapGuide } from './MapGuide'
import { cropToInk, worldOf, type MapDoc, type Piece } from './mapDoc'
import { MAP_GUIDE, type PlaceKind } from './mapOf'
import { mapBytes, MAP_LIMIT, parkMaps, removeMap, saveMap, subscribeMaps } from './maps'
import { downBy } from './strike'

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

const SIZES: Array<[number, string]> = [
  [0.06, 'Small'],
  [0.12, 'Middling'],
  [0.2, 'Big'],
]

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
const NIBS: Array<[number, string]> = [
  [0.35, 'Thin'],
  [1, 'A creature wide'],
  [2.5, 'Broad'],
]

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
  const [wide, setWide] = useState(0.12)
  const [erasing, setErasing] = useState(false)
  const [said, setSaid] = useState<string | null>(null)

  /** stamping things down, or drawing on the ground under them */
  const [mode, setMode] = useState<'stamp' | 'draw'>('stamp')
  const [ground, setGround] = useState<Stroke[]>([])
  const [tool, setTool] = useState<Tool>('brush')
  const [ink, setInk] = useState(GROUND_INK[0])
  const [nib, setNib] = useState(1)

  const field = useRef<HTMLDivElement | null>(null)
  const sheet = useRef<HTMLCanvasElement | null>(null)
  /**
   * ⚠️ TWO SURFACES, THE SAME WAY THE PAINT ROOM DOES IT. Everything committed is painted
   * once onto `done`; the stroke being dragged is drawn on a copy of it each move. Repainting
   * the whole ground on every pointermove would get slower with every line already there,
   * which is the one thing a drawing surface must not do.
   */
  const done = useRef<HTMLCanvasElement | null>(null)
  const live = useRef<Stroke | null>(null)

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

  const doc: MapDoc | null = useMemo(
    () =>
      (palette.length && pieces.length) || inkDoc
        ? { v: 1, name: name.trim() || 'Map', palette, pieces, ground: inkDoc }
        : null,
    [name, palette, pieces, inkDoc],
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
  const put = (e: React.MouseEvent<HTMLDivElement>) => {
    const s = spotOf(e)
    if (!s) return
    if (erasing) {
      /* the nearest piece to the press, within its own half-width — so a miss removes nothing */
      let best = -1
      let near = Infinity
      pieces.forEach((p, i) => {
        const d = Math.hypot(p.at.x - s.x, p.at.y - s.y)
        if (d < p.wide / 2 && d < near) {
          near = d
          best = i
        }
      })
      if (best >= 0) setPieces(pieces.filter((_, i) => i !== best))
      return
    }
    if (!chosen) return
    /* ⚠️ the drawing joins the palette once, on its first stamp, and every later copy is an index */
    let at = palette.indexOf(chosen)
    let next = palette
    if (at < 0) {
      at = palette.length
      next = [...palette, chosen]
      setPalette(next)
    }
    const row = DOES.find((d) => d[0] === does) ?? DOES[0]
    setPieces([
      ...pieces,
      { art: at, at: { x: s.x, y: s.y }, wide, kind: row[2], top: row[0] === 'stand' ? high : 0 },
    ])
    setSaid(null)
  }

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'draw' || e.button !== 0) return
    const s = spotOf(e)
    if (!s) return
    if (ground.length >= MAX_GROUND) {
      setSaid(
        'That is as much ink as one map holds. Rub some out, or keep this one and start another.',
      )
      return
    }
    /* ⚠️ capture is an OPTIMISATION, not the mechanism. It keeps a stroke coming when the
       pointer leaves the field mid-drag, and it throws on a pointer id the browser does not
       consider active — so a failure here must not cost the stroke. */
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* drawing still works; it just stops at the edge */
    }
    live.current = { t: tool, c: ink, a: 1, w: downBy(nib), p: [s.x, s.y] }
    show()
  }

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
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
      </div>

      {drawing ? (
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
            <label>
              <span className="sr-only">How fat</span>
              <select value={nib} onChange={(e) => setNib(Number(e.target.value))}>
                {NIBS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
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
            <label>
              <span className="sr-only">How big</span>
              <select value={wide} onChange={(e) => setWide(Number(e.target.value))}>
                {SIZES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
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
          'map-field' + (erasing && !drawing ? ' is-erasing' : '') + (drawing ? ' is-drawing' : '')
        }
        /* ⚠️ THE WORLD'S SHAPE, NOT A SQUARE. Three screens by three is square in screenfuls
           and 16:10 in pixels — see MAP_GUIDE.paper, which is where that sum lives. */
        style={{ aspectRatio: String(MAP_GUIDE.paper) }}
        onClick={drawing ? undefined : put}
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
        {drawing
          ? 'Drag on the field to draw. The whole field is the park, so a line across it is a walk of three screens.'
          : 'Pick a picture, then press the field to put it down. The same picture can go down as many times as you like — it is only kept once.'}
      </p>
    </section>
  )
}
