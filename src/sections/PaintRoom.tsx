import {
  useCallback,
  useMemo,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'
import { ShadePad } from '../theme/ColorField'
import { loadLastKit, saveLastKit } from '../draw/paintKit'
import {
  NONE,
  RAINBOW,
  TOOLS,
  paintDrawing,
  paintStroke,
  type Drawing,
  type Stroke,
  type Tool,
  isFreehand,
  RETIRED_TOOLS,
  SYMMETRIES,
  ECHOES,
  frameCount,
  layerCount,
  packDrawing,
  reshapeStrokes,
  readDrawing,
  strokeBox,
  floodFill,
  xformStroke,
  MAX_LAYERS,
} from '../draw/strokes'
import { InCanvasWindow } from '../circuit/ui/canvasContext'
import { gallery, removeArt, saveArt, subscribeGallery, type Art } from '../draw/gallery'
import { ArtThumb } from '../draw/ArtThumb'
import { SaveArt } from '../draw/SaveArt'
import { together } from '../party/together'
import { drawParty } from '../party/draw'
import { applyLayerOp, type LayerOp, type Stack } from '../draw/layerOps'
import { paintSession } from '../draw/session'
import { savePet } from '../pets/pets'
import { PetView } from '../pets/PetView'
import { PART_DOES, PART_WORDS, inFrontOfOrder, inkBox, partOf, rigOf } from '../pets/rig'
import { MoveShow } from '../pets/MoveShow'
import { saysOf, temperOf } from '../park/temper'
import { attacksOf, moveTable } from '../pets/attack'
import { AlsoTogether } from '../ui/AlsoTogether'
import { useVoiceSession } from '../voice/useVoiceSession'

/**
 * A place to draw.
 *
 * ⚠️ THE CANVAS IS NOT THE DOCUMENT. What you have made is the list of strokes; the canvas is a
 * rendering of it that gets thrown away and rebuilt whenever the window changes size. Every
 * feature that matters falls out of that: undo pops a stroke and repaints, resizing reflows the
 * picture instead of stretching a bitmap, and saving to a profile stores a few kilobytes of
 * numbers rather than an image nobody has to host. See draw/strokes.ts.
 *
 * ⚠️ TWO SURFACES, and the second one is what makes dragging a shape feel right. Committed
 * strokes live on `base`; the stroke you are in the middle of is drawn on top of a copy each
 * frame. Without that, dragging a rectangle would either leave a trail of every intermediate
 * rectangle or force a full repaint of the whole drawing on every pointer move — the first is
 * wrong and the second gets slower the more you have drawn.
 */

const SWATCHES = [
  '#000000',
  '#ffffff',
  '#e02020',
  '#f5a623',
  '#f8e71c',
  '#7ed321',
  '#22c55e',
  '#00bcd4',
  '#2563eb',
  '#7c3aed',
  '#e91e63',
  '#8b5a2b',
]

/**
 * What you were last drawing with, read ONCE rather than per render.
 *
 * ⚠️ the room used to open at its defaults every single time, so the six controls that
 * decide what a mark looks like had to be set again before every drawing. Read at module load
 * because it is only ever the seed for the initial state; re-reading it later would fight the
 * controls the person is currently using.
 */
const LAST = loadLastKit()

/**
 * Shapes the paper can be held to, as width over height.
 *
 * ⚠️ Named by what they are FOR rather than by their numbers, because "3:2" tells you the
 * arithmetic and not the decision. Free stays first and stays the default: it is what the room
 * has always done, and a fixed shape is a thing to reach for rather than a thing to be given.
 */
/**
 * The tool belt: the few brushes you actually used, kept one press away.
 *
 * ⚠️ WHY NOT ALL SEVENTEEN. They were a full-width strip above the paper, and the note on
 * .paint-bar records why they had to leave the rail: at 21rem they wrap to five rows and push
 * Undo — the button you reach for most — off the bottom of the column. But a strip that wide is
 * also a strip a long way from the colour you are about to draw with, which is how it was
 * reported: "the brushes feel far from the colors and stuff". Both are true, and a belt is the
 * thing that is neither: his own suggestion, "a smart belt that keeps the last few tools you used
 * clickable but the tools are behind a dropdown".
 *
 * ⚠️ FIVE, BECAUSE THAT IS WHAT A ROW HOLDS. The panel is 21rem and a chip is about 5rem,
 * so five and the All button is two tidy rows rather than five untidy ones.
 */
const BELT_SIZE = 5
const BELT_KEY = 'paint_belt_v1'
/** A starting kit: what somebody opening Paint for the first time reaches for. */
const BELT_SEED: Tool[] = ['brush', 'eraser', 'line', 'rect', 'fill']

const readBelt = (): Tool[] => {
  const live = (t: unknown): t is Tool =>
    typeof t === 'string' && TOOLS.some(([id]) => id === t) && !RETIRED_TOOLS.has(t as Tool)
  let saved: unknown
  try {
    saved = JSON.parse(localStorage.getItem(BELT_KEY) || 'null')
  } catch {
    saved = null
  }
  /* ⚠️ re-validated on the way OUT, like every other local store here — localStorage is
     editable by anything on this origin, and a retired tool would render a button that draws
     nothing. Short reads are topped up from the seed so the belt is always the same length. */
  const kept = Array.isArray(saved) ? saved.filter(live) : []
  const out: Tool[] = []
  for (const t of [...kept, ...BELT_SEED])
    if (!out.includes(t) && out.length < BELT_SIZE) out.push(t)
  return out
}

const PAPER_SHAPES: Array<[string, string, number]> = [
  ['free', 'Free', 0],
  ['16/9', 'Wide 16:9', 16 / 9],
  ['3/2', 'Photo 3:2', 3 / 2],
  ['4/3', 'Classic 4:3', 4 / 3],
  ['1/1', 'Square', 1],
  ['3/4', 'Portrait 3:4', 3 / 4],
  ['9/16', 'Phone 9:16', 9 / 16],
]

export function PaintRoom() {
  const host = useRef<HTMLDivElement>(null)
  /** the whole room, so fullscreen keeps the tools with the picture */
  const wrap = useRef<HTMLElement>(null)
  const view = useRef<HTMLCanvasElement>(null)
  /** everything committed, rendered once and reused while a stroke is in progress */
  const base = useRef<HTMLCanvasElement | null>(null)
  const size = useRef({ w: 0, h: 0, dpr: 1 })

  /* ⚠️ seeded from the session, so flipping canvas mode — which unmounts this room and mounts
     it somewhere else in the tree — no longer throws the picture away. See draw/session.ts. */
  const [strokes, setStrokes] = useState<Stroke[]>(() => paintSession.restore()?.strokes ?? [])
  /**
   * What sits behind the paint. null is the checkerboard — a genuinely transparent picture.
   *
   * ⚠️ Behind the canvas, not painted into it. Erasing is destination-out, so a background
   * drawn into the picture would be rubbed out along with the line on top of it: you would erase
   * a stroke over a black backdrop and punch a hole through to the page. Behind means the eraser
   * takes away paint and reveals the backdrop, which is what erasing means everywhere else.
   */
  const [bg, setBg] = useState<string | null>(() => paintSession.restore()?.bg ?? null)
  const { inWindow } = useContext(InCanvasWindow)

  /**
   * The view: how far in, and where.
   *
   * ⚠️ ZOOM IS A VIEW, NOT AN EDIT. Nothing about the drawing changes — `scale` and the offset
   * only decide which part of the 0–1 space the screen is showing. That is only possible because
   * strokes are stored in fractions rather than pixels, and it is why zooming in gives you a
   * genuinely sharper line instead of a magnified one: the stroke is re-rendered at the new size
   * rather than blown up.
   */
  const [scale, setScale] = useState(1)
  const off = useRef({ x: 0, y: 0 })
  const pan = useRef<{ x: number; y: number } | null>(null)
  /**
   * WHAT THE PICTURE WAS, BEFORE EACH THING YOU DID.
   *
   * ⚠️ A SNAPSHOT HISTORY, replacing an undo that was `pop()` on the stroke list. That version
   * could only take back an ADDED stroke, so moving, turning, resizing, cutting, pasting, a layer
   * delete and Clear were all one-way — and pressing Undo after a rotate deleted a stroke instead
   * of putting the rotation back, which is worse than doing nothing.
   *
   * ⚠️ IT IS NOT AS EXPENSIVE AS IT SOUNDS, and that was the worry worth answering. A step
   * holds the ARRAY, not the strokes: every stroke object in it is the same object still in the
   * picture, because a stroke is never edited in place — every path here rebuilds the ones it
   * touches ({ ...k, p: [...] }) and leaves the rest alone. So a step costs one pointer per
   * stroke, about 8 bytes. Forty steps of a three-hundred-stroke drawing is under 100KB; the
   * 4000-stroke ceiling would be 1.3MB, and a drawing that size is 128KB on disk.
   *
   * ⚠️ NONE OF IT IS SAVED. It is React state and nothing else: paintSession keeps strokes,
   * bg, hidden and layer names, and packDrawing writes the fields it lists. A history cannot
   * reach a file, a gallery item, a profile block or a peer.
   */
  /**
   * ⚠️ THE PAPER IS IN HERE TOO, and it was not. Clear deliberately resets the background — a
   * page with a colour on it and nothing drawn is still a page with something to clear — but the
   * history only ever held the strokes and the names, so undoing a Clear brought the drawing back
   * onto a page whose colour had gone. Two halves of one picture, one of them undoable.
   */
  type Step = { label: string; strokes: Stroke[]; names: string[]; bg: string | null }
  const [past, setPast] = useState<Step[]>([])
  const [future, setFuture] = useState<Step[]>([])
  /* read by mark() and by undo/redo, which run from handlers rather than from a render */
  const strokesNow = useRef<Stroke[]>(strokes)
  strokesNow.current = strokes
  const HISTORY = 40

  /**
   * Record where we are, before changing it.
   *
   * ⚠️ CALLED AT EVERY PLACE THAT USED TO CLEAR THE REDO LIST, which is what makes the
   * coverage complete rather than hopeful: every mutation already had to say "and now redo is
   * meaningless", so every mutation already had a line to replace.
   */
  /* ⚠️ AND THE LAYER NAMES. They were outside the history while they were decoration; they
     are the rig a pet is read from now (see pets/rig.ts), so losing one to a mis-tap is work
     lost. Twelve short strings is nothing next to the stroke array beside it. */
  const namesNow = useRef<string[]>([])
  /* read by mark() and by undo/redo, which run from handlers rather than from a render */
  const bgNow = useRef<string | null>(null)
  const markAs = useCallback((label: string, snap: Stroke[]) => {
    setPast((p) => [
      ...p.slice(-(HISTORY - 1)),
      { label, strokes: snap, names: namesNow.current, bg: bgNow.current },
    ])
    setFuture([])
  }, [])
  const mark = useCallback((label: string) => markAs(label, strokesNow.current), [markAs])
  /**
   * ⚠️ LAYERS AND FRAMES ARE ONE FEATURE HERE, because they are one field each on a stroke.
   * A layer decides what is drawn OVER what, a frame decides WHEN — everything else about the
   * room, every tool, undo, the party feed, is untouched by both. See Stroke.l and Stroke.f.
   */
  const [layer, setLayer] = useState(0)
  const [hidden, setHidden] = useState<number[]>(() => paintSession.restore()?.hidden ?? [])
  const [layerNames, setLayerNames] = useState<string[]>(
    () => paintSession.restore()?.layerNames ?? [],
  )
  namesNow.current = layerNames
  bgNow.current = bg
  /**
   * ⚠️ NULL MEANS "NOT ANIMATING", and that is the default so the room stays a paint
   * program until you ask for more. A stroke drawn while this is null gets no frame at all,
   * which is what makes it show on every frame if you start animating later — the drawing you
   * already had becomes the background of the animation rather than being stranded on frame 0.
   */
  const [frame, setFrame] = useState<number | null>(null)
  const [onion, setOnion] = useState(2)
  const [playing, setPlaying] = useState(false)
  /* ⚠️ the picture's rate, not the room's — see PaintSession.fps */
  const [fps, setFps] = useState(() => paintSession.restore()?.fps ?? 8)

  /**
   * ⚠️ SELECTING IS NOT A TOOL, and deliberately not in the TOOLS list.
   *
   * Every entry in TOOLS is a kind of STROKE — it is validated against that list on the way in
   * and written into saved files — so putting "select" beside brush and eraser would have added
   * a stroke type that can never be drawn, to a format that travels to other people's machines.
   * It is a mode the room is in, which is what it actually is.
   */
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<number[]>([])
  const [clip, setClip] = useState<Stroke[]>([])
  /** the rectangle being dragged, and the move in progress — refs, they change per pointer event */
  const band = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  /* `from` is the picture as the drag began — one array reference, see the history note */
  const shove = useRef<{ x: number; y: number; from: Stroke[] } | null>(null)
  const markRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const selRef = useRef<number[]>([])

  const [tool, setTool] = useState<Tool>(() => LAST?.tool ?? 'brush')
  const [belt, setBelt] = useState<Tool[]>(readBelt)
  /**
   * When each tool was last picked, as a counter rather than a clock.
   *
   * ⚠️ A REF, BECAUSE NOTHING RENDERS FROM IT. It only decides which slot a new tool takes,
   * which is a question asked at the moment of picking one — keeping it in state would redraw the
   * whole room to record a fact nobody can see.
   */
  const toolUsed = useRef<Record<string, number>>({})
  const toolTick = useRef(0)
  const [colour, setColour] = useState(() => LAST?.colour ?? '#22c55e')
  /* folded away by default — see the note where it is rendered */
  const [paperOpen, setPaperOpen] = useState(false)
  /* only read on narrow screens, where the brush row becomes a menu */
  const [toolsOpen, setToolsOpen] = useState(false)
  /* the shade pad, folded — see the note where it is rendered */
  const [colourOpen, setColourOpen] = useState(false)
  /* symmetry and echo, folded — set once per picture, twelve buttons wide */
  const [fxOpen, setFxOpen] = useState(false)
  /* everything above the paper, folded away — see the note by the button */
  const [toolsHidden, setToolsHidden] = useState(false)
  /**
   * Watching the picture draw itself.
   *
   * ⚠️ IT COSTS NOTHING TO STORE, and that is not a happy accident — it is what the format has
   * been for since the beginning. A drawing here is an ORDERED LIST OF STROKES, not an image, so
   * the recording of how it was made is the file. Replaying is reading the list you already have,
   * in the order it is already in. No second format, nothing extra saved, nothing to keep in step,
   * and it works on anything in the gallery the moment you open it.
   *
   * ⚠️ A COUNT, NOT A CLOCK. The state is how many strokes are showing; the speed only decides
   * how fast that number climbs. Which means scrubbing, pausing and finishing early are all just
   * setting a number, and a replay can never drift out of step with the picture.
   */
  const [replayAt, setReplayAt] = useState<number | null>(null)
  const [replaySpeed, setReplaySpeed] = useState(12)
  /* repaint reads it from a ref, because the timer below drives it far faster than a render */
  const replayRef = useRef<number | null>(null)
  replayRef.current = replayAt
  /**
   * The paper's shape, as width over height — or free, meaning whatever the window leaves.
   *
   * ⚠️ FREE IS WHAT IT ALWAYS DID, and it is the reason art came out a shape nobody chose. The
   * board fills the width and takes a clamped height, so its aspect is a leftover: whatever is
   * beside the controls, on whatever screen, after they wrap. On a phone that is tall and narrow,
   * and the drawing saved with that shape because the shape IS the document. Picking one makes
   * the paper a decision instead of a consequence.
   */
  const [shape, setShape] = useState(() => {
    try {
      return localStorage.getItem('paint_shape_v1') ?? 'free'
    } catch {
      return 'free'
    }
  })
  /** the board's real pixel size, so the shape you are drawing on is never a guess */
  const [dims, setDims] = useState({ w: 0, h: 0 })
  /**
   * The shape a FREE page settled on, once there was something on it.
   *
   * ⚠️ A PICTURE CANNOT KEEP CHANGING SHAPE UNDER ITS OWN STROKES. Points are stored 0–1
   * against the paper, so the paper's aspect IS the drawing's proportions — and on Free the board
   * simply filled whatever space the furniture left it. Measured at 1400x820: pressing ⌈ Tools took
   * the board from 1.768 to 2.102, which stretches everything already drawn 19% sideways, and
   * dragging the window edge did the same thing continuously. Reported as the paint tripping him
   * out, and as not being able to tell what was real.
   *
   * ⚠️ SO FREE MEANS "YOU HAVE NOT CHOSEN YET", NOT "IT FOLLOWS THE FURNITURE". The moment a
   * stroke lands, the shape the room had is the shape the picture has, and from then on the board
   * scales rather than stretches. Choosing a real shape still wins, and clearing hands the choice
   * back.
   */
  const [freeAr, setFreeAr] = useState<number | null>(() => paintSession.restore()?.ratio ?? null)
  /**
   * What this picture is called, if it has been called anything.
   *
   * ⚠️ BOTH STORES REPLACE BY NAME, and the room was asking for the name from scratch every
   * time. Keeping a drawing under the name it already had updates it; under any other name it
   * makes a second one — so a blank prompt turns every edit into a duplicate unless you happen to
   * remember the old name and type it exactly. Worst on the minion room's Edit, which exists to
   * open something you already keep.
   */
  const [docName, setDocName] = useState<string>(() => paintSession.restore()?.name ?? '')
  const chosenAr = PAPER_SHAPES.find(([id]) => id === shape)?.[2] || 0
  /* a shape you picked beats one the page settled into, and either beats the furniture */
  const shapeAr = chosenAr || freeAr || 0
  /**
   * ⚠️ ALWAYS FULL AT THE START, and deliberately not restored from the last session.
   *
   * Every other brush setting is worth remembering — the tool, the colour, the width are all
   * things you were in the middle of. Opacity is not like them: it is turned down for one
   * particular effect and then it is done, and coming back a day later to paint that is quietly
   * see-through is confusing in a way that a remembered brush width never is. The value still
   * goes into a saved kit, where it was chosen on purpose.
   */
  const [alpha, setAlpha] = useState(1)
  const [width, setWidth] = useState(() => LAST?.width ?? 0.008)
  /**
   * Kaleidoscope segments and trailing copies for strokes drawn from now on — see Stroke.k and .e.
   *
   * ⚠️ THESE TWO DELIBERATELY DO NOT COME BACK WITH THE REST OF THE KIT, and the rest of the kit
   * is right to. A tool, a colour, a width and an opacity are what you draw WITH; symmetry and
   * echo are a mode the room is IN, and they multiply every mark you make. Arriving in a mode you
   * did not switch on this session — behind a folded button, signalled by a badge the size of two
   * characters — is a room that has started drawing for you. Watched happening to somebody making
   * their first minion: every stroke came out six times and it took a while to work out why, and
   * turning the one they found off left the other one on.
   *
   * ⚠️ STILL SAVED, so a NAMED kit keeps them: a setup you deliberately gave a name to is a
   * different thing from whatever the room happened to be doing when you last closed the tab.
   */
  const [symmetry, setSymmetry] = useState(0)
  const [echo, setEcho] = useState(0)
  /* ⚠️ Stored on CHANGE, not on leaving: a tab closed or crashed never gets an unload handler,
     and losing the setup in exactly the case where you were interrupted is the worst of both. */
  useEffect(() => {
    saveLastKit({ tool, colour, alpha, width, symmetry, echo })
  }, [tool, colour, alpha, width, symmetry, echo])

  const live = useRef<Stroke | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  /**
   * The picture the download panel is pointed at — the board, or one out of the gallery.
   *
   * ⚠️ A DRAWING, NOT A FLAG, so one panel serves both. The board and a kept picture are the same
   * kind of thing and the panel only ever needed one of them; a boolean plus "which gallery item"
   * would be two states that can disagree about what is being saved.
   */
  const [saving, setSaving] = useState<Drawing | null>(null)
  const saved = useSyncExternalStore(subscribeGallery, gallery, gallery)
  const call = useVoiceSession()
  const party = useSyncExternalStore(drawParty.subscribe, drawParty.getState, drawParty.getState)
  const [note, setNote] = useState<string | null>(null)

  /**
   * Somebody else's stroke.
   *
   * ⚠️ It goes into the SAME list as your own, so it is undoable, savable and part of the
   * picture exactly like anything you drew. Keeping other people's marks in a separate layer
   * would mean two pictures that only look like one, and a save that quietly dropped half of what
   * is on screen.
   */
  /**
   * Start again: no strokes, no selection, nothing to redo — and plain paper.
   *
   * ⚠️ THE PAPER IS PART OF THE PICTURE. Clearing used to empty the strokes and leave whatever
   * colour you had painted the background, so "clear the whole picture" handed you a picture
   * that was still visibly the old one. If the paper is not a mark, it is not a mark you can
   * take back either — which is precisely why bg travels over drawParty as its own message.
   */
  const wipe = useCallback(() => {
    mark('clearing the picture')
    setSel([])
    setStrokes([])
    setBg(null)
    /**
     * ⚠️ THE LAYERS GO TOO, and they did not. layerCount reads the NAME list as well as the
     * strokes, so clearing only the strokes left an empty picture still carrying however many
     * named layers it had — reported as "clearing the image doesn't clear the parts layers". The
     * pet panel went on describing a creature that was no longer there, and the next thing drawn
     * landed on somebody else's part.
     */
    setLayerNames([])
    setHidden([])
    setLayer(0)
    /* an empty page has no proportions to protect — see freeAr — and is nothing's edit */
    setFreeAr(null)
    setDocName('')
    setFps(8)
    /* the guide was walking you through parts that no longer exist */
    setPetStep(null)
    /* nothing to come back to — carrying the cleared picture forward would be the bug */
    paintSession.forget()
  }, [mark])

  /**
   * ⚠️ Kept on CHANGE, not on unmount. A cleanup that saves runs after React has already decided
   * to tear the tree down, and in StrictMode it runs on a mount nobody asked for — writing state
   * at teardown is how you save the wrong thing or nothing at all. Committed strokes change a
   * few times a minute, so this is cheap.
   */
  useEffect(() => {
    paintSession.keep({
      strokes,
      bg,
      hidden,
      layerNames,
      ratio: shapeAr || undefined,
      name: docName || undefined,
      fps,
    })
  }, [strokes, bg, hidden, layerNames, shapeAr, docName, fps])

  /**
   * ⚠️ PINNED ON THE FIRST STROKE, not on every render. Before there is anything on the page
   * there is nothing to distort, so Free is free; after there is, the shape is part of what has
   * been made. Reading it from the measured board rather than from a constant means the page you
   * started on is the page you keep.
   */
  useEffect(() => {
    if (chosenAr || freeAr !== null) return
    if (!strokes.length || dims.w < 2 || dims.h < 2) return
    setFreeAr(dims.w / dims.h)
  }, [strokes.length, chosenAr, freeAr, dims.w, dims.h])

  useEffect(() => drawParty.start(), [])
  useEffect(() => {
    drawParty.setHandler((s) => setStrokes((prev) => [...prev, s]))
    /* ⚠️ by name, not by position: their array is not ours and never was */
    drawParty.setUndoHandler((id) => {
      setSel([])
      setStrokes((prev) => prev.filter((k) => k.id !== id))
    })
    drawParty.setPaperHandler((c) => setBg(c))
    drawParty.setClearHandler(() => wipe())
    /**
     * ⚠️ THROUGH readDrawing, which is the same door a stranger's gallery file comes
     * through. This is a whole picture handed over by a peer and it ends up in canvas calls and
     * possibly on somebody's profile, so it gets a file's validation rather than a friend's
     * benefit of the doubt: known tools, hex colours, clamped numbers, bounded point counts.
     */
    /* ⚠️ The same transform the press runs, applied to this side's own stack — see
       applyLayerOp. `false` because a change that came off the wire must not be sent back out;
       two people echoing each other's reorders is a loop that ends with the layers somewhere
       neither of them asked for. */
    drawParty.setLayerHandler((op) => runLayerOp(op, false))
    /* ⚠️ Stops your playback, deliberately. Somebody stepped to a frame to look at it, and
       arriving there while your own preview keeps rolling means you never see what they meant. */
    drawParty.setReelHandler(({ frame: f, fps: n }) => {
      setPlaying(false)
      setFrame(f)
      setFps(n)
    })
    drawParty.setPictureHandler(({ packed, ids, hidden: theirHidden }) => {
      const d = readDrawing(packed)
      if (!d) return
      /* ⚠️ Only onto a blank page, checked again HERE and not only where we asked. The
         ask and the answer are seconds apart and you may well have started drawing in between —
         and the rule is that joining never destroys your own work.

         ⚠️ Read from the ref, not inside a setStrokes updater. An updater has to be pure:
         React is free to run it twice, and the four setters this needs alongside it would then
         fire twice for one message. drawingRef is written on every render, so it is the current
         picture at the moment the message lands. */
      if (drawingRef.current.strokes.length) return
      setBg(d.bg)
      mark('opening that picture')
      setSel([])
      if (d.layers?.length) setLayerNames(d.layers)
      // which layers are switched off is part of the shared view, not of the saved picture
      setHidden(theirHidden)
      /* the names let a later "take back the one I called this" find the right stroke — see the
         rename in draw.ts. A stroke with no name simply cannot be undone from afar. */
      setStrokes(d.strokes.map((k, i) => (ids[i] ? { ...k, id: ids[i] } : k)))
    })
    /* null while your own page is blank: "I have nothing" and "I have an empty page" are the
       same answer, and it keeps two blank arrivals from sending each other nothing at length */
    drawParty.setPictureSource(() => {
      const d = drawingRef.current
      if (!d.strokes.length && !d.bg) return null
      return { packed: packDrawing(d), ids: d.strokes.map((k) => k.id), hidden }
    })
    return () => {
      drawParty.setHandler(null)
      drawParty.setUndoHandler(null)
      drawParty.setPaperHandler(null)
      drawParty.setClearHandler(null)
      drawParty.setPictureHandler(null)
      drawParty.setPictureSource(null)
      drawParty.setLayerHandler(null)
      drawParty.setReelHandler(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => () => drawParty.setOn(false), [])
  /* ⚠️ re-applied on arrival, for the same reason as the instrument room: leaving turns sharing
     off, so a preference that was only read once would stop being true the moment you wandered */
  useEffect(() => {
    const apply = () => {
      const on = together.getState().on
      const was = drawParty.getState().on
      drawParty.setOn(on)
      /**
       * ⚠️ ASK THE MOMENT SHARING COMES ON, because that is the only moment anybody knows
       * you have just arrived. Strokes travel forward from when you started listening, so without
       * this you sit in front of a blank page while everyone else looks at a drawing — two
       * pictures, no sign of it, and every stroke afterwards widening the gap.
       *
       * Nothing is asked for if you already have something: you are not joining their picture,
       * you are bringing your own. See catchUp.
       */
      if (on && !was) drawParty.catchUp()
    }
    apply()
    return together.subscribe(apply)
  }, [])

  /**
   * ⚠️ A CLICK ANYWHERE ELSE CLOSES THEM. A popover you can only shut by finding the button that
   * opened it is a popover that is open by accident most of the time — and with three of them
   * (paper, the mix pad, effects) they end up stacked over each other and over the paper.
   *
   * `pointerdown`, not click: it has to close before the canvas starts a stroke underneath, or
   * the first press after finishing with a colour is spent dismissing something.
   */
  useEffect(() => {
    if (!paperOpen && !colourOpen && !fxOpen) return
    const away = (e: PointerEvent) => {
      const t = e.target
      if (t instanceof Element && t.closest('.paint-fold')) return
      setPaperOpen(false)
      setColourOpen(false)
      setFxOpen(false)
    }
    /* capture, so it runs before the board's own pointerdown handler */
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [paperOpen, colourOpen, fxOpen])

  /**
   * ⚠️ FULLSCREEN STARTS WITH THE TOOLS AWAY, because that is what going fullscreen was for.
   * Arriving at a wall of controls on a bigger screen is the thing that made it feel pointless.
   * Leaving puts them back, so the ordinary page is never mysteriously bare — and the button is
   * still there in both states, so this is a starting position rather than a rule.
   */
  /**
   * ⚠️ AND A CLASS BESIDE THE PSEUDO-CLASS. The fullscreen layout is styled off `:fullscreen`,
   * which is correct and which nothing outside a real fullscreen session can produce — including
   * every way of checking the layout short of a person pressing the button and looking. A class
   * carrying the same fact makes the rules reachable, which is the difference between a layout
   * that was tested and one that was reasoned about. It is set from the same event, so the two
   * can never disagree about whether we are fullscreen.
   */
  const [isFull, setIsFull] = useState(false)
  useEffect(() => {
    const onFull = () => {
      const on = !!document.fullscreenElement
      /**
       * ⚠️ FULLSCREEN NO LONGER TAKES THE TOOLS AWAY. Hiding them was right when the only
       * place they could go was above the paper, where they were the thing making fullscreen worth
       * pressing. It stopped being right the moment they could sit beside it: what hiding them
       * actually did was leave you full-screen with no brush, no colour and no layer names, which
       * is every single thing you need to make a pet — reported as not being able to draw one in
       * there. The ⌃ Tools button still gives bare paper for anybody who wants it, and now that
       * is a choice rather than what fullscreen means.
       */
      setIsFull(on)
    }
    document.addEventListener('fullscreenchange', onFull)
    return () => document.removeEventListener('fullscreenchange', onFull)
  }, [])

  const toggleFull = () => {
    const el = wrap.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen?.().catch(() => {})
  }

  /** the drawing, as it would be saved */
  const drawingRef = useRef<Drawing>({
    v: 1,
    name: 'Untitled',
    ratio: 1.5,
    bg: null,
    strokes: [],
  })
  drawingRef.current = {
    v: 1,
    name: docName || 'Untitled',
    ratio: size.current.h ? size.current.w / size.current.h : 1.5,
    bg,
    layers: layerNames.length ? layerNames : undefined,
    fps,
    strokes,
  }

  /**
   * The stack as it is right now.
   *
   * ⚠️ A REF, for the same reason drawingRef above is one: the transform runs from a press
   * AND from a message off the wire, and the wire handler is installed once with no dependencies.
   * Closing over state would hand a peer's change the layer list as it stood when the room
   * opened — which is a change applied to the wrong picture, silently.
   */
  const stackRef = useRef<Stack>({ strokes, names: layerNames, hidden, layer })
  stackRef.current = { strokes, names: layerNames, hidden, layer }

  /**
   * Put `base` on screen, cropped to whatever the view is showing.
   *
   * ⚠️ `base` is ALWAYS rendered unzoomed, at the document's own resolution, and the zoom is
   * applied only when blitting it here. That is not an optimisation — it is what keeps the fill
   * bucket honest. A flood fill reads the pixels that are actually on a canvas, so computing one
   * against a zoomed view would fill only what happened to be visible and give a different
   * result at every zoom level. Filling against the unzoomed document means a fill is the same
   * fill however far in you were when you asked for it.
   */
  /**
   * Where the handles are, in 0-1 space: four corners plus a rotate knob above the top edge.
   *
   * ⚠️ KEPT INSIDE WHAT YOU CAN SEE, which is the whole reason this is not four corners and a
   * subtraction. Select → All puts the box around the entire picture, so at rest the corners sit
   * exactly ON the canvas edges, half of each one clipped — and the rotate knob, which lives
   * ABOVE the top edge, lands at a negative y and is not on screen at all. Zoom in and the whole
   * lot leaves. The outline still shows where the selection truly is; the things you have to grab
   * are brought to where your hand can reach them.
   *
   * ⚠️ ONE FUNCTION FOR DRAWING AND FOR HIT-TESTING, which is what makes that safe: a handle
   * painted somewhere the press test does not look for it is worse than one off screen, because
   * it looks grabbable.
   *
   * ⚠️ THE OPPOSITE CORNER IS CARRIED, not worked out by comparing coordinates. Scaling
   * pivots on the corner diagonally across, and the old code found it by asking whether the
   * handle's x equalled the box's — which stops being true the moment a handle is clamped, and
   * was already ambiguous on a selection with no width.
   */
  const gripPoints = useCallback(
    (b: { x0: number; y0: number; x1: number; y1: number }) => {
      const vw = size.current.w || 1
      const vh = size.current.h || 1
      /* the visible window in the drawing's own coordinates — px(fx) = (fx - off.x) * w * scale,
       so the left edge is off.x and the window is 1/scale wide. Inset by a handle's own size. */
      const mx = 14 / (vw * scale)
      const my = 14 / (vh * scale)
      const x0 = off.current.x + mx
      const x1 = off.current.x + 1 / scale - mx
      const y0 = off.current.y + my
      const y1 = off.current.y + 1 / scale - my
      const inx = (v: number) => (x1 > x0 ? Math.max(x0, Math.min(x1, v)) : v)
      const iny = (v: number) => (y1 > y0 ? Math.max(y0, Math.min(y1, v)) : v)
      const at = (x: number, y: number, ox: number, oy: number) => ({
        x: inx(x),
        y: iny(y),
        ox,
        oy,
      })
      return {
        corners: [
          at(b.x0, b.y0, b.x1, b.y1),
          at(b.x1, b.y0, b.x0, b.y1),
          at(b.x1, b.y1, b.x0, b.y0),
          at(b.x0, b.y1, b.x1, b.y0),
        ],
        /** the point the stalk leaves from, so it does not shoot off after a clamped knob */
        top: { x: inx((b.x0 + b.x1) / 2), y: iny(b.y0) },
        rotate: { x: inx((b.x0 + b.x1) / 2), y: iny(b.y0 - 0.045) },
      }
      /* ⚠️ Stable per zoom level, because `blit` depends on it. Left as a plain const it was a
       new function every render, so either the painter listed a dependency that changed on every
       render — rebuilding the canvas callback constantly — or it lied about what it uses. */
    },
    [scale],
  )

  /**
   * ⚠️ HOW CLOSE COUNTS, IN SCREEN PIXELS. It was a flat 0.022 of the picture, which is a
   * different physical distance at every zoom: at 4× the four corners of a small selection all
   * answer to the same press, and zoomed out a handle is a few pixels wide and unhittable. The
   * handle is drawn at a fixed screen size, so what counts as near it has to be as well.
   */
  const gripNear = (x: number, y: number, p: { x: number; y: number }) => {
    const tx = 16 / ((size.current.w || 1) * scale)
    const ty = 16 / ((size.current.h || 1) * scale)
    return Math.abs(x - p.x) < tx && Math.abs(y - p.y) < ty
  }

  /**
   * Whether the stroke in progress has to go through the full repaint rather than be dropped on
   * top of the finished picture.
   *
   * ⚠️ ONLY AN ERASER, AND ONLY OVER MORE THAN ONE LAYER. `base` is the picture already
   * flattened, so an eraser painted onto it cuts through every layer at once — which is exactly
   * the bug being fixed one file over, reappearing for the length of a drag. Measured before this:
   * mid-drag a column through both bands read empty, and layer 1 came back on release. Watching
   * it take everything and then give half of it back is worse than either answer on its own.
   *
   * ⚠️ DECIDED ONCE PER DRAG, NOT PER MOVE. It is a scan of the stroke list to see whether
   * anything sits on another layer, which is cheap once and wasteful sixty times a second — and
   * it cannot change mid-stroke, because nobody else's strokes land while your pointer is down.
   */
  const bakeLive = useRef(false)

  const blit = useCallback(() => {
    const b = base.current
    const v = view.current
    if (!b || !v) return
    const { w, h, dpr } = size.current
    const vc = v.getContext('2d')
    if (!vc) return
    vc.setTransform(1, 0, 0, 1, 0, 0)
    vc.clearRect(0, 0, v.width, v.height)
    vc.imageSmoothingEnabled = true
    const sw = b.width / scale
    const sh = b.height / scale
    vc.drawImage(
      b,
      off.current.x * b.width,
      off.current.y * b.height,
      sw,
      sh,
      0,
      0,
      v.width,
      v.height,
    )
    if (live.current && !bakeLive.current) {
      // the stroke in progress is drawn straight onto the view, so it needs the same mapping
      vc.setTransform(
        dpr * scale,
        0,
        0,
        dpr * scale,
        -off.current.x * w * dpr * scale,
        -off.current.y * h * dpr * scale,
      )
      paintStroke(vc, live.current, w, h)
    }
    /**
     * ⚠️ The selection is drawn ON THE VIEW, never into `base`. It is not part of the picture,
     * so it must not survive a save, appear in the gallery thumbnail, or be there when somebody
     * else opens the drawing. Anything painted into base is the drawing; this is furniture.
     */
    const box = markRef.current
    if (box) {
      vc.setTransform(dpr, 0, 0, dpr, 0, 0)
      const px = (fx: number) => (fx - off.current.x) * w * scale
      const py = (fy: number) => (fy - off.current.y) * h * scale
      vc.save()
      vc.lineWidth = 1
      vc.setLineDash([5, 4])
      vc.strokeStyle = 'rgba(255,255,255,0.85)'
      vc.strokeRect(px(box.x0), py(box.y0), px(box.x1) - px(box.x0), py(box.y1) - py(box.y0))
      vc.setLineDash([])
      vc.strokeStyle = 'rgba(0,0,0,0.55)'
      vc.strokeRect(
        px(box.x0) - 1,
        py(box.y0) - 1,
        px(box.x1) - px(box.x0) + 2,
        py(box.y1) - py(box.y0) + 2,
      )
      /**
       * ⚠️ HANDLES ONLY ON A REAL SELECTION, never on the rectangle you are dragging out.
       * markRef carries both — the band while you are catching things, the box once you have —
       * and putting grab points on a band being drawn would offer you a corner of something that
       * does not exist yet.
       *
       * ⚠️ Drawn in SCREEN pixels, not scaled with the zoom. A handle is something to hit with
       * a finger, so it wants to be the same size to the hand at every zoom level; scaling it with
       * the picture makes it unusably small exactly when you have zoomed out to see the whole
       * thing you are about to rotate.
       */
      if (!band.current) {
        const g = gripPoints(box)
        const R = 5
        vc.lineWidth = 1.5
        for (const p of [...g.corners, g.rotate]) {
          vc.beginPath()
          vc.arc(px(p.x), py(p.y), R, 0, Math.PI * 2)
          vc.fillStyle = 'rgba(255,255,255,0.95)'
          vc.fill()
          vc.strokeStyle = 'rgba(0,0,0,0.6)'
          vc.stroke()
        }
        /* a stalk from the top edge to the rotate knob, so it reads as attached rather than as a
           stray dot floating above the picture */
        vc.beginPath()
        vc.moveTo(px(g.top.x), py(g.top.y))
        vc.lineTo(px(g.rotate.x), py(g.rotate.y) + R)
        vc.strokeStyle = 'rgba(255,255,255,0.65)'
        vc.stroke()
      }
      vc.restore()
    }
    vc.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [scale, gripPoints])

  /** Rebuild `base` from the committed strokes, then show it. */
  const repaint = useCallback(() => {
    const b = base.current
    const v = view.current
    if (!b || !v) return
    const { w, h } = size.current
    if (w < 1 || h < 1) return
    const bc = b.getContext('2d')
    if (!bc) return
    /**
     * ⚠️ The view is passed EVERY repaint rather than baked into the drawing, because which
     * frame you are on and which layers you have hidden are things about looking, not about the
     * picture. Save the file and none of it travels; it is the same drawing seen from here.
     */
    /**
     * ⚠️ WHILE A HANDLE IS HELD, THE PICTURE IS DRAWN FROM THE SNAPSHOT, transformed. Not
     * from the current strokes, and not by applying each move on top of the last: recomputing one
     * edit from where the gesture started is what makes dragging out and back land exactly where
     * you began, instead of drifting through a hundred compounded multiplications. The same
     * reasoning the note editor's drag already uses.
     */
    /* ⚠️ The replay slices the SAME list the picture is drawn from, so there is no second
       render path to keep correct — a half-played drawing is just a drawing with fewer strokes. */
    const upTo = replayRef.current
    const g = grip.current
    const m = gripLive.current
    const shown =
      upTo !== null
        ? { ...drawingRef.current, strokes: drawingRef.current.strokes.slice(0, Math.floor(upTo)) }
        : g && m
          ? {
              ...drawingRef.current,
              /* ⚠️ from the snapshot, through the same one function the committed edit and
                 the peers' copy go through — so what you watch while you drag is what you get */
              strokes: drawingRef.current.strokes.map((k, i) =>
                selRef.current.includes(i) && g.from[i] ? xformStroke(g.from[i], m) : k,
              ),
            }
          : drawingRef.current
    /* ⚠️ the eraser in progress goes IN the picture, not on top of it — see bakeLive */
    const withLive =
      bakeLive.current && live.current
        ? { ...shown, strokes: [...shown.strokes, live.current] }
        : shown
    paintDrawing(bc, withLive, w, h, {
      frame: frame ?? undefined,
      hidden,
      onion: frame === null || playing ? 0 : onion,
    })
    blit()
  }, [blit, frame, hidden, onion, playing])

  const preview = blit

  // ── sizing ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = host.current
    const v = view.current
    if (!el || !v) return
    if (!base.current) base.current = document.createElement('canvas')

    const fit = () => {
      const r = el.getBoundingClientRect()
      if (r.width < 1) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      if (w === size.current.w && h === size.current.h && dpr === size.current.dpr) return
      size.current = { w, h, dpr }
      setDims({ w, h })
      for (const c of [v, base.current!]) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
        c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      /**
       * ⚠️ The picture is REDRAWN at the new size, not stretched. Coordinates are 0–1, so a
       * resize reflows the artwork the way text reflows — which is only possible because the
       * canvas was never the document.
       */
      repaint()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    // the observer does not fire in every embedding, and a canvas that missed its size stays blank
    const poll = window.setInterval(fit, 1000)
    return () => {
      ro.disconnect()
      window.clearInterval(poll)
    }
  }, [repaint])

  useEffect(() => {
    repaint()
  }, [strokes, repaint])
  /* the outline lives on the view, so a change of selection needs a blit and not a repaint */
  useEffect(() => {
    blit()
  }, [sel, selecting, blit])
  /**
   * ⚠️ A SELECTION IS A LIST OF POSITIONS IN THE STROKE ARRAY, so anything that renumbers that
   * array leaves it pointing at the wrong strokes — undo and redo do, and so does moving to a
   * frame or layer where the caught strokes are not even visible. Dropping it is the honest
   * answer: a selection that silently means something else is how you delete the wrong thing.
   */
  /**
   * ⚠️ UNLESS THE FRAME CHANGE WAS A COPY, which is the one case where the new frame holds the
   * very strokes the selection is about. + frame moves you to a new frame AND puts the copies
   * there, so the clear above was undoing it a render later: the selection it set never survived
   * the press, and you were left in the select tool with nothing caught — which is why the next
   * drag started a rubber band instead of moving anything. ⧉ From last never hit this, because
   * it copies onto the frame you are already on and this effect does not fire.
   *
   * ⚠️ KEYED ON THE FRAME IT WAS MEANT FOR, not a bare flag, so it can only ever apply to the
   * arrival it was armed for.
   */
  const selFor = useRef<{ frame: number; sel: number[] } | null>(null)
  useEffect(() => {
    const want = selFor.current
    selFor.current = null
    setSel(want && want.frame === frame ? want.sel : [])
  }, [frame, layer])
  /**
   * ⚠️ ONE BLIT PER FRAME, NOT ONE PER WHEEL EVENT.
   *
   * A wheel is not one event per notch. A trackpad or a smooth mouse wheel sends a stream of
   * them, ten or twenty inside a single frame, and each one set the scale, re-rendered, and
   * blitted the whole document again. Measured at 2048x1536 into a 2560x1600 view that is about
   * 2.7ms a blit, so a frame's worth of wheel spent 30-50ms redrawing the same picture over and
   * over and only the last one was ever seen. That is the stutter when zooming with a lot on the
   * canvas, and it got worse the more there was to draw.
   *
   * Scheduling on an animation frame collapses the burst into the single blit that was the only
   * one that could reach the screen anyway.
   */
  const blitSoon = useRef(0)
  /**
   * ⚠️ THROUGH A REF, because blit() is rebuilt whenever `scale` changes.
   *
   * Calling the captured blit would draw the scale from the FIRST event of the burst and then
   * skip the other fourteen, since the guard below stops them scheduling anything of their own —
   * the zoom would visibly lag a notch behind the wheel and stop early. The ref always holds the
   * newest one, so the single blit that does run is the one for where the wheel actually ended.
   */
  const latestBlit = useRef(blit)
  latestBlit.current = blit
  useEffect(() => {
    if (blitSoon.current) return
    blitSoon.current = requestAnimationFrame(() => {
      blitSoon.current = 0
      latestBlit.current()
    })
  }, [scale, blit])
  useEffect(
    () => () => {
      if (blitSoon.current) cancelAnimationFrame(blitSoon.current)
    },
    [],
  )

  // ── drawing ───────────────────────────────────────────────────────────────
  /**
   * Where the pointer is IN THE DRAWING, not on the screen.
   *
   * ⚠️ Through the view, or every stroke would land where the cursor is rather than where you
   * are pointing the moment you zoom in. The screen fraction is divided by the scale and shifted
   * by the offset, which is the inverse of what blit() does to get the picture on screen.
   */
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = view.current!.getBoundingClientRect()
    return [
      off.current.x + (e.clientX - r.left) / r.width / scale,
      off.current.y + (e.clientY - r.top) / r.height / scale,
    ]
  }

  /** Keep the view over the picture: at 1x it is exactly the picture, further in it can roam. */
  const clampOffset = (nextScale: number) => {
    const span = 1 - 1 / nextScale
    off.current.x = Math.max(0, Math.min(span, off.current.x))
    off.current.y = Math.max(0, Math.min(span, off.current.y))
  }

  /**
   * ⚠️ Zoom toward the POINTER, not the middle.
   *
   * Zooming about the centre means the thing you are looking at slides away as you go in, and you
   * spend the whole time chasing it. Keeping the point under the cursor fixed is what makes a
   * wheel feel like a magnifying glass rather than a slider.
   */
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const r = view.current!.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    const before = at(e)
    const next = Math.max(1, Math.min(12, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
    off.current.x = before[0] - fx / next
    off.current.y = before[1] - fy / next
    clampOffset(next)
    setScale(next)
  }

  /**
   * ⚠️ ATTACHED BY HAND, because React's onWheel is PASSIVE and a passive listener is forbidden
   * to preventDefault.
   *
   * The handler above always called preventDefault and it was always ignored, so the wheel
   * zoomed the picture AND scrolled the page under it — the drawing went in while the room went
   * up, which is exactly what it looked like. Nothing about the code said so: the call is there,
   * it just has no effect from a listener React added with { passive: true }.
   *
   * Re-attached when `scale` changes because the handler closes over it; the alternative is a ref
   * shadowing the state, and one listener swap per zoom step is cheaper than that confusion.
   */
  useEffect(() => {
    const el = view.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])

  /**
   * ⚠️ PLAYBACK IS A TIMER, not an animation loop, because the frames are not moving pictures —
   * each one is a full repaint of committed strokes, and asking for a redraw sixty times a
   * second to show eight frames would do the work seven times for nothing. Onion skin is turned
   * off while playing above: ghosts are a drawing aid, and during playback they would just be
   * every frame smeared over every other one.
   */
  const animating = frame !== null
  useEffect(() => {
    if (!playing || !animating) return
    const id = window.setInterval(
      () => {
        // ⚠️ counted INSIDE the tick, not captured when the timer was made: add a frame while it
        // is playing and a captured total would loop over the old length and never show it
        const total = frameCount(drawingRef.current)
        if (total < 2) return
        setFrame((f) => ((f ?? 0) + 1) % total)
      },
      Math.round(1000 / Math.max(1, Math.min(24, fps))),
    )
    return () => window.clearInterval(id)
    // ⚠️ `frame` is deliberately not a dependency — it changes on every tick, and depending on it
    // would tear the timer down and build a new one sixty times a minute instead of running one
  }, [playing, animating, fps])

  const layers = layerCount(drawingRef.current)
  const frames = frameCount(drawingRef.current)

  /**
   * Does this layer hold still across every frame?
   *
   * ⚠️ DERIVED FROM THE STROKES, not stored anywhere, and that is what makes it free. A
   * stroke with no frame already shows on all of them — it is how everything drawn before you
   * pressed Frames becomes the background — so "this layer does not change" is not a new idea
   * needing a new field, a new place in the file format and a new thing to keep in sync. It is a
   * question the strokes can already answer.
   *
   * Which also means it needs no sharing of its own: the strokes carry it, and the strokes
   * already travel.
   */
  const layerHolds = (i: number) => {
    const on = strokes.filter((k) => (k.l ?? 0) === i)
    return on.length > 0 && on.every((k) => k.f === undefined)
  }

  /**
   * ⚠️ A NEW STROKE GOES ON THE FRAME YOU ARE ON, even on a layer that currently holds still.
   *
   * It inherited the layer's held-ness for about ten minutes, on the reasoning that adding to the
   * background should stay in the background. Tested, and it is a trap: everything drawn before
   * you press Frames is frameless, so the layer you start on ALWAYS reads as held — and the first
   * pose you draw was silently made part of the background too, on the layer you were most likely
   * to animate on. A feature that quietly refuses to animate is worse than one that needs a
   * second press.
   *
   * So nothing is inherited, the ↻ button says what is actually true of the strokes, and folding
   * a new mark into the background is a press you can see.
   */
  const frameForNew = () => frame ?? undefined

  /**
   * Put every mark from the frame before this one onto this one.
   *
   * ⚠️ THE ANSWER TO "I DO NOT WANT TO REDRAW IT". The other half is the layer that holds
   * still, and the two cover different things: a background belongs on a held layer, but a pose
   * that is ALMOST the last one is not background — it is the last one, moved. So this copies it
   * and leaves it selected, and the move is a drag rather than a redraw.
   *
   * ⚠️ ONLY ONTO AN EMPTY FRAME. Copying on top of work already here would be additive and
   * silent — twice as many strokes, all overlapping, and no way back but undo pressed as many
   * times as the frame is long.
   */
  /**
   * Put a copy of frame `from` onto frame `to`, ready to be moved.
   *
   * ⚠️ Each stroke sent on its own, through the same door a drawn stroke goes through. A
   * bulk message would be a second way for a stroke to arrive, with its own validation to get
   * right, to save a handful of sends that happen once per frame.
   *
   * ⚠️ Selected AND the select tool turned on, because "move it instead of redrawing it" is
   * the entire feature and leaving you to go and find the tool is leaving the job half done.
   * A selection you cannot drag is just an outline.
   */
  const carryFrame = (from: number, to: number) => {
    /* the sources, WITH where they were, so a selection can be carried across as well as the art */
    const source = strokes.map((k, i) => ({ k, i })).filter((x) => x.k.f === from)
    const made: Stroke[] = source.map((x) => ({
      ...x.k,
      f: to,
      p: [...x.k.p],
      id: drawParty.mark(),
    }))
    if (!made.length) return
    mark('copying the frame')
    setStrokes((prev) => [...prev, ...made])
    for (const k of made) drawParty.send(k)

    /**
     * ⚠️ A SELECTION SURVIVES THE PRESS. This used to select the whole copied frame, which threw
     * away the one thing you had just done: selecting the arm. The walk cycle is select the arm,
     * + frame, nudge, + frame, nudge — and re-finding the arm on every new frame is the work that
     * makes anybody give up on animating. If the same strokes are still selected, the only thing
     * left to do on the new frame is move them.
     *
     * ⚠️ The originals do not move. A copy is new strokes on a new frame, so the pose you just
     * left keeps its arm exactly where it was.
     *
     * ⚠️ Nothing selected falls back to selecting everything, which is what it always did — with
     * no selection to preserve, "here is the whole pose, move what you like" is still the right
     * offer.
     */
    const kept = source
      .map((x, j) => (sel.includes(x.i) ? strokes.length + j : -1))
      .filter((n) => n >= 0)
    const next = kept.length ? kept : made.map((_, i) => strokes.length + i)
    /* survives the frame change — see selFor by the effect that clears a selection */
    selFor.current = { frame: to, sel: next }
    setSel(next)
    setSelecting(true)
  }

  const copyPrevFrame = () => {
    const at = frame ?? 0
    if (at <= 0) return
    carryFrame(at - 1, at)
  }
  /**
   * Make a layer hold still across every frame, or put it back on the frame you are on.
   *
   * ⚠️ IT EDITS THE STROKES, which is why it needs nothing of its own to share: a held
   * stroke is one with no frame, the strokes already travel, and layerHolds reads the answer back
   * off them. Turning it off puts them on the CURRENT frame rather than the one they came from,
   * because they came from all of them — there is no earlier answer to restore.
   */
  const holdLayer = (i: number, on: boolean) => {
    mark(on ? 'holding that layer' : 'putting that layer on this frame')
    runLayerOp({ k: 'hold', i, f: on ? null : (frame ?? 0) }, true)
  }

  /**
   * The colour, opacity and width controls, acting on what you have SELECTED.
   *
   * ⚠️ THE SAME TRADE THE NOTE EDITOR'S LENGTH BUTTONS MAKE: while things are lit, a control
   * that could plainly act on them should, and with nothing lit it goes back to setting what you
   * draw next. Picking a colour with a selection live and watching it change only the NEXT stroke
   * is the version that makes you undo, reselect and go looking for a menu.
   *
   * ⚠️ IT STILL SETS THE TOOL TOO. You almost always want the thing you just recoloured and
   * the thing you draw next to match — and a control that stops setting the tool while something
   * is selected is a control whose meaning depends on state you might not have noticed.
   *
   * ⚠️ Strokes with no id are restyled locally and not announced. An id is the name the room
   * knows a stroke by; one loaded from a gallery file has never had one, which is the same limit
   * undo has always had rather than a new one.
   */
  const restyle = (patch: { c?: string; a?: number; w?: number; sy?: number; e?: number }) => {
    if (!sel.length) return
    const ids = sel.map((i) => strokes[i]?.id).filter((v): v is string => !!v)
    mark('that change')
    if (ids.length) runLayerOp({ k: 'style', ids, ...patch }, true)
    /* ⚠️ AND the unnamed ones, in the same press. These were an `else`, so a MIXED selection —
       anything drawn before sharing was switched on, picked together with anything drawn after —
       changed the named strokes and silently left the rest exactly as they were. */
    if (ids.length < sel.length)
      setStrokes((prev) =>
        prev.map((st, i) =>
          sel.includes(i) && !st.id
            ? {
                ...st,
                ...(patch.c !== undefined ? { c: patch.c } : {}),
                ...(patch.a !== undefined ? { a: patch.a } : {}),
                ...(patch.w !== undefined ? { w: patch.w } : {}),
                /* ⚠️ `sy` on the wire, `k` on the stroke: the op already spends `k` on which KIND
                   of op it is, so the field could not also be called that. Spread blindly and a
                   symmetry change would have set the stroke's k to the string 'style'. */
                ...(patch.sy !== undefined ? { k: patch.sy } : {}),
                ...(patch.e !== undefined ? { e: patch.e } : {}),
              }
            : st,
        ),
      )
  }
  const pickColour = (c: string) => {
    setColour(c)
    restyle({ c })
  }

  const nameOf = (i: number) => layerNames[i]?.trim() || `Layer ${i + 1}`

  /**
   * Every change to the stack goes through here, and only through here.
   *
   * ⚠️ APPLIED AND SENT IN ONE PLACE, so "does this travel?" is not a question you have to ask
   * about each button. The four of them used to hold their own copies of the arithmetic, which is
   * also why none of them travelled: adding sharing would have meant four more messages and four
   * more chances to describe the change slightly differently at the other end. Now there is one
   * transform (applyLayerOp) and one message.
   */
  const runLayerOp = useCallback((op: LayerOp, send: boolean) => {
    const next = applyLayerOp(stackRef.current, op, layerCount(drawingRef.current))
    setStrokes(next.strokes)
    setLayerNames(next.names)
    setHidden(next.hidden)
    setLayer(next.layer)
    if (send) drawParty.layers(op)
  }, [])

  /**
   * THE PET WIZARD.
   *
   * ⚠️ IT LIVES IN PAINT, NOT IN THE PETS ROOM, and that was the question worth settling first.
   * Every step of making a pet except the very last one is DRAWING — body, add a layer, draw a
   * part, name it, repeat. All of that needs the paint room's tools and the paint room's state.
   * A wizard on the Pets page could only say "now go somewhere else and do six things, then come
   * back", which is exactly what the written instructions already say and exactly what was not
   * enough. The one Pets-side step, adopting it, is a single function call and can happen from
   * here.
   *
   * ⚠️ IT NAMES THE PART BEFORE YOU DRAW IT, which is the whole reason it teaches anything.
   * "Draw something, then tell me what it was" leaves you staring at a blank layer; "now draw a
   * wing" is an instruction. It also means the thing that makes a pet move — the layer's name —
   * gets set by pressing the word rather than by remembering to.
   *
   * ⚠️ IT WATCHES RATHER THAN ASKING. There is no Next button: the step is done when the layer
   * it is waiting on has a stroke on it, which the room already knows. A wizard you have to
   * confirm your way through is a form.
   */
  type PetStep =
    | { phase: 'body'; layer: number }
    | { phase: 'pick' }
    | { phase: 'draw'; part: string; layer: number }
  const [petStep, setPetStep] = useState<PetStep | null>(null)

  /**
   * Words being written onto the picture, before they are a stroke.
   *
   * ⚠️ IT IS THE LIVE STROKE, not a separate preview. The pending text is written into
   * `live.current` — the same slot a half-drawn brush stroke uses — so it is painted by the same
   * code that paints the finished thing, at the same place, in the same colour and opacity. There
   * is no second rendering path that could disagree with the first, which is the failure mode
   * every "preview" feature has.
   */
  const [typing, setTyping] = useState<{
    line: [number, number, number, number]
    words: string
  } | null>(null)
  const typeBox = useRef<HTMLTextAreaElement>(null)

  const startPetWizard = () => {
    setSelecting(false)
    if (frame !== null) goFrame(null)
    /* ⚠️ The room remembers the tool you left on (saveLastKit), so "draw the body" could arrive
       with Text selected — and the first drag would open a prompt instead of drawing. Only the two
       that cannot make a body are overridden; a marker or a crayon is a fine way to draw one. */
    if (tool === 'text' || tool === 'fill') setTool('brush')
    /* whatever is already on the board is the body — starting over would throw away work */
    if (strokes.some((k) => (k.l ?? 0) === layer)) {
      nameLayerIfBlank(layer, 'body')
      setPetStep({ phase: 'pick' })
    } else {
      setPetStep({ phase: 'body', layer })
    }
  }

  const nameLayerIfBlank = (i: number, to: string) => {
    if ((layerNames[i] ?? '').trim()) return
    /* a name is in the snapshot, so writing one without marking leaves the history describing a
       picture that is not the one on the page — see markAs */
    mark(`naming it ${to}`)
    runLayerOp({ k: 'name', i, name: to }, true)
  }

  const petAddPart = (part: string) => {
    if (layers >= MAX_LAYERS) return
    const at = layers
    mark(`a ${part} layer`)
    /* ⚠️ ONE op, not an add and then a name — see the note on LayerOp.add */
    runLayerOp({ k: 'add', name: part }, true)
    setLayer(at)
    setPetStep({ phase: 'draw', part, layer: at })
  }

  /* ⚠️ the step advances when the drawing says so, not when a button is pressed */
  useEffect(() => {
    if (!petStep) return
    if (petStep.phase === 'body' && strokes.some((k) => (k.l ?? 0) === petStep.layer)) {
      nameLayerIfBlank(petStep.layer, 'body')
      setPetStep({ phase: 'pick' })
    }
    if (petStep.phase === 'draw' && strokes.some((k) => (k.l ?? 0) === petStep.layer)) {
      setPetStep({ phase: 'pick' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, petStep])

  const finishPet = () => {
    /* ⚠️ offered back, so keeping an edited creature under its own name updates it */
    const name = window.prompt('What is your minion called?', docName)?.trim() ?? ''
    if (!name) return
    setDocName(name)
    const art = { ...drawingRef.current, name }
    saveArt(art)
    const made = savePet(name, art)
    setPetStep(null)
    setNote(
      made
        ? `${made.name} is yours — find them in 🐾 Minions.`
        : 'That could not be kept — is there anything on the page?',
    )
    window.setTimeout(() => setNote(null), 6000)
  }

  /**
   * The pet as it stands, for the live preview beside the guide.
   *
   * ⚠️ MEMOISED ON WHAT A PET IS MADE OF, and it matters: PetView reads the rig out of the
   * drawing, which walks every stroke twice, and this component re-renders on every pointermove
   * of a drag. Keyed on the committed strokes means it rebuilds when you finish a stroke rather
   * than while you are making one — which is also when there is anything new to show.
   */
  const petPreview = useMemo(
    () => ({ ...drawingRef.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [strokes, layerNames, bg, fps],
  )

  /**
   * ⚠️ REBUILT FROM THE PICKERS EVERY TIME, which is what makes the colour and the size live:
   * the pending stroke is never stored, it is derived, so changing a swatch changes the words on
   * the paper on the next repaint without anything having to remember to tell it.
   */
  const pendingText = (): Stroke | null => {
    if (!typing) return null
    const [x0, y0, x1, y1] = typing.line
    return {
      t: 'text',
      c: colour,
      a: alpha,
      w: width,
      k: symmetry,
      e: echo,
      l: layer,
      f: frameForNew(),
      x: typing.words,
      /* ⚠️ exactly the line you dragged. Size and angle are the drag, and after it is placed
         they are the selection handles — which is two ways of saying "drag it", rather than a
         third set of buttons doing the same job worse. */
      p: [x0, y0, x1, y1],
    }
  }

  useEffect(() => {
    if (!typing) return
    live.current = pendingText()
    preview()
    /**
     * ⚠️ Pressing a swatch moves the focus onto that button, so the next letter would be typed
     * into nothing. Taking it back on every picker change is what lets the colour be chosen
     * mid-word — which is the whole reason the words are live in the first place.
     *
     * ⚠️ preventScroll, AND IT IS THE WHOLE BUG — reported as text that "doesn't anchor where
     * i drew the line to". Focusing an element scrolls the page to bring it into view, and this
     * one sits above the paper in the document, so the browser scrolled UP and the paper moved
     * 371 measured pixels DOWN the viewport at the instant the drag ended. The words were always
     * at the right fraction of the canvas; the canvas was no longer where the line had been drawn.
     * React's autoFocus does the same thing and takes no options, which is why it is gone.
     */
    typeBox.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing, colour, alpha, symmetry, echo])

  const placeText = () => {
    const s = pendingText()
    setTyping(null)
    if (!s || !s.x?.trim()) {
      live.current = null
      preview()
      return
    }
    /**
     * ⚠️ IT ARRIVES SELECTED, with the select tool on. Asked for directly, and it is the right
     * answer to both of the things buttons were doing badly: the corner handles resize it and the
     * knob turns it, so the size and the angle you dragged are a starting point rather than a
     * decision you are stuck with. commit appends, so the new stroke is at the end of the list as
     * it stands now.
     */
    const at = strokes.length
    commit({ ...s, x: s.x.trim().slice(0, 240) })
    setSel([at])
    setSelecting(true)
  }

  /**
   * A text box does not outlive the tool that opened it.
   *
   * ⚠️ AN EMPTY ONE WAS A DEAD END. Draw a line, type nothing, press ⚬ Select: you land in
   * select mode with an invisible field still holding the focus, so every key you press goes into
   * a text box you cannot see and the effect beside pendingText keeps taking the focus back.
   * Reported as being stopped from switching to select mode, and it is — the mode changed, the
   * keyboard did not.
   *
   * ⚠️ IT PLACES RATHER THAN DISCARDS, because placeText already draws the distinction: words
   * are committed, an empty box is thrown away. Walking off mid-word should not lose the word.
   *
   * ⚠️ ONLY THE TOOL AND THE MODE. Colour, size, opacity and the effects deliberately do NOT
   * end it — being able to change those while the words are still live is the whole reason this is
   * a live text box rather than the browser prompt it replaced.
   */
  useEffect(() => {
    if (!typing) return
    if (tool !== 'text' || selecting) placeText()
    /* ⚠️ not on `typing`: this reacts to LEAVING, and listing it would fire the moment a box
       opens. eslint cannot see that distinction. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, selecting])

  const dropText = () => {
    setTyping(null)
    live.current = null
    preview()
  }

  /**
   * How the text tool works, up for as long as it is the tool.
   *
   * ⚠️ ON THE TOOL AND NOT ON THE TYPING. Put up when a text box opened, it added a line to
   * the page at the exact moment the drag finished — reflowing everything below the paper while
   * the hand was still moving. Tied to the tool, the layout settles when you press T, and the
   * instructions are readable BEFORE you drag, which is when they are any use.
   */
  useEffect(() => {
    if (tool !== 'text') return
    setNote(
      'Drag a line for the size and angle, then type. Shift+Enter for a new line, Enter to place.',
    )
    return () => setNote(null)
  }, [tool])

  /** what the wizard has understood so far, in the pet's own words */
  /* ⚠️ the word you typed, deduped by what it does — see the same note in PetsRoom */
  const petParts = [
    ...new Map(
      layerNames
        .map((n, i) => ({ n: (n ?? '').trim(), i }))
        .filter((x) => x.n && strokes.some((k) => (k.l ?? 0) === x.i))
        .map((x) => [partOf(x.n), `${x.n.toLowerCase().slice(0, 18)} ${PART_DOES[partOf(x.n)]}`]),
    ).values(),
  ]

  /**
   * What this creature could fight with.
   *
   * ⚠️ THE ROOM SAID WHAT EVERY PART DOES AND NOT WHAT ANY OF THEM IS FOR. "head bobs and
   * tilts, wing flaps" is the whole answer for a creature that only ever stands in a corner, and
   * no answer at all for one you are drawing to take into a scrap — you had to keep it, adopt it,
   * open the games tab and press things to find out that a tail is your long one. The rig was
   * invisible until the preview existed; the move list was invisible until this did.
   *
   * ⚠️ IT NAMES THE DIRECTIONS, because that is the part nobody would guess: which of your
   * parts answers up, and which answers down, is decided by what you drew rather than by you.
   */
  /**
   * A part painted over something it usually sits behind.
   *
   * ⚠️ SAID, NOT SORTED. Layer order is paint order and paint order is a choice somebody made
   * while drawing — a tail crossing in front of the body may be exactly the creature they meant.
   * The arrows to fix it are already on the layer row; the only thing missing was knowing to look.
   */
  const petStack = useMemo(() => inFrontOfOrder(petPreview)[0] ?? null, [petPreview])

  /**
   * The frame that actually becomes your creature.
   *
   * ⚠️ WHERE AND HOW BIG YOU DRAW IS THROWN AWAY, and nothing said so. A creature is cropped to
   * its own ink and then drawn at one fixed height wherever it appears, so a tiny sketch in a
   * corner and a huge one filling the page come out identical — which is exactly right, and
   * exactly the thing that reads as "drawing in different sizes isn't representing what your guy
   * will look like". Showing the crop turns an invisible rule into a rectangle.
   *
   * ⚠️ ONLY WHILE MAKING A MINION. On an ordinary drawing there is no creature and the frame
   * would be a box around your picture for no reason.
   */
  const petCrop = useMemo(() => {
    const b = petStep ? inkBox(petPreview) : null
    if (!b) return null
    /* ⚠️ HELD INSIDE THE PAGE. inkBox pads out past the ink, and past the paper with it, so an
       unclamped frame hangs off the board — where the board's own overflow clips it and takes the
       label with it. The part off the page is not paper anyway. */
    const at = (v: number) => Math.max(0, Math.min(1, v))
    return { x0: at(b.x0), y0: at(b.y0), x1: at(b.x1), y1: at(b.y1) }
  }, [petStep, petPreview])

  const petMoves = useMemo(() => {
    const parts = attacksOf(rigOf(petPreview))
    if (!parts.length) return null
    return moveTable(parts)
  }, [petPreview])

  /**
   * What this drawing would be if somebody stood it up in the park.
   *
   * ⚠️ THE PARK ALREADY SAYS THIS AND THE PLACE YOU DRAW DID NOT. Size, health, pace, nerve and
   * the range it fights at are all read out of the picture — and the one room where you can still
   * change the picture was the one room that never mentioned them. Asked for twice, in those words:
   * the more you can see of what everything will be, the better.
   *
   * ⚠️ THE SAME temperOf THE BOSS IS BUILT FROM, not a second reading of the drawing. A sentence
   * that could disagree with the creature it describes is worse than no sentence.
   *
   * ⚠️ MEMOISED with the move table beside it: it walks every stroke through rigOf twice.
   */
  const petBoss = useMemo(() => {
    const t = temperOf(petPreview)
    return { says: saysOf(t), life: t.life }
  }, [petPreview])

  const addLayer = () => {
    if (layers >= MAX_LAYERS) return
    /* ⚠️ the wizard's part button marks and this one did not, so the same action — adding a
       layer — was undoable from one path and not from the other, and this is the common one */
    mark('a new layer')
    runLayerOp({ k: 'add' }, true)
    /* ⚠️ Only the person who pressed it moves to the new layer — see applyLayerOp. Taking a
       peer's brush off what they were drawing on is not sharing, it is interfering. */
    setLayer(layers)
  }
  /**
   * Move a layer past its neighbour, taking its strokes with it.
   *
   * ⚠️ A LAYER IS A NUMBER ON A STROKE, not a container — see Stroke.l — so reordering is a swap
   * of that number on both sides rather than moving anything. The name, the hidden flag and which
   * layer you are drawing on all follow, or the row you just moved would be wearing its
   * neighbour's label.
   *
   * ⚠️ `s.l ?? 0` everywhere, because absent means the bottom layer. Comparing s.l directly would
   * quietly leave every stroke from before layers existed behind on layer zero.
   */
  /**
   * Dragging one layer onto another pours it in.
   *
   * ⚠️ THE ROW IS THE HANDLE, not a separate grip, because the row is already the thing you
   * point at to choose a layer — and a merge is "put this one into that one", which is a sentence
   * about two rows. Asked for directly.
   *
   * ⚠️ ONE OP. A move followed by a remove would be two ops off one handler, both reading the
   * stack as it was before either — see the note on `add` in layerOps.
   */
  const [dragLayer, setDragLayer] = useState<number | null>(null)
  const mergeLayer = (i: number, into: number) => {
    if (i === into) return
    /**
     * ⚠️ MARKED, LIKE EVERY OTHER MUTATION. The history is a snapshot of the strokes and the
     * layer names, and mark() is the only thing that pushes one — so without this a merge was not
     * undoable at all. Worse than nothing happening: the last snapshot in the list is from before
     * whatever you did BEFORE the merge, so one press of Undo took that away as well, and a stale
     * redo survived a merge that had invalidated it.
     */
    mark(`pouring ${nameOf(i)} into ${nameOf(into)}`)
    runLayerOp({ k: 'merge', i, into }, true)
  }

  const moveLayer = (i: number, dir: 1 | -1) => {
    const to = i + dir
    if (to < 0 || to >= layers) return
    /* ⚠️ and reordering is a mutation too — it rewrites `l` on every stroke of two layers, so
       leaving it out of the history left a redo list a reorder had already made wrong */
    mark(`moving ${nameOf(i)}`)
    runLayerOp({ k: 'move', i, to }, true)
  }

  /**
   * Remove a layer and everything drawn on it.
   *
   * ⚠️ ASKS FIRST WHEN THERE IS SOMETHING TO LOSE. Undo DOES bring it back now — the history
   * is a snapshot one, so a layer and its forty strokes come back in one press — but a question
   * before deleting forty strokes is still worth asking, and the history is forty steps deep
   * rather than forever. An empty layer is nothing to lose and goes without a question.
   *
   * ⚠️ Everything above it shifts DOWN a number, or the strokes on those layers would be
   * pointing at a layer that is no longer there and would all collapse onto the bottom.
   */
  const removeLayer = (i: number) => {
    if (layers <= 1) return
    const count = strokes.filter((st) => (st.l ?? 0) === i).length
    /* ⚠️ ASKS FIRST WHEN THERE IS SOMETHING TO LOSE, because undo cannot bring it back — it
       steps back one stroke at a time rather than being a snapshot history, so a layer with forty
       strokes on it is forty presses away even in principle. An empty layer goes without a
       question. The question is asked HERE and not at the other end: the peer is being told what
       happened, and asking them to approve a decision somebody already made is how you get two
       different pictures, which is the thing this travels to prevent. */
    if (count && !window.confirm(`Delete ${nameOf(i)} and the ${count} strokes on it?`)) return
    mark(`removing ${nameOf(i)}`)
    setSel([])
    runLayerOp({ k: 'remove', i }, true)
  }

  /**
   * ⚠️ Starting an animation puts you on frame 1, not frame 0.
   *
   * Everything already drawn has no frame, so it shows on all of them — it has become the
   * background. Landing on frame 0 would invite you to draw the first pose ON TOP of that shared
   * background with no way to tell them apart afterwards, whereas frame 1 makes "the bit that
   * stays" and "the bit that moves" two different places from the first stroke.
   */
  /**
   * Move the room's reel: which frame is showing, and how fast it plays back.
   *
   * ⚠️ SENT FROM THE BUTTON, not from an effect watching `frame`. The play loop writes the
   * frame every tick, so anything watching the value would broadcast a message per frame per
   * person — and an effect would also fire on a frame that ARRIVED, sending it straight back.
   * Only a press travels, which makes both problems not exist rather than guarded against.
   */
  const goFrame = (next: number | null, nextFps = fps) => {
    setPlaying(false)
    setFrame(next)
    if (nextFps !== fps) setFps(nextFps)
    drawParty.reel(next, nextFps)
  }

  /**
   * ⚠️ IT USED TO OPEN ON FRAME 2. `Math.max(1, frames)` is index 1 on a drawing that has no
   * frames yet, so pressing 🎬 Frames read "2 / 2" and left a frame 1 that nobody had made —
   * asked directly: "what is frame 1". Nothing was: everything drawn before the press becomes the
   * background, which shows on EVERY frame, and the reel itself started empty. So it starts at the
   * beginning now, and the first pose goes on frame 1.
   */
  const startFrames = () => goFrame(frame === null ? 0 : null)

  /**
   * Take this frame out, closing the gap behind it.
   *
   * ⚠️ The last frame leaving means there is no animation any more, so it leaves the mode too:
   * sitting on "frame 1 of 0" is a state with nothing to draw on and no way to read it.
   */
  const dropFrame = () => {
    const at = frame ?? 0
    mark(`frame ${at + 1}`)
    setSel([])
    runLayerOp({ k: 'unframe', f: at }, true)
    const left = frames - 1
    if (left <= 0) goFrame(null)
    else goFrame(Math.max(0, Math.min(left - 1, at)))
  }

  /**
   * ⚠️ STOPS THE ANIMATION FIRST, or it does not work at all.
   *
   * The play loop writes `frame` on every tick, so a new frame chosen while it is running is
   * overwritten before you ever see it — the button appeared to do nothing while the animation
   * carried on, which is exactly how it was reported. And stopping is what you wanted anyway:
   * you add a frame in order to draw on it.
   */
  /**
   * ⚠️ A NEW FRAME STARTS AS A COPY OF THIS ONE, which is the whole difference between an
   * animation tool and a stack of blank pages.
   *
   * It used to land you on an empty frame, and the way to get anything onto it was to notice
   * ⌘ From last — a second button, in a row of eight, that you had to know about before the
   * obvious gesture would do anything. Reported exactly that way: selecting a stroke and moving it
   * "is not enough to hold that frame because nothing was added unless you did a From last". It
   * was not: on an empty frame the only thing there to grab is the held background, and moving
   * THAT moves it on every frame, which is why nothing appeared to be added.
   *
   * Now the press that makes a frame also fills it, selects it and puts you in the select tool,
   * so the next pose is one drag away. A frame with nothing on it still gives a blank one, and
   * ⌘ From last still exists for a frame you already made and left empty.
   */
  const addFrame = () => {
    const at = Math.max(frames, (frame ?? 0) + 1)
    if (at >= 60) return
    const here = frame ?? 0
    goFrame(at)
    carryFrame(here, at)
  }

  /**
   * Which strokes a rectangle catches.
   *
   * ⚠️ ONLY WHAT YOU CAN SEE. A stroke on a hidden layer, or belonging to another frame, is
   * not offered to the rectangle — dragging a box on frame three and cutting something out of
   * frame one would be indistinguishable from the program losing your work. What is selectable
   * has to be what is on screen.
   *
   * Any point inside counts, rather than the whole stroke: a long line half in the box is
   * something you meant to catch, and requiring containment makes big strokes almost unselectable.
   */
  const inBand = (r: { x0: number; y0: number; x1: number; y1: number }) => {
    const lo = { x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1) }
    const hi = { x: Math.max(r.x0, r.x1), y: Math.max(r.y0, r.y1) }
    const out: number[] = []
    const { w, h } = size.current
    strokes.forEach((k, i) => {
      if (hidden.includes(k.l ?? 0)) return
      if (frame !== null && k.f !== undefined && k.f !== frame) return
      for (let n = 0; n < k.p.length; n += 2) {
        if (k.p[n] >= lo.x && k.p[n] <= hi.x && k.p[n + 1] >= lo.y && k.p[n + 1] <= hi.y) {
          out.push(i)
          return
        }
      }
      /**
       * ⚠️ AND FOR THE TWO THAT ARE NOT WHERE THEIR POINTS ARE, the box as well. A star's
       * points are its centre and one tip, and a kaleidoscope stroke is drawn k times around the
       * middle of the paper — so dragging a band over the copy you can SEE catches nothing, which
       * is the part of this that felt broken rather than merely imprecise.
       *
       * ⚠️ Only those two. Overlapping boxes for everything would make a long diagonal brush
       * stroke, whose box is most of the picture, get caught by almost any band — trading a
       * selection that misses for one that grabs things you did not point at.
       */
      if (!w || !h) return
      /* ⚠️ A FILL IS AN AREA, and until it carried one its only point was the spot you clicked —
         so a band round the shape you filled caught the outline and left the colour behind, which
         is exactly how a fill gets separated from the thing it fills. */
      if (k.t !== 'star' && k.t !== 'fill' && (k.k ?? 0) < 2) return
      const b = strokeBox(k, w, h)
      if (b.x1 >= lo.x && b.x0 <= hi.x && b.y1 >= lo.y && b.y0 <= hi.y) out.push(i)
    })
    return out
  }

  /** the box around the current selection, in 0-1 space, or null */
  /**
   * ⚠️ ROUND WHAT IS PAINTED, not round the points. The box used to be the extent of the point
   * list, which for a fat brush is inside the ink, for a star is half of it, and for a
   * kaleidoscope stroke can be on the other side of the paper — "its stroke box is oddly
   * shaped/placed and not the exact stroke". See strokeBox.
   */
  const selBox = () => {
    if (!sel.length) return null
    const { w, h } = size.current
    if (!w || !h) return null
    let x0 = 1
    let y0 = 1
    let x1 = 0
    let y1 = 0
    for (const i of sel) {
      const k = strokes[i]
      if (!k) continue
      const b = strokeBox(k, w, h)
      x0 = Math.min(x0, b.x0)
      x1 = Math.max(x1, b.x1)
      y0 = Math.min(y0, b.y0)
      y1 = Math.max(y1, b.y1)
    }
    return x1 > x0 || y1 > y0 ? { x0, y0, x1, y1 } : null
  }

  /**
   * Scaling and rotating what you have caught.
   *
   * ⚠️ ONE GESTURE, ONE MATRIX, APPLIED ON RELEASE — the same shape the note editor's drag has,
   * and for the same reason. The live picture is recomputed from the selection AS IT WAS when the
   * grip was taken, so dragging is a preview of one edit rather than hundreds stacked on each
   * other: drag out and back and you are exactly where you started, with no drift accumulated
   * through a hundred tiny multiplications.
   *
   * ⚠️ AND CORNERS ANCHOR ON THE OPPOSITE CORNER, which is what makes a drag feel like pulling
   * the box rather than moving it. Rotating pivots on the centre, because a corner pivot sends
   * the thing you are looking at off the page on the first degree.
   */
  const grip = useRef<{
    kind: 'scale' | 'rotate'
    /** the corner being dragged, and the one it pivots on */
    ax: number
    ay: number
    box: { x0: number; y0: number; x1: number; y1: number }
    from: Stroke[]
  } | null>(null)

  /** The matrix a pointer at (x, y) implies for the grip in progress. */
  const gripMatrix = (x: number, y: number): [number, number, number, number, number, number] => {
    const g = grip.current!
    if (g.kind === 'rotate') {
      const cx = (g.box.x0 + g.box.x1) / 2
      const cy = (g.box.y0 + g.box.y1) / 2
      const a0 = Math.atan2(g.ay - cy, g.ax - cx)
      const a1 = Math.atan2(y - cy, x - cx)
      const t = a1 - a0
      const cos = Math.cos(t)
      const sin = Math.sin(t)
      /* rotate about (cx, cy): translate to origin, rotate, translate back */
      return [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos]
    }
    /* scale from the opposite corner, which stays put */
    const px = g.ax
    const py = g.ay
    const w0 = g.box.x1 - g.box.x0
    const h0 = g.box.y1 - g.box.y0
    /* ⚠️ A FLOOR, NOT A CLAMP TO ZERO. A selection squashed to nothing cannot be dragged back
       out — every point would already be the same point — so the smallest it will go is a
       thousandth of the paper, which still looks collapsed and is still recoverable. */
    const sx = w0 > 1e-4 ? Math.max(0.001, Math.abs(x - px) / w0) * Math.sign(x - px || 1) : 1
    const sy = h0 > 1e-4 ? Math.max(0.001, Math.abs(y - py) / h0) * Math.sign(y - py || 1) : 1
    const fx = g.ax === g.box.x0 ? 1 : -1
    const fy = g.ay === g.box.y0 ? 1 : -1
    const a = sx * fx
    const d = sy * fy
    return [a, 0, 0, d, px - px * a, py - py * d]
  }

  /** the matrix the grip currently implies, for the preview only — never committed from here */
  const gripLive = useRef<[number, number, number, number, number, number] | null>(null)
  /**
   * ⚠️ ONE TIMER, AT A FIXED RATE, ADVANCING BY A FRACTION. Ticking once per stroke would
   * make the interval itself the speed control, and at sixty strokes a second that is a 16ms
   * timer whose jitter IS the timing. A steady 30Hz tick that adds speed/30 strokes each time
   * keeps the pace honest at every setting, and the count is floored only when it is read.
   *
   * ⚠️ AND IT STOPS AT THE END rather than looping. A replay is a thing you watch finish; a
   * loop would leave the picture flickering back to empty behind whatever you did next.
   */
  useEffect(() => {
    if (replayAt === null) return
    const total = strokes.length
    if (!total) {
      setReplayAt(null)
      return
    }
    let at = replayAt
    const id = window.setInterval(() => {
      at += replaySpeed / 30
      if (at >= total) {
        setReplayAt(null)
        return
      }
      setReplayAt(at)
    }, 1000 / 30)
    return () => window.clearInterval(id)
    // ⚠️ deliberately NOT depending on replayAt: this effect owns the count while it runs, and
    // re-arming the interval on every tick would restart the clock thirty times a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayAt === null, replaySpeed, strokes.length])

  useEffect(() => {
    repaint()
  }, [replayAt, repaint])

  const drop = () => setSel([])

  /**
   * Picking a brush, from the belt or from behind the All button.
   *
   * ⚠️ ONE HANDLER, because there are two ways in now and they must do the same four things.
   * The belt and the grid disagreeing about whether choosing a tool drops the selection is the
   * kind of difference nobody would find for weeks.
   */
  const chooseTool = (id: Tool) => {
    setTool(id)
    /**
     * ⚠️ CHOOSING A BRUSH LEAVES THE SELECTION TOOL, which is how every paint program
     * behaves and what was missing here. Selecting stayed on until you went back and switched it
     * off by hand, so finishing with a selection and wanting to draw meant hunting for the ⬚
     * again — reported as jarring, and it is: reaching for a brush IS saying you are done
     * selecting.
     */
    setSelecting(false)
    drop()
    setToolsOpen(false)

    toolUsed.current[id] = ++toolTick.current
    setBelt((b) => {
      if (b.includes(id)) return b
      /**
       * ⚠️ THE SLOTS DO NOT REORDER, and that is the whole difference between a belt and a
       * shuffling list. A most-recent-first belt moves every button every time you press one, so
       * the tool you wanted next is never where you just looked — the classic way this idea is
       * got wrong. A new tool takes the place of the one used longest ago and everything else
       * stays exactly where it was, so the belt learns without moving.
       */
      let worst = 0
      for (let i = 1; i < b.length; i++)
        if ((toolUsed.current[b[i]] ?? 0) < (toolUsed.current[b[worst]] ?? 0)) worst = i
      const next = b.slice()
      next[worst] = id
      return next
    })
  }

  /* a per-browser convenience, so the belt is the one you left — never anything but that */
  useEffect(() => {
    try {
      localStorage.setItem(BELT_KEY, JSON.stringify(belt))
    } catch {
      /* private window or full storage: the belt is simply the seed next time */
    }
  }, [belt])
  /* ⚠️ through a ref: blit is a useCallback on [scale] and must not be rebuilt per drag event */
  markRef.current = band.current ?? selBox()
  /* the selection, for repaint — which runs from a ref during a drag and would otherwise close
     over whatever it was when the callback was last built */
  selRef.current = sel
  /**
   * Everything — on the layer you are working on, and then everything everywhere.
   *
   * ⚠️ THE LAYER FIRST, because that is what you meant nine times in ten. Anybody pressing
   * All is in the middle of doing something to a layer, and handing them every stroke in the
   * picture means the next drag moves the parts they had carefully left alone. Asked for exactly
   * that way. inBand already skips hidden layers and other frames, so this only adds the one
   * thing it was missing.
   *
   * ⚠️ AND PRESSING IT AGAIN WIDENS to the whole picture, so nothing is taken away — moving
   * an entire drawing is still two presses rather than impossible. On a one-layer drawing the two
   * are the same set and nobody can tell the difference, which is the property that makes this
   * safe to change under drawings that already exist.
   */
  const selectAll = () => {
    const every = inBand({ x0: -1, y0: -1, x1: 2, y1: 2 })
    const mine = every.filter((i) => (strokes[i].l ?? 0) === layer)
    const already = mine.length === sel.length && mine.every((i) => sel.includes(i))
    setSel(mine.length && !already ? mine : every)
  }
  const copy = () => {
    if (!sel.length) return
    setClip(sel.map((i) => ({ ...strokes[i], p: [...strokes[i].p] })).filter(Boolean))
  }
  const cut = () => {
    if (!sel.length) return
    copy()
    mark('cutting that out')
    setStrokes((prev) => prev.filter((_, i) => !sel.includes(i)))
    drop()
  }
  const erase = () => {
    if (!sel.length) return
    mark('erasing that')
    setStrokes((prev) => prev.filter((_, i) => !sel.includes(i)))
    drop()
  }
  /**
   * ⚠️ PASTE STAMPS THE LAYER AND FRAME YOU ARE ON NOW, which is what makes this the
   * animation tool rather than only a copy tool. Select a frame, copy, add a frame, paste, and
   * nudge — that is frame-by-frame animation with the previous drawing as the starting point,
   * which is exactly what onion skin is for. Pasting things back onto the frame they came from
   * would have made the obvious workflow impossible.
   *
   * Offset slightly so a paste is visibly a second copy rather than an invisible one exactly on
   * top of the original.
   */
  const paste = () => {
    if (!clip.length) return
    const same = clip.every((k) => (k.f ?? -1) === (frame ?? -1) && (k.l ?? 0) === layer)
    const nudge = same ? 0.02 : 0
    const add = clip.map((k) => ({
      ...k,
      l: layer,
      f: frame ?? undefined,
      p: k.p.map((n) => n + nudge),
    }))
    mark('pasting')
    setStrokes((prev) => {
      const at = prev.length
      setSel(add.map((_, i) => at + i))
      return [...prev, ...add]
    })
  }

  const commit = (s: Stroke) => {
    live.current = null
    mark('that stroke')
    s.id = drawParty.mark()
    setStrokes((prev) => [...prev, s])
    // ⚠️ sent on COMPLETION, never while dragging — see party/draw.ts for why a half-drawn
    // stroke is not something the room should be shown
    drawParty.send(s)
  }

  /**
   * Two fingers: shove the picture about and pinch it bigger.
   *
   * ⚠️ IT IS THE PHONE'S MIDDLE BUTTON AND WHEEL, and it was simply missing. Zooming in is
   * how you draw anything small, and the room offered two ways to do it that a phone does not
   * have: a scroll wheel, and a middle-button drag. The slider moves the magnification but never
   * the part of the picture you are looking at, so on a touch screen you could go in and not go
   * anywhere — asked for as two fingers "moving panning stretching/pinching".
   *
   * ⚠️ THE SECOND FINGER CANCELS WHAT THE FIRST ONE STARTED, and that is not optional. The
   * first finger has already begun a stroke, a band, or a drag of the selection by the time the
   * second lands, and there is no gesture on a touch screen that starts with two fingers at
   * exactly the same instant. Every one of those has to be put back rather than committed, or
   * pinching to look closer would leave a smear across the picture every single time.
   *
   * ⚠️ ANCHORED BETWEEN THE FINGERS, for the reason the wheel is anchored under the pointer
   * — see onWheel. Zooming about the middle of the paper means whatever you leaned in to look at
   * slides out from under you while you do it.
   */
  const fingers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ gap: number; scale: number; ax: number; ay: number } | null>(null)

  const twoOf = () => {
    const it = fingers.current.values()
    const a = it.next().value
    const b = it.next().value
    return a && b ? ([a, b] as const) : null
  }

  /** put back whatever one finger had started, so a pinch cannot draw */
  const dropGesture = () => {
    live.current = null
    band.current = null
    grip.current = null
    gripLive.current = null
    pan.current = null
    bakeLive.current = false
    if (shove.current) {
      const was = shove.current.from
      shove.current = null
      setStrokes(was)
    }
  }

  const onDown = (e: React.PointerEvent) => {
    /**
     * ⚠️ A PRIMARY PRESS IS THE START OF A GESTURE, so nothing may still be down — and saying
     * so here is what stops a finger that left the glass without a pointerup from haunting the
     * map forever and making the next ordinary press look like the second finger of a pinch. The
     * obvious fix, ending the gesture on pointerleave, is worse: a mouse fires that simply for
     * being moved off the paper, and where the browser refused the pointer capture the room
     * deliberately keeps drawing to the edge (see the catch below), so it would cut strokes short.
     */
    if (e.isPrimary) fingers.current.clear()
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (fingers.current.size === 2) {
      const two = twoOf()
      dropGesture()
      if (two) {
        const [a, b] = two
        const anchor = at({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
        pinch.current = {
          gap: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          scale,
          ax: anchor[0],
          ay: anchor[1],
        }
      }
      repaint()
      return
    }
    /* a third finger is not a gesture this room has, and must not become a stroke either */
    if (fingers.current.size > 2) return
    /* ⚠️ Touching the paper ends the replay rather than drawing into a half-shown picture —
       which would look like the rest of your strokes had been lost. */
    if (replayRef.current !== null) setReplayAt(null)
    /**
     * ⚠️ CLICKING OFF A TEXT BOX PLACES IT, the way Paint's does — and the press is then spent,
     * because a click that both commits the words and starts the next box is one press doing two
     * things, which is how you end up with an empty text box you did not ask for.
     *
     * ⚠️ An EMPTY box is thrown away instead, and the press carries on into a normal drag. There
     * is nothing to commit, so making you click twice would just be a rule for its own sake.
     */
    if (typing) {
      if (typing.words.trim()) {
        placeText()
        return
      }
      dropText()
    }
    // middle button, or any button while zoomed out of reach, drags the picture around
    if (e.button === 1 || e.button === 2) {
      pan.current = { x: e.clientX, y: e.clientY }
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* nothing to capture */
      }
      return
    }
    const [x, y] = at(e)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* some inputs cannot be captured; drawing still works, it just stops at the edge */
    }
    /**
     * ⚠️ Inside the current selection starts a MOVE, anywhere else starts a new rectangle. It is
     * the behaviour every editor has and the only one that lets you drag something you have just
     * caught without catching something else instead.
     */
    if (selecting) {
      const box = selBox()
      const pad = 0.02
      /* ⚠️ HANDLES FIRST. They sit ON the edge of the box, so the move test below would
         otherwise swallow every one of them — you would grab a corner and the whole selection
         would slide instead of stretching. */
      if (box) {
        const g = gripPoints(box)
        const from = strokes.map((k) => ({ ...k, p: [...k.p] }))
        if (gripNear(x, y, g.rotate)) {
          grip.current = { kind: 'rotate', ax: x, ay: y, box, from }
          preview()
          return
        }
        const c = g.corners.find((p) => gripNear(x, y, p))
        if (c) {
          /* the corner it pivots on is the one diagonally opposite, carried on the handle */
          grip.current = { kind: 'scale', ax: c.ox, ay: c.oy, box, from }
          preview()
          return
        }
      }
      if (box && x >= box.x0 - pad && x <= box.x1 + pad && y >= box.y0 - pad && y <= box.y1 + pad) {
        shove.current = { x, y, from: strokesNow.current }
        preview()
        return
      }
      /**
       * ⚠️ WITH THE TEXT TOOL, EMPTY PAPER MEANS ANOTHER TEXT BOX, and without this the tool
       * is a liar: placing text turns the selection on so the handles can resize and turn it, and
       * the selection then swallowed every drag after it. The button stayed lit, the note still
       * said to drag a line, and dragging did nothing at all — reported as the text line "not
       * working… entirely up to the selection tool".
       *
       * It is the rule the tool row already follows one screen down: reaching for a brush IS
       * saying you are done selecting. Reaching for empty paper with the Text tool says it too.
       * Handles and the inside of the box are tested first, above, so adjusting what you just
       * wrote still works — it is only a drag somewhere else that starts the next one.
       */
      if (tool === 'text') {
        setSel([])
        setSelecting(false)
      } else {
        band.current = { x0: x, y0: y, x1: x, y1: y }
        setSel([])
        preview()
        return
      }
    }
    if (tool === 'fill') {
      /**
       * ⚠️ MEASURED NOW, AGAINST THE PICTURE AS IT IS. A fill is replayed over whatever is
       * under it, so if the strokes that bounded it are moved later it finds a different shape —
       * and an opened boundary turns a filled box into a filled page. Recording the region it
       * actually covered, here, at the one moment the boundary is known, gives the replay
       * somewhere to stop.
       *
       * ⚠️ `measure` leaves base alone; this reads the canvas and writes nothing.
       */
      const bc = base.current?.getContext('2d')
      const ext = bc
        ? floodFill(bc, x, y, colour === NONE ? null : colour, alpha, null, true)
        : null
      commit({
        t: 'fill',
        c: colour,
        a: alpha,
        w: width,
        k: 0,
        e: 0,
        p: ext ? [x, y, ext.x0, ext.y0, ext.x1, ext.y1] : [x, y],
      })
      return
    }
    /* ⚠️ once, here, rather than on every move — see bakeLive */
    bakeLive.current =
      tool === 'eraser' && strokes.some((k) => (k.l ?? 0) !== layer) && strokes.length > 0
    live.current = {
      t: tool,
      c: colour,
      a: alpha,
      w: width,
      k: symmetry,
      e: echo,
      l: layer,
      f: frameForNew(),
      p: isFreehand(tool) ? [x, y] : [x, y, x, y],
    }
    preview()
  }

  const onMove = (e: React.PointerEvent) => {
    if (fingers.current.has(e.pointerId))
      fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const held = pinch.current
    if (held) {
      const two = twoOf()
      if (!two) return
      const [a, b] = two
      const r = view.current!.getBoundingClientRect()
      const gap = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      const next = Math.max(1, Math.min(12, held.scale * (gap / held.gap)))
      const fx = ((a.x + b.x) / 2 - r.left) / r.width
      const fy = ((a.y + b.y) / 2 - r.top) / r.height
      off.current.x = held.ax - fx / next
      off.current.y = held.ay - fy / next
      clampOffset(next)
      /**
       * ⚠️ BOTH, EVERY TIME, and the obvious version of this was wrong. Two fingers do not
       * move in one event — each reports separately — so within a single batch the first finger's
       * move computes a gap the second has not caught up with yet. Asking `next === scale` to
       * decide whether to set it compares against the value React has not re-rendered with, so
       * the correcting update from the second finger was dropped and the zoom stuck at whatever
       * the half-updated gap implied. Measured: a pure shove with the gap identical at both ends
       * drove 3.0x to 1.1x.
       *
       * setScale with the value it already holds is a no-op React bails out of, and blit is what
       * actually moves the picture when only the offset changed — so doing both is correct for a
       * pinch and for a shove, and costs one extra paint on the frames that zoom.
       */
      setScale(next)
      blit()
      return
    }
    if (pan.current) {
      const r = view.current!.getBoundingClientRect()
      off.current.x -= (e.clientX - pan.current.x) / r.width / scale
      off.current.y -= (e.clientY - pan.current.y) / r.height / scale
      pan.current = { x: e.clientX, y: e.clientY }
      clampOffset(scale)
      blit()
      return
    }
    if (band.current) {
      const [bx, by] = at(e)
      band.current.x1 = bx
      band.current.y1 = by
      preview()
      return
    }
    if (grip.current) {
      const [gx, gy] = at(e)
      gripLive.current = gripMatrix(gx, gy)
      repaint()
      return
    }
    if (shove.current) {
      const [mx, my] = at(e)
      const dx = mx - shove.current.x
      const dy = my - shove.current.y
      shove.current = { x: mx, y: my, from: shove.current.from }
      // ⚠️ moved in place rather than re-added, so the indices the selection holds stay valid
      setStrokes((prev) => {
        /**
         * ⚠️ THE SELECTION CANNOT BE PUSHED OFF THE PAPER — "if I drag the strokes off the
         * screen they exist still but are gone."
         *
         * Exactly that: coordinates are fractions of the paper and nothing stopped them leaving
         * 0..1, so the strokes stayed in the file, stayed in the saved drawing, and were simply
         * nowhere anybody could see or reach them. Undo is per stroke and a drag is one move of
         * many strokes, so getting them back was not realistic either.
         *
         * A corner of the selection always stays on the paper. The pointer is still tracked
         * normally while it is out there, so dragging past the edge and coming back picks the
         * strokes up again rather than leaving them stuck where you gave up.
         */
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const i of sel) {
          const k = prev[i]
          if (!k) continue
          for (let j = 0; j + 1 < k.p.length; j += 2) {
            if (k.p[j] < minX) minX = k.p[j]
            if (k.p[j] > maxX) maxX = k.p[j]
            if (k.p[j + 1] < minY) minY = k.p[j + 1]
            if (k.p[j + 1] > maxY) maxY = k.p[j + 1]
          }
        }
        if (!Number.isFinite(minX)) return prev
        /** how much of the selection has to stay on the paper, as a fraction of it */
        const KEEP = 0.04
        const cx = Math.max(KEEP - maxX, Math.min(1 - KEEP - minX, dx))
        const cy = Math.max(KEEP - maxY, Math.min(1 - KEEP - minY, dy))
        if (!cx && !cy) return prev
        return prev.map((k, i) =>
          sel.includes(i) ? { ...k, p: k.p.map((n, j) => n + (j % 2 ? cy : cx)) } : k,
        )
      })
      return
    }
    const s = live.current
    if (!s) return
    const [x, y] = at(e)
    if (isFreehand(s.t)) {
      // ⚠️ skip points closer than a fraction of a percent — a fast drag emits hundreds of
      // events a second and every one of them would be stored forever in the saved file
      const px = s.p[s.p.length - 2]
      const py = s.p[s.p.length - 1]
      if (Math.hypot(x - px, y - py) < 0.002) return
      s.p.push(x, y)
    } else {
      s.p[2] = x
      s.p[3] = y
    }
    /* ⚠️ a baked eraser needs the whole picture rebuilt, because what it may touch is decided
       inside paintDrawing; everything else is one stroke dropped onto a finished canvas */
    if (bakeLive.current) repaint()
    else preview()
  }

  const onUp = (e?: React.PointerEvent) => {
    if (e) fingers.current.delete(e.pointerId)
    /* the gesture ends when it stops being two fingers, and the one still down must not go on
       to draw — dropGesture already emptied everything onUp below looks at */
    if (fingers.current.size < 2) pinch.current = null
    pan.current = null
    bakeLive.current = false
    if (band.current) {
      const r = band.current
      band.current = null
      // a tap rather than a drag clears the selection instead of catching nothing
      const tiny = Math.abs(r.x1 - r.x0) < 0.005 && Math.abs(r.y1 - r.y0) < 0.005
      setSel(tiny ? [] : inBand(r))
      preview()
      return
    }
    if (grip.current) {
      const m = gripLive.current
      const g = grip.current
      grip.current = null
      gripLive.current = null
      repaint()
      if (!m) return
      /* ⚠️ Plain mark, because a grip's preview never touches state — it paints from its own
         snapshot (see the note on grip), so the strokes at this moment are still the ones from
         before the gesture. Filed here rather than at pointerdown so a press that turns out not
         to move files no step at all. */
      mark(g.kind === 'rotate' ? 'turning it' : 'resizing it')
      const ids = sel.map((i) => g.from[i]?.id).filter((v): v is string => !!v)
      /* ⚠️ Same as restyle: named strokes travel, unnamed ones are edited here only. An id is
         what the room calls a stroke, and one loaded from a gallery file has never had one. */
      if (ids.length) runLayerOp({ k: 'xform', ids, m }, true)
      /* ⚠️ AND the unnamed ones — see restyle. As an `else` this left half of a mixed
         selection sitting where it started while the other half moved. */
      if (ids.length < sel.length)
        setStrokes((prev) => prev.map((k, i) => (sel.includes(i) && !k.id ? xformStroke(k, m) : k)))
      return
    }
    if (shove.current) {
      /* ⚠️ The array as it was when the drag began, which is one pointer — a move rebuilds
         the strokes it touches on every pointermove, so the objects in it stay untouched. */
      const was = shove.current.from
      const moved = was !== strokesNow.current
      shove.current = null
      if (moved) markAs('moving it', was)
      return
    }
    const s = live.current
    if (!s) return
    /**
     * ⚠️ TEXT ASKS FOR ITS WORDS ON RELEASE, and until then the drag has been drawing a guide
     * line (see the text case in paintOne). The order matters: the guide stays on screen while
     * the prompt is open, so you can see the size and angle you are about to type into.
     *
     * ⚠️ A TAP GETS A SENSIBLE BASELINE rather than nothing. Dragging sets the size and the
     * angle, which is the whole interaction — but somebody who simply clicks meant to put words
     * there, and a tool that does nothing on a click reads as broken.
     */
    if (s.t === 'text') {
      const dx = (s.p[2] ?? s.p[0]) - s.p[0]
      const dy = (s.p[3] ?? s.p[1]) - s.p[1]
      const line: [number, number, number, number] =
        Math.hypot(dx, dy) < 0.02
          ? [s.p[0], s.p[1], s.p[0] + 0.28, s.p[1]]
          : [s.p[0], s.p[1], s.p[2], s.p[3]]
      /**
       * ⚠️ NOT A PROMPT. A browser dialog is modal, unstyled, and — the reason it actually had
       * to go — it stops you touching anything else, so the colour and the size cannot be changed
       * while the words are being written. The whole point of text on a drawing is seeing it in
       * the picture before you commit to it.
       */
      live.current = null
      setTyping({ line, words: '' })
      preview()
      return
    }
    commit(s)
  }

  /** yours, or from a file — a stroke that has never had a name has never left this machine */
  const isMine = (k: Stroke) => !k.id || k.id.startsWith('me:')

  /**
   * Tell the room what a step back or forward did to YOUR strokes.
   *
   * ⚠️ BY ID, AND ONLY EVER ABOUT YOUR OWN. The two messages that already exist are "take back
   * the one called this" and "here is a stroke"; between them they express everything a snapshot
   * swap can do to a stroke of yours — gone, new, or changed, where changed is the two in a row.
   * Nothing here can name a peer's stroke, so nothing here can reach one.
   *
   * ⚠️ A stroke with no name cannot travel, which is the same limitation drawing together has
   * always had: an id is what the room calls a stroke, and one loaded from a gallery file has
   * never had one.
   */
  const tellRoom = (from: Stroke[], to: Stroke[]) => {
    const was = new Map<string, Stroke>()
    for (const k of from) if (k.id?.startsWith('me:')) was.set(k.id, k)
    const now = new Map<string, Stroke>()
    for (const k of to) if (k.id?.startsWith('me:')) now.set(k.id, k)
    for (const id of was.keys()) if (!now.has(id)) drawParty.undo(id)
    for (const [id, k] of now) {
      const before = was.get(id)
      if (!before) drawParty.send(k)
      else if (before !== k) {
        /* changed: taken back and re-stated under the same name, so both ends agree on what it
           is called and an undo and a redo stay exactly each other */
        drawParty.undo(id)
        drawParty.send(k)
      }
    }
  }

  /**
   * Put a remembered picture back.
   *
   * ⚠️ WHAT A PEER HAS DRAWN SINCE IS KEPT. This is the whole reason undo cannot simply assign
   * the old array: while drawing together the picture holds everybody's marks, and a snapshot from
   * before somebody else's stroke does not contain it. Assigning it would delete their work with
   * your undo key — the same trap the old per-stroke undo documented and stepped around.
   *
   * ⚠️ Matched on the NAME rather than on object identity, because one of the snapshots is a
   * deep copy taken for a drag preview. Identity would find nothing in common with it and append
   * every peer stroke a second time.
   */
  const restore = (step: Step) => {
    const snap = step.strokes
    const cur = strokesNow.current
    const known = new Set(snap.map((k) => k.id).filter(Boolean))
    const since = cur.filter((k) => !isMine(k) && k.id && !known.has(k.id))
    const next = since.length ? [...snap, ...since] : snap
    setSel([])
    setStrokes(next)
    setLayerNames(step.names)
    setBg(step.bg)
    // ⚠️ outside the updater: React may run an updater twice, and this one leaves the machine
    tellRoom(cur, next)
  }

  const undo = () => {
    const step = past[past.length - 1]
    if (!step) return
    setPast((p) => p.slice(0, -1))
    setFuture((f) => [
      ...f,
      {
        label: step.label,
        strokes: strokesNow.current,
        names: namesNow.current,
        bg: bgNow.current,
      },
    ])
    restore(step)
  }

  const redo = () => {
    const step = future[future.length - 1]
    if (!step) return
    setFuture((f) => f.slice(0, -1))
    setPast((p) => [
      ...p,
      {
        label: step.label,
        strokes: strokesNow.current,
        names: namesNow.current,
        bg: bgNow.current,
      },
    ])
    restore(step)
  }

  /**
   * A menu closes when you press somewhere that is not it.
   *
   * ⚠️ CAPTURE, AND pointerdown RATHER THAN click. Capture means this runs before the
   * button's own handler, so pressing the Gallery button while it is open is still that button's
   * toggle and not a close-then-reopen that leaves it stuck open. pointerdown means the menu is
   * gone the instant you touch the paper rather than on the mouse-up — the stroke you started is
   * the stroke you get.
   *
   * ⚠️ A PRESS INSIDE THE MENU IS NOT OUTSIDE IT, which is what the closest() checks are for:
   * choosing a tool, opening a picture or deleting one all happen inside and must not be treated
   * as dismissals. Each of those closes the menu itself where that is the right thing to do.
   */
  useEffect(() => {
    if (!galleryOpen && !toolsOpen) return
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (galleryOpen && !t?.closest?.('.paint-gallery-anchor')) setGalleryOpen(false)
      if (toolsOpen && !t?.closest?.('.paint-bar')) setToolsOpen(false)
    }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [galleryOpen, toolsOpen])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      /* ⚠️ A MENU GETS ESCAPE FIRST, before the selection ladder below. What is on top of the
         screen is what a person means to dismiss, and Escape falling through to "drop the
         selection" while a menu covers half the room is a keypress that appears to do nothing. */
      if (e.key === 'Escape' && (galleryOpen || toolsOpen)) {
        setGalleryOpen(false)
        setToolsOpen(false)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      if (mod && k === 'c' && sel.length) {
        e.preventDefault()
        copy()
      } else if (mod && k === 'x' && sel.length) {
        e.preventDefault()
        cut()
      } else if (mod && k === 'v' && clip.length) {
        e.preventDefault()
        paste()
      } else if (mod && k === 'a' && selecting) {
        e.preventDefault()
        selectAll()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
        e.preventDefault()
        erase()
      } else if (e.key === 'Escape' && sel.length) {
        drop()
      } else if (e.key === 'Escape' && selecting) {
        /* ⚠️ the SECOND Escape leaves the tool. One press clears what you have caught, which is
           what you want when the box grabbed the wrong thing; a second says you are finished
           selecting altogether. Getting out used to mean finding the ⬚ button again. */
        setSelecting(false)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  return (
    /* ⚠️ In a canvas window the board takes the height it is GIVEN. Outside one it has to pick
       a height, and vh is the only sensible guess — but inside a window that guess ignored the
       window, so dragging the bottom edge made it wider and never taller. */
    <section
      className={
        'paint-wrap' +
        (inWindow ? ' is-inwindow' : '') +
        (toolsHidden ? ' tools-hidden' : '') +
        (isFull ? ' is-full' : '')
      }
      ref={wrap}
    >
      {/**
       * ⚠️ EIGHTEEN BRUSHES IS A SCROLL ON A PHONE, so there it is one button that opens them.
       *
       * The row is fine on a desktop and stays exactly as it was — every brush visible, one press
       * each. On a narrow screen the same row pushed the paper down the page and had to be
       * scrolled past to reach anything else, which is the complaint. The button names the brush
       * you are on, so the state is still on screen when the list is not.
       *
       * ⚠️ One list, shown or hidden by a media query, rather than two renderings of it. Two
       * would drift, and the second copy would be the one nobody tested.
       */}
      {/**
       * Everything that is not the paper, as ONE panel.
       *
       * ⚠️ IT WAS TWO SIBLINGS, and that is why fullscreen could not do anything better with
       * them than take a slice of the picture. Two rows in the column flow can be hidden, but they
       * cannot be lifted OVER the drawing without overlapping each other — so wrapping them is
       * what makes the overlay below possible at all, and it costs one element.
       */}
      {/**
       * The brushes, back in the panel and directly above the colour.
       *
       * ⚠️ THIS NOTE USED TO ARGUE THE OPPOSITE, and the measurement it was built on was
       * real: the tool grid lived in the rail once, and at 21rem the seventeen tools wrapped to
       * five rows and ate 190px of a column that only has 538, with Effects, Undo, Redo, Clear,
       * Zoom and Fit all pushed below the fold. Undo is the button you reach for most and it was
       * off screen in the layout's resting state. So the tools went out to a full-width strip.
       *
       * ⚠️ WHAT CHANGED IS THAT THERE ARE NO LONGER SEVENTEEN OF THEM HERE. The belt is five
       * and a button, and the grid behind that button is an overlay that is only in the DOM while
       * it is open — so the thing that could not fit in the column is not in the column. The
       * strip had a cost of its own, which is the one that brought this back: "the brushes feel
       * far from the colors and stuff", and a full-width row at the top of the screen is about as
       * far from the rail as anything can be.
       *
       * ⚠️ AND THE STACKED LAYOUT DOES NOT NOTICE. Below 781px the board is order -2 and this
       * is order -1, with the panel after both — so being the panel's FIRST child puts it in
       * exactly the same place it was, between the paper and the rest of the controls. Between 781
       * and 1024 the panel is display:contents, so it is a wrap child either way. Only the rail
       * layout and fullscreen see a difference, which is where the complaint came from.
       */}
      <div className="paint-tools-panel">
        <div className="paint-bar">
          {/**
           * The belt: the last few you used, plus the way to everything else. See BELT_SIZE.
           *
           * ⚠️ THE CURRENT TOOL IS ALWAYS ON IT, because choosing one puts it there — so the
           * belt never shows you five brushes none of which is the one you are holding.
           */}
          <div className="paint-belt">
            {belt.map((id) => {
              const found = TOOLS.find(([x]) => x === id)
              if (!found) return null
              const [, icon, label] = found
              return (
                <button
                  key={id}
                  className={'fx-style-btn' + (tool === id ? ' is-on' : '')}
                  aria-pressed={tool === id}
                  onClick={() => chooseTool(id)}
                >
                  <span aria-hidden>{icon}</span>
                  <span className="fx-style-label">{label}</span>
                </button>
              )
            })}
            <button
              className="btn paint-tool-open"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((v) => !v)}
              title="Every brush"
            >
              <span aria-hidden>⋯</span> All
              <span aria-hidden>{toolsOpen ? '▴' : '▾'}</span>
            </button>
          </div>
          {/* ⚠️ RENDERED ONLY WHEN OPEN, not hidden with CSS, so the seventeen tools take no
            room in the column at all — which is the thing that drove them out of the rail. It is
            an overlay when it is up; see .paint-tools.is-open. */}
          {toolsOpen && (
            <div className="fx-style-row paint-tools is-open">
              {/* ⚠️ Retired ones are hidden here rather than deleted from TOOLS — the packed format
              stores a tool as an index into that list, so removing one repaints every saved
              drawing. See RETIRED_TOOLS. */}
              {TOOLS.filter(([id]) => !RETIRED_TOOLS.has(id)).map(([id, icon, label]) => (
                <button
                  key={id}
                  className={'fx-style-btn' + (tool === id ? ' is-on' : '')}
                  aria-pressed={tool === id}
                  onClick={() => chooseTool(id)}
                >
                  <span aria-hidden>{icon}</span>
                  <span className="fx-style-label">{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="paint-row paint-select">
          {/* ⚠️ SELECTING USED TO BE HERE, and the note that argued for it was about space:
            two rows each holding one button most of the time. It has gone to sit beside opacity
            and size, asked for, and it is the better home — choosing a colour, a width and then a
            handful of strokes to apply them to is one activity, while this row is now purely the
            stack. Frames left for its own row for a different reason; see the note there. */}
          <span className="muted paint-stack-label">Layers</span>
          {Array.from({ length: layers }, (_, i) => layers - 1 - i).map((i) => (
            <span
              key={i}
              className={
                'paint-layer' +
                (layer === i ? ' is-on' : '') +
                (dragLayer === i ? ' is-lifting' : '') +
                (dragLayer !== null && dragLayer !== i ? ' is-target' : '')
              }
              draggable
              onDragStart={(e) => {
                setDragLayer(i)
                e.dataTransfer.effectAllowed = 'move'
                /* Firefox will not start a drag without something on the transfer */
                e.dataTransfer.setData('text/plain', String(i))
              }}
              onDragEnd={() => setDragLayer(null)}
              onDragOver={(e) => {
                if (dragLayer === null || dragLayer === i) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(e) => {
                e.preventDefault()
                const from = dragLayer
                setDragLayer(null)
                if (from !== null) mergeLayer(from, i)
              }}
              title={
                dragLayer !== null && dragLayer !== i ? `Drop to pour into ${nameOf(i)}` : undefined
              }
            >
              <button
                className="paint-layer-pick"
                aria-pressed={layer === i}
                onClick={() => setLayer(i)}
                title={`Draw on ${nameOf(i)}`}
              >
                {nameOf(i)}
              </button>
              {/**
               * ⚠️ THE NAME IS THE RIG NOW, which is why this is a control of its own rather
               * than a double-click on the label. A pet's parts are read from its layer names
               * (pets/rig.ts), so naming a layer `wing` is the difference between a picture that
               * bobs and a bird that flaps — and a gesture with no button cannot be found by
               * somebody who has not been told, and does not exist at all on a phone.
               *
               * ⚠️ THE PROMPT SAYS WHICH WORDS DO SOMETHING. It is the only moment where that
               * fact is useful, and the alternative is a page of documentation nobody opens.
               */}
              <button
                className="paint-layer-eye"
                aria-pressed={!hidden.includes(i)}
                /* ⚠️ DELIBERATELY NOT MARKED, and it is the only layer op that is not. A Step holds
                   the strokes, the names and the paper — what the picture IS — and `hidden` is
                   what you are looking at while you work on it. Marking would push a step that
                   restores nothing, so Undo would appear to do nothing at all. */
                onClick={() => runLayerOp({ k: 'hide', i, on: !hidden.includes(i) }, true)}
                title={hidden.includes(i) ? 'Show this layer' : 'Hide this layer'}
              >
                {hidden.includes(i) ? '🚫' : '👁'}
              </button>
              {/* ⚠️ ONLY WHILE ANIMATING, because off an animation it would be a switch with no
                observable effect — every stroke shows on the one picture either way. */}
              {frame !== null && (
                <button
                  className={'paint-layer-eye paint-layer-hold' + (layerHolds(i) ? ' is-on' : '')}
                  aria-pressed={layerHolds(i)}
                  onClick={() => holdLayer(i, !layerHolds(i))}
                  disabled={!strokes.some((k) => (k.l ?? 0) === i)}
                  title={
                    !strokes.some((k) => (k.l ?? 0) === i)
                      ? 'Draw something on this layer first'
                      : layerHolds(i)
                        ? `${nameOf(i)} is in every frame — put it back on this one only`
                        : `Keep ${nameOf(i)} in every frame, so you never redraw it`
                  }
                >
                  {/* ⚠️ ONE GLYPH, LIT OR NOT. It was ↻ against →, and → does not say "only on
                    this frame" to anybody — it is a second symbol to learn for the state that is
                    simply the absence of the first. Lit or unlit is the same pattern every other
                    toggle in the room uses. */}
                  ↻
                </button>
              )}
              {/**
               * ⚠️ ONLY ON THE LAYER YOU ARE ON, and that one rule takes four buttons off every
               * other row. Each chip carried six controls, so twelve layers was seventy-two of
               * them and 263 pixels — half the side rail, for a list. It reads as a wall rather
               * than a stack, and it was the last thing in this room still growing without a
               * limit.
               *
               * The split is what you actually do to which layer. Hiding one is something you do
               * to the OTHERS — to see past them while you work — so the eye stays on every row.
               * Renaming, reordering and deleting are things you do to the one you are working on,
               * and selecting it first is a click you were making anyway.
               */}
              {layer === i && (
                <>
                  <button
                    className="paint-layer-eye"
                    onClick={() => {
                      const to = window
                        .prompt(
                          'Name this layer — wing, head, leg, tail, ear, eye, arm and antenna give it movement in the Minions room.',
                          layerNames[i] ?? '',
                        )
                        ?.trim()
                      if (to === undefined) return
                      mark(`renaming ${nameOf(i)}`)
                      runLayerOp({ k: 'name', i, name: to.slice(0, 24) }, true)
                    }}
                    title={`Rename ${nameOf(i)}`}
                    aria-label={`Rename ${nameOf(i)}`}
                  >
                    ✎
                  </button>
                  {/* ⚠️ Up means further FORWARD in the picture, which is up this list too — the rows
                  are drawn highest first, so the arrows point the way the layer actually moves. */}
                  <button
                    className="paint-layer-move"
                    onClick={() => moveLayer(i, 1)}
                    disabled={i >= layers - 1}
                    title={`Move ${nameOf(i)} in front`}
                    aria-label={`Move ${nameOf(i)} in front`}
                  >
                    ▲
                  </button>
                  <button
                    className="paint-layer-move"
                    onClick={() => moveLayer(i, -1)}
                    disabled={i <= 0}
                    title={`Move ${nameOf(i)} behind`}
                    aria-label={`Move ${nameOf(i)} behind`}
                  >
                    ▼
                  </button>
                  {/**
                   * ⚠️ MERGING NEEDS A BUTTON, and the note further up this row already said why:
                   * a gesture with no button cannot be found by somebody who has not been told,
                   * and does not exist at all on a phone. Dragging one row onto another is how you
                   * pour any layer into any other, and it is HTML5 drag — no touch device fires
                   * it, and no keyboard reaches it. So the common case gets a control: into the
                   * one below, which is the direction a stack is usually flattened.
                   *
                   * ⚠️ DOWN, NOT UP, so the lower layer's name survives and its strokes stay
                   * underneath — the same way round as dropping this row onto the one beneath it.
                   */}
                  <button
                    className="paint-layer-move"
                    onClick={() => mergeLayer(i, i - 1)}
                    disabled={i <= 0}
                    title={`Pour ${nameOf(i)} into ${nameOf(i - 1)}`}
                    aria-label={`Pour ${nameOf(i)} into ${nameOf(i - 1)}`}
                  >
                    ⤵
                  </button>
                  <button
                    className="paint-layer-move"
                    onClick={() => removeLayer(i)}
                    disabled={layers <= 1}
                    title={`Delete ${nameOf(i)}`}
                    aria-label={`Delete ${nameOf(i)}`}
                  >
                    ✕
                  </button>
                </>
              )}
            </span>
          ))}
          <button
            className="btn"
            onClick={addLayer}
            disabled={layers >= MAX_LAYERS}
            title="Add a layer above"
          >
            + layer
          </button>
        </div>

        {/**
         * Animating, on a line of its own.
         *
         * ⚠️ BECAUSE THE LAYER STRIP HAS NO MAXIMUM WIDTH. Every layer adds a chip of about two
         * hundred pixels carrying six controls, up to twelve of them — so in a wrapping row the
         * strip decides where everything after it lands. Reported exactly that way: as you add
         * layers the frame controls get split across lines. It is not that they were crowded, it
         * is that their position was a function of how many layers you happened to have, and the
         * eight controls of an open animation were dealt out across whatever gaps were left.
         *
         * ⚠️ AND IT COSTS NOTHING NOW, which is why it can simply be fixed rather than traded
         * against. This row sits below the paper since the layout pass, so the line it takes comes
         * out of space that was already under the fold — the board's height is worked out from the
         * furniture above it and does not know or care how many rows are beneath.
         */}
        <div className="paint-row paint-frames">
          <button
            className={'btn' + (frame !== null ? ' is-on' : '')}
            aria-pressed={frame !== null}
            onClick={startFrames}
            title={
              frame !== null
                ? 'Back to drawing one picture'
                : 'Animate — what you have drawn so far stays behind every frame'
            }
          >
            🎬 Frames
          </button>
          {frame !== null && (
            <>
              <button
                className="btn"
                onClick={() => goFrame(Math.max(0, (frame ?? 0) - 1))}
                disabled={(frame ?? 0) <= 0}
                title="Previous frame"
              >
                ◀
              </button>
              <span className="muted paint-frame-at">
                {(frame ?? 0) + 1} / {Math.max(frames, (frame ?? 0) + 1)}
              </span>
              <button
                className="btn"
                onClick={() => goFrame(Math.min(frames - 1, (frame ?? 0) + 1))}
                disabled={(frame ?? 0) >= frames - 1}
                title="Next frame"
              >
                ▶
              </button>
              <button
                className="btn"
                onClick={addFrame}
                title={
                  strokes.some((k) => k.f === (frame ?? 0))
                    ? 'Add a frame that starts as a copy of this one, ready to move'
                    : 'Add a frame after this one'
                }
              >
                + frame
              </button>
              {/* ⚠️ Next to + frame, because the pair is the point — anything you can add and not
                  remove is a press you have to be careful with, and this one could not be undone
                  even by hand: there was no way to take a frame out at all. */}
              <button
                className="btn"
                onClick={dropFrame}
                disabled={frames < 1}
                title={
                  frames <= 1
                    ? 'Remove this frame — it is the last one, so the animation ends too'
                    : `Remove frame ${(frame ?? 0) + 1} and close the gap`
                }
              >
                − frame
              </button>
              {/* ⚠️ The pair that answer "do I have to draw all this again". This one is for a
                pose that is nearly the last one; the ↻ on a layer row is for the parts that never
                change at all. Disabled with work already here, because copying on top of it would
                double every stroke silently. */}
              <button
                className="btn"
                onClick={copyPrevFrame}
                disabled={
                  (frame ?? 0) <= 0 ||
                  strokes.some((k) => k.f === frame) ||
                  !strokes.some((k) => k.f === (frame ?? 0) - 1)
                }
                title={
                  strokes.some((k) => k.f === frame)
                    ? 'There is already something on this frame'
                    : 'Copy the frame before this one, so you can move it instead of redrawing it'
                }
              >
                ⧉ From last
              </button>
              <label className="paint-onion" title="How many earlier frames show through behind">
                <span className="muted">Onion</span>
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={1}
                  value={onion}
                  onChange={(e) => setOnion(Number(e.target.value))}
                />
              </label>
              <button
                className={'btn' + (playing ? ' is-on' : '')}
                aria-pressed={playing}
                onClick={() => setPlaying((v) => !v)}
                disabled={frames < 2}
                title={playing ? 'Stop' : 'Play the animation'}
              >
                {playing ? '⏸' : '▶️'}
              </button>
              <label className="paint-onion" title="Frames a second">
                <span className="muted">{fps}fps</span>
                <input
                  type="range"
                  min={1}
                  max={24}
                  step={1}
                  value={fps}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setFps(n)
                    drawParty.reel(frame, n)
                  }}
                />
              </label>
            </>
          )}
        </div>

        {/* colour, paper, opacity and size — named, because the layout orders on this class */}
        <div className="paint-row paint-draw">
          <span className="paint-swatches" role="group" aria-label="Colour">
            {/* ⚠️ Transparency sits in the SWATCH ROW, not as a tool. It is a colour you can load
              into anything: brush with it and you rub out, fill with it and you clear a region,
              draw a box in it and you cut an outline. Reaching it only through an eraser tool
              meant the bucket could never be given nothing, so an area could be painted but not
              un-painted. */}
            <button
              className={'paint-swatch paint-swatch-none' + (colour === NONE ? ' is-on' : '')}
              aria-label="Transparent"
              aria-pressed={colour === NONE}
              title="Transparent — paint or fill with nothing"
              onClick={() => pickColour(NONE)}
            />
            {/* Next to transparency because it is the same kind of thing: a colour any tool can be
              loaded with, rather than a mode the tools have to know about. */}
            <button
              className={'paint-swatch paint-swatch-rainbow' + (colour === RAINBOW ? ' is-on' : '')}
              aria-label="Rainbow"
              aria-pressed={colour === RAINBOW}
              title="Rainbow — the colour moves along as you draw"
              onClick={() => pickColour(RAINBOW)}
            />
            {SWATCHES.map((c) => (
              <button
                key={c}
                className={'paint-swatch' + (colour === c ? ' is-on' : '')}
                style={{ background: c }}
                aria-label={c}
                aria-pressed={colour === c}
                onClick={() => pickColour(c)}
              />
            ))}
          </span>
          {/**
           * ⚠️ THE SITE'S OWN PAD, not the operating system's colour dialog.
           *
           * `input type=color` hands the choice to a native window that looks like nothing else
           * here, covers what you are painting, and on some platforms is a modal you have to
           * dismiss before you can see whether the colour was right. The theme already has a pad
           * built for exactly this — hue rail, shade square, live — and a paint room choosing
           * colours is the same job. Reusing it also means one place to improve rather than two
           * that drift.
           */}
          {/**
           * ⚠️ FOLDED AWAY LIKE THE PAPER, and for a reason the screenshot made obvious: the pad is
           * about a hundred and fifty pixels tall and it was open all the time, which made it far
           * and away the largest thing between the tools and the paper. The controls were taking
           * more of the screen than the drawing.
           *
           * ⚠️ The swatches immediately to the left do NOT fold, which is what makes this safe.
           * Changing colour is most of what anybody does in here, and that is what those are for;
           * the pad is for mixing a shade the swatches do not have, which is a thing you go looking
           * for. The chip shows the colour you are on, so folding the controls does not fold the
           * state away with them.
           */}
          <span className="paint-colour paint-fold">
            <button
              className={'btn paint-fold-open' + (colourOpen ? ' is-on' : '')}
              aria-expanded={colourOpen}
              onClick={() => setColourOpen((v) => !v)}
              title="Any colour the swatches do not have"
            >
              <span
                className="paint-fold-chip"
                aria-hidden
                style={colour === NONE || colour === RAINBOW ? undefined : { background: colour }}
              />
              {/* ⚠️ "MIX" DID NOT READ AS A COLOUR PICKER. Watched somebody reach for the rainbow
                  swatch wanting a custom colour, because a band of every colour looks far more like
                  "choose one" than a word that could equally mean blending two. The swatches beside
                  it are all colours, so the odd one out has to say what it is for. */}
              Any colour
            </button>
            {colourOpen && (
              <span className="paint-fold-pop">
                <ShadePad
                  label="Colour"
                  value={colour === NONE || colour === RAINBOW ? '#22c55e' : colour}
                  onChange={pickColour}
                />
              </span>
            )}
          </span>
          {/**
           * ⚠️ PAPER IS FOLDED AWAY, and the reason is how often each one is wanted rather than
           * how important they are. Two identical pads side by side read as one choice with two
           * halves, so the wrong half got hit — and changing the paper is the rarer intention by a
           * long way, while changing the brush is most of what anybody does in here.
           *
           * ⚠️ The swatch still SHOWS the current paper, so folding it does not hide the state —
           * only the controls for it. That also takes a whole pad out of a toolbar that had grown
           * bulky enough to be worth complaining about.
           */}
          <span className="paint-colour paint-fold">
            <button
              className={'btn paint-fold-open' + (paperOpen ? ' is-on' : '')}
              aria-expanded={paperOpen}
              onClick={() => setPaperOpen((v) => !v)}
              title="The backdrop behind the picture — everything else here is paint"
            >
              <span
                className="paint-fold-chip"
                aria-hidden
                style={bg ? { background: bg } : undefined}
              />
              Paper
            </button>
            {paperOpen && (
              <span className="paint-fold-pop">
                <ShadePad
                  label="Paper"
                  value={bg ?? '#111111'}
                  onChange={(c) => {
                    setBg(c)
                    drawParty.paper(c)
                  }}
                />
                <button
                  className={'btn' + (bg === null ? ' is-on' : '')}
                  onClick={() => {
                    setBg(null)
                    drawParty.paper(null)
                  }}
                  title="No paper — the picture stays transparent"
                >
                  None
                </button>
              </span>
            )}
          </span>
          <label className="appearance-slider">
            {/* Renamed: "Alpha" read as a mode when it is really just how thin the paint is.
              Transparency proper is the swatch above. */}
            <span className="muted" title="How thin the paint is — 100 is solid">
              Opacity
            </span>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={alpha}
              onChange={(e) => {
                const a = Number(e.target.value)
                setAlpha(a)
                restyle({ a })
              }}
            />
            <span className="appearance-slider-val">{Math.round(alpha * 100)}</span>
          </label>
          <label className="appearance-slider">
            <span className="muted">Size</span>
            <input
              type="range"
              min={0.0015}
              max={0.09}
              step={0.0005}
              value={width}
              onChange={(e) => {
                const w = Number(e.target.value)
                setWidth(w)
                restyle({ w })
              }}
            />
            <span className="appearance-slider-val">{Math.round(width * 1000)}</span>
          </label>
          {/* ⚠️ BESIDE THE COLOUR AND THE SIZE, asked for. Picking a colour, picking a width
             and picking which strokes to apply them to is one activity, and selecting was two rows
             away from the other two — next to the layer stack, which is a different question. */}
          <span className="paint-row-divide" aria-hidden />
          <button
            className={'btn' + (selecting ? ' is-on' : '')}
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((v) => !v)
              drop()
            }}
            title="Drag a box round some strokes, then move, copy or cut them"
          >
            ⬚ Select
          </button>
          {selecting && (
            <>
              <button
                className="btn"
                onClick={selectAll}
                title={`Everything on ${layerNames[layer]?.trim() || `layer ${layer + 1}`} — press again for every layer`}
              >
                All
              </button>
              <span className="muted paint-select-count">
                {sel.length ? `${sel.length} picked` : 'drag a box'}
              </span>
              <button className="btn" onClick={copy} disabled={!sel.length} title="Copy (Ctrl+C)">
                Copy
              </button>
              <button className="btn" onClick={cut} disabled={!sel.length} title="Cut (Ctrl+X)">
                Cut
              </button>
              {/* ⚠️ paste lands on the layer and frame you are on now — see paste() */}
              <button
                className="btn"
                onClick={paste}
                disabled={!clip.length}
                title={
                  frame === null
                    ? 'Paste (Ctrl+V)'
                    : 'Paste onto this frame (Ctrl+V) — the way to build the next pose'
                }
              >
                Paste{clip.length ? ` · ${clip.length}` : ''}
              </button>
              <button
                className="btn"
                onClick={erase}
                disabled={!sel.length}
                title="Delete the selection"
              >
                ✕
              </button>
            </>
          )}
        </div>

        {/**
         * What you do TO the picture, rather than what you draw it with.
         *
         * ⚠️ SPLIT OUT OF THE COLOUR ROW, which had grown to twenty-four controls holding
         * things you touch every few seconds next to things you touch once a session — swatches
         * and the size slider beside Clear, Fit and the zoom. One row of equal-looking buttons is
         * a list to read rather than a place you know your way around, and the only way to find
         * the size slider was to scan past everything else. Split by how often a hand reaches for
         * it, they sort themselves: colour and size stay under the paper where they are wanted
         * constantly, and this row sits lower with the rest of the furniture.
         */}
        <div className="paint-row paint-picture">
          {/**
           * ⚠️ FOLDED, because these two are the least reached for and cost the most room.
           *
           * Symmetry and Echo are twelve buttons between them, and on a 1024px screen they were
           * most of what pushed the main row onto a third line — measured at 133px for that row
           * alone. They are also modifiers you set once for a picture and then leave, unlike the
           * colour and the size, which change constantly. Behind one button they cost 37px instead,
           * and the button says when either is on so a mandala is never a mystery.
           */}
          <span className="paint-fold">
            <button
              /* ⚠️ reads as ON while an effect is live, not merely while the fold is open. A badge
                 two characters wide was not enough to notice — see the note on symmetry above,
                 and the person who could not find what was multiplying their strokes. */
              className={
                'btn paint-fold-open' +
                (fxOpen ? ' is-on' : '') +
                (symmetry || echo ? ' is-live' : '')
              }
              aria-expanded={fxOpen}
              onClick={() => setFxOpen((v) => !v)}
              title="Mirroring and trailing copies"
            >
              Effects
              {symmetry || echo ? (
                <span className="paint-fold-badge">
                  {symmetry ? `×${symmetry}` : ''}
                  {symmetry && echo ? ' ' : ''}
                  {echo ? `≈${echo}` : ''}
                </span>
              ) : null}
            </button>
            {fxOpen && (
              <span className="paint-fold-pop paint-fold-wide">
                {/* ⚠️ A MODIFIER, not a tool: it applies to whichever of the fifteen tools is selected, so
            one control multiplies the whole toolbar rather than adding one more thing to it. It
            is remembered per stroke, so turning it off later leaves what you already drew. */}
                <label className="inst-pick">
                  <span
                    className="muted"
                    title="Mirror what you draw around the middle of the picture"
                  >
                    Symmetry
                  </span>
                  <span className="paint-sym-row">
                    {SYMMETRIES.map((n) => (
                      <button
                        key={n}
                        className={'btn' + (symmetry === n ? ' is-on' : '')}
                        aria-pressed={symmetry === n}
                        onClick={() => {
                          setSymmetry(n)
                          restyle({ sy: n })
                        }}
                        title={n === 0 ? 'No mirroring' : `${n} mirrored segments`}
                      >
                        {n === 0 ? 'Off' : n}
                      </button>
                    ))}
                  </span>
                </label>
                {/* the second modifier, and it composes with the first: an echoed mandala is one stroke
            drawn twelve times, twice over, from two numbers in the file */}
                <label className="inst-pick">
                  <span className="muted" title="Fading copies trailing the way you drew">
                    Echo
                  </span>
                  <span className="paint-sym-row">
                    {ECHOES.map((n) => (
                      <button
                        key={n}
                        className={'btn' + (echo === n ? ' is-on' : '')}
                        aria-pressed={echo === n}
                        onClick={() => {
                          setEcho(n)
                          restyle({ e: n })
                        }}
                        title={
                          n === 0
                            ? 'No trailing copies'
                            : `${n} trailing ${n === 1 ? 'copy' : 'copies'}`
                        }
                      >
                        {n === 0 ? 'Off' : n}
                      </button>
                    ))}
                  </span>
                </label>
              </span>
            )}
          </span>
          {/* ⚠️ NAMED BRUSHES WERE REMOVED — "the name this brush is kind of pointless".
            The argument for them was that six controls make a way of drawing rather than a
            setting, which is true and still was not worth the row: naming a brush is a thing you
            have to decide to do before you can benefit from it, and nobody did. The tool, colour,
            width, symmetry and echo you were last using are still restored on their own (see
            saveLastKit), which is the part people actually relied on.

            paintKits is left in place and untouched, so anything already saved is still there and
            putting this back is a few lines rather than a rebuild. */}
          {/* ⚠️ NAMED, like the profile editor's. "Undo" is a promise you have to take on
              trust; "Undo turning it" is one you can check before you press it — which matters far
              more now that a press can take back a rotate, a paste or a whole cleared page rather
              than always exactly one stroke. */}
          <button
            className="btn"
            onClick={undo}
            disabled={!past.length}
            title={past.length ? `Undo ${past[past.length - 1].label} (Ctrl+Z)` : 'Nothing to undo'}
          >
            {/**
             * ⚠️ THE LABEL IS FIXED, and what it is about to undo lives in the title beside the
             * shortcut. Naming the step inline meant the button changed width with the last thing
             * you did — "Undo" to "Undo clearing the picture" is ninety pixels — in a row that
             * wraps, so finishing a stroke could push Redo, Clear and the zoom onto another line.
             * A control that moves the moment you use it is the same fault the text tool had, and
             * it is worse here because Undo is the one button you reach for repeatedly and fast.
             */}
            ↶ Undo
          </button>
          <button
            className="btn"
            onClick={redo}
            disabled={!future.length}
            title={
              future.length
                ? `Redo ${future[future.length - 1].label} (Ctrl+Shift+Z)`
                : 'Nothing to redo'
            }
          >
            ↷ Redo
          </button>
          <button
            className="btn"
            /* ⚠️ the paper counts. Clear resets the background too now, so a page with a colour on
             it and nothing drawn is still a page with something to clear — gating on strokes
             alone left the one case the fix was reported for unreachable. */
            disabled={!strokes.length && !bg}
            onClick={() => {
              /* ⚠️ the question names the audience, because the answer changes what it does: while
               drawing together this clears everybody's page, not just yours */
              const q = party.on
                ? 'Clear the whole picture for everyone drawing?'
                : 'Clear the whole picture?'
              if (window.confirm(q)) {
                wipe()
                drawParty.clear()
              }
            }}
          >
            ✕ Clear
          </button>
          <label className="appearance-slider">
            <span className="muted" title="Or spin the wheel over the picture">
              Zoom
            </span>
            <input
              type="range"
              min={1}
              max={12}
              step={0.1}
              value={scale}
              onChange={(e) => {
                const next = Number(e.target.value)
                clampOffset(next)
                setScale(next)
              }}
            />
            <span className="appearance-slider-val">{scale.toFixed(1)}×</span>
          </label>
          <button
            className="btn"
            disabled={scale === 1 && !off.current.x && !off.current.y}
            onClick={() => {
              off.current = { x: 0, y: 0 }
              setScale(1)
            }}
            title="Back to the whole picture"
          >
            ⤢ Fit
          </button>
        </div>

        {/* ⚠️ The board is transparent, not white. A drawing has no background of its own, which is
          what lets the same picture sit on a light profile and a dark one — so the checkerboard
          behind it is the page telling you where the paint ends and the page begins. */}
        {note && (
          <p className="muted paint-note" role="status">
            {note}
          </p>
        )}

        {/* ⚠️ The paper is a BACKDROP, not paint. See `bg` above — this is the same colour a
          profile block will put behind the strokes, so what you draw against is what other
          people will see it against. With no paper the checkerboard shows through, which is how
          you can tell transparent from white. */}
        {/**
         * ⚠️ THE SHAPE AND THE SIZE, said out loud, right above the paper.
         *
         * The board's aspect used to be whatever was left over once the controls had wrapped, and
         * the aspect IS the document — coordinates are fractions of it. So art came out a shape
         * nobody chose, and differently on a phone than on a desktop. Naming the shape makes it a
         * decision; printing the pixels means you never have to infer it from looking.
         */}
        {/**
         * The pet guide, in the rail with the other controls.
         *
         * ⚠️ IT USED TO SIT ACROSS THE TOP, and the note here said that was because every
         * instruction on it is about what to do on the paper. That was true when the controls were
         * a band above the picture, and it is the wrong shape now: measured, at the "add a part
         * that moves" step it is a 918x268 slab that pushed the paper down to y=568 on a 768-tall
         * screen — most of the paper off the bottom of it. Reported as the paint being shifted
         * when the pet wizard opens.
         *
         * The reason it gave still holds — it belongs beside the paper — and the rail IS beside
         * the paper now. Fourteen part buttons are four short rows in a column instead of one very
         * wide line, which is the shape they wanted all along.
         */}
        {petStep && (
          <div className="paint-row paint-pet-guide">
            {petStep.phase === 'body' && (
              <>
                <strong>1 · Draw the body.</strong>
                <span className="muted">
                  Just the middle of the creature — head, wings and legs come next, each on their
                  own layer. This step finishes itself the moment you draw something.
                </span>
              </>
            )}

            {petStep.phase === 'draw' && (
              <>
                <strong>Draw the {petStep.part}.</strong>
                {/* ⚠️ A HIT IS NOT A BODY PART AND THE GENERIC SENTENCE SAID IT WAS. "Draw it
                    where it belongs on the body" is meaningless for an attack, and the word itself
                    is ambiguous — asked directly whether `hit` meant hitting them or being hit. */}
                {partOf(petStep.part) === 'hit' ? (
                  <span className="muted">
                    A <code>hit</code> is an attack <em>you throw</em>, not a wound you take — and
                    it is the one layer nobody sees until you swing. Draw the shape of the blow
                    where it lands: out to the side reaches further, above the head sends them
                    flying, and a bigger shape hurts more.
                  </span>
                ) : (
                  <span className="muted">
                    You are on a new layer called <code>{petStep.part}</code>, so this part{' '}
                    {PART_DOES[partOf(petStep.part)]} on its own. Draw it where it belongs on the
                    body.
                  </span>
                )}
                <button className="btn btn-ghost" onClick={() => setPetStep({ phase: 'pick' })}>
                  Skip this one
                </button>
              </>
            )}

            {petStep.phase === 'pick' && (
              <>
                <strong>Add a part that moves.</strong>
                <span className="muted">
                  Press one, then draw it. Each becomes its own layer, and the name is what makes it
                  move.
                </span>
                <span className="paint-pet-parts">
                  {PART_WORDS.map((w) => (
                    <button
                      key={w}
                      className="btn"
                      disabled={layers >= MAX_LAYERS}
                      onClick={() => petAddPart(w)}
                      title={`A layer called ${w} — it ${PART_DOES[partOf(w)]}`}
                    >
                      {w}
                    </button>
                  ))}
                </span>
                <button className="btn" disabled={!strokes.length} onClick={finishPet}>
                  ✓ That is everything
                </button>
              </>
            )}

            {/**
             * ⚠️ THE ANSWER TO "RATHER THAN GUESSING WHAT IT WILL MOVE LIKE". Naming a layer and
             * hoping was the whole problem: the rig is invisible, so the only way to find out was to
             * keep it, adopt it, and go and look. This is the real renderer at the real speed on the
             * real drawing, updating every time you finish a stroke or name a part.
             *
             * ⚠️ AND IT SHOWS FRAMES WHEN THERE ARE FRAMES, because paintPet already prefers a
             * drawn animation over the rig — so this doubles as a way to watch a frame animation
             * without leaving the room, and answers which of the two a given drawing is getting.
             */}
            {!!strokes.length && (
              <div className="paint-pet-preview">
                <PetView art={petPreview} size={96} label="your minion, moving" />
                <span className="muted">
                  {frameCount(petPreview) > 1
                    ? `Playing your ${frameCount(petPreview)} frames — a drawing with frames is animated by them rather than by its layer names.`
                    : petParts.length
                      ? `So far: ${petParts.join(', ')}`
                      : 'Nothing is named yet, so all of it just breathes.'}
                </span>
                {/**
                 * ⚠️ IT USED TO NAME THE MOVES AND NEVER SHOW ONE. "In a scrap: swipe, heavy
                 * gore, up buffet, down sweep" is four words, and four words is not a reason to
                 * call a layer `horn` — you had to take it on trust, keep the creature, adopt it
                 * and go and press things to find out what you had made. Said plainly: nobody
                 * picks a layer name for a fighting style they have never been shown.
                 */}
                {frameCount(petPreview) <= 1 && petStack && (
                  <span className="muted paint-pet-moves">
                    Your <strong>{petStack.name}</strong> is painted in front of your{' '}
                    <strong>{petStack.over}</strong>. That usually looks better the other way round
                    — the <strong>▼</strong> on its layer row tucks it behind. Nothing about the
                    fighting changes either way.
                  </span>
                )}
                {frameCount(petPreview) <= 1 && petMoves && (
                  <>
                    <span className="muted paint-pet-moves">
                      Every part you name is a move. Press one to watch it.
                    </span>
                    <MoveShow art={petPreview} moves={petMoves} tall={92} />
                    <span className="muted paint-pet-moves">
                      Called out as a boss: {petBoss.says} <strong>{petBoss.life}</strong> health.
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="paint-shape-row">
        <label className="paint-shape">
          {/* ⚠️ SHAPE, because "Paper" is already the background COLOUR two rows up. The same
             word on two controls that do different things is not a naming quibble: one of them is
             always the wrong one to have pressed. */}
          <span className="muted">Shape</span>
          <select
            className="viz-select"
            value={shape}
            onChange={(e) => {
              /**
               * ⚠️ THE PICTURE COMES WITH IT. Points are a fraction of the page, so a new page
               * shape re-proportions everything already on it — see reshapeStrokes. The strokes are
               * re-laid to keep what was drawn, and only the empty page is a free swap.
               *
               * ⚠️ AND FREE KEEPS WHAT YOU HAD rather than handing the page back to the
               * furniture, which is the same rule the first stroke follows.
               */
              const id = e.target.value
              const before = shapeAr || (dims.h ? dims.w / dims.h : 0)
              const after = PAPER_SHAPES.find(([k]) => k === id)?.[2] || 0
              if (
                strokes.length &&
                before > 0 &&
                after > 0 &&
                Math.abs(before / after - 1) > 0.002
              ) {
                mark('changing the paper shape')
                setStrokes((list) => reshapeStrokes(list, before, after))
              }
              if (!after && before > 0) setFreeAr(before)
              setShape(id)
              try {
                localStorage.setItem('paint_shape_v1', id)
              } catch {
                /* private mode: it holds for this visit */
              }
            }}
          >
            {PAPER_SHAPES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {/* ⚠️ MOVED DOWN FROM THE BRUSH ROW. Keeping a picture, opening the gallery and the
            stroke count are about the DOCUMENT, which is what this row already is — and that row
            had fourteen controls in it, twice its own width, so it wrapped onto three lines and
            pushed the paper off the bottom of the screen. */}
        {/**
         * ⚠️ A MENU ON ITS OWN BUTTON, NOT A ROW IN THE RAIL. The list used to be a full-width
         * row in the layout, which on a wide screen meant it opened INSIDE the column of controls
         * and pushed everything under it down: "when gallery is open it makes you have to scroll
         * the settings". Sixteen kept pictures is a taller list than the rail is, and always will
         * be, so it cannot be a thing the rail makes room for.
         *
         * Anchored to the button that opens it, it costs the layout nothing whether it is up or
         * down — the same bargain the tool grid makes, and it opens UPWARDS because this row sits
         * at the bottom of the screen.
         */}
        <span className="paint-gallery-anchor">
          <button
            className={'btn' + (galleryOpen ? ' is-on' : '')}
            aria-expanded={galleryOpen}
            onClick={() => setGalleryOpen((v) => !v)}
            title="Pictures you have kept"
          >
            🖼 Gallery{saved.length ? ` · ${saved.length}` : ''}
          </button>
          {galleryOpen && (
            <div className="paint-gallery">
              {!saved.length ? (
                <span className="muted">
                  Nothing kept yet. Draw something, then press <strong>Keep</strong>.
                </span>
              ) : (
                <ul className="paint-gallery-list">
                  {saved.map((a: Art) => (
                    <li key={a.id}>
                      <ArtThumb art={a.art} />
                      <span className="paint-gallery-name" title={a.name}>
                        {a.name}
                      </span>
                      <span className="muted paint-gallery-meta">
                        {a.art.strokes.length} strokes
                      </span>
                      <button
                        className="btn"
                        onClick={() => {
                          /**
                           * ⚠️ OPENING A PICTURE BROUGHT BACK ITS STROKES AND NOTHING ELSE, and the
                           * missing part was the layer NAMES. They saved correctly the whole time —
                           * the gallery holds them, packDrawing writes them, readDrawing reads them
                           * — they simply were not put back on the board, so every creature you
                           * reopened had its parts again and no idea what any of them were. Reported
                           * as the names not saving, which is what it looks like from the outside
                           * and is the one thing that was never true.
                           *
                           * ⚠️ AND THE REST OF THE BOARD IS THE PICTURE'S TOO. Frames a second
                           * belongs to the drawing that was made at it. Which layers are switched
                           * off does NOT travel with a picture (see the party handler, same rule),
                           * but the ones you had hidden refer to a drawing that is no longer here —
                           * left alone, layer 2 of whatever you just opened comes back invisible and
                           * reads as content that failed to load. A selection and an active layer
                           * belonging to the old picture are stale in exactly the same way.
                           */
                          mark(`opening “${a.name}”`)
                          setBg(a.art.bg)
                          setSel([])
                          setHidden([])
                          setLayer(0)
                          setLayerNames(a.art.layers ?? [])
                          if (a.art.fps) setFps(a.art.fps)
                          /* ⚠️ AND ITS SHAPE. A drawing's ratio is its proportions; opening it onto
                             whatever shape this window happens to be was the same stretch as
                             resizing — see freeAr. */
                          if (a.art.ratio > 0.05 && a.art.ratio < 20) setFreeAr(a.art.ratio)
                          /* so keeping it again updates this picture rather than making a second */
                          setDocName(a.name)
                          setStrokes(a.art.strokes)
                        }}
                        title="Open this, replacing what is on the board"
                      >
                        Open
                      </button>
                      <button
                        className="btn"
                        onClick={() => setSaving(a.art)}
                        title={`Save “${a.name}” as a picture or an animation`}
                      >
                        ⤓
                      </button>
                      <button
                        className="btn"
                        onClick={() => {
                          if (window.confirm(`Delete “${a.name}”?`)) removeArt(a.id)
                        }}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </span>
        <button
          className="btn"
          disabled={!strokes.length}
          onClick={() => {
            const name = window.prompt('Name this picture', docName)?.trim() ?? ''
            if (!name) return
            setDocName(name)
            const item = saveArt({ ...drawingRef.current, name })
            setNote(item ? `Kept “${item.name}”` : 'Nothing to keep yet.')
            window.setTimeout(() => setNote(null), 4000)
            if (item) setGalleryOpen(true)
          }}
        >
          ⬇ Keep
        </button>
        {/* ⚠️ Beside Keep because it ENDS in a keep — it is the same job with the steps said out
            loud, and the minion falls out at the end. */}
        <button
          className={'btn' + (petStep ? ' is-on' : '')}
          aria-pressed={!!petStep}
          onClick={() => (petStep ? setPetStep(null) : startPetWizard())}
          title={
            petStep
              ? 'Stop the guide — your drawing stays exactly as it is'
              : 'Walk me through making a creature that moves'
          }
        >
          🐾 Make a minion
        </button>
        {/**
         * ⚠️ A DIFFERENT WORD AND A DIFFERENT ARROW FROM KEEP, deliberately. Keep puts a picture
         * in the gallery on this site; this puts a file on your device. Two buttons a thumb apart
         * that both say ⬇ would be the same button as far as anybody reading quickly is
         * concerned, and the one that writes to your downloads folder is the wrong one to guess.
         */}
        <button
          className={'btn' + (saving ? ' is-on' : '')}
          aria-pressed={!!saving}
          disabled={!strokes.length}
          onClick={() => setSaving((v) => (v ? null : { ...drawingRef.current, name: '' }))}
          title="Save this as a picture or an animation you can send"
        >
          ⤓ Download
        </button>
        {call.inCall && (
          <button
            className={'btn' + (party.on ? ' is-on' : '')}
            aria-pressed={party.on}
            onClick={() => drawParty.setOn(!party.on)}
            title={
              party.on
                ? 'Stop sending your strokes to the call'
                : 'Draw together — finished strokes go to everyone in the call'
            }
          >
            {party.on ? '◉ Drawing together' : '◎ Draw together'}
          </button>
        )}
        {party.on && Object.keys(party.peers).length > 0 && (
          <span className="muted paint-peers">with {Object.values(party.peers).join(', ')}</span>
        )}
        <span className="muted paint-count">
          {strokes.length} stroke{strokes.length === 1 ? '' : 's'}
        </span>
        <span className="muted paint-dims" role="status">
          {dims.w > 0 ? `${dims.w}×${dims.h}` : '—'}
          {dims.h > 0 ? ` · ${(dims.w / dims.h).toFixed(2)}:1` : ''}
        </span>
        {/**
         * ⚠️ THE TOOLS FOLD AWAY, the way the visualiser's panel does — asked for because
         * fullscreen still had a wall of controls above the paper. It is most useful there, and
         * it costs nothing on the ordinary page, so it is not hidden behind a media query: the
         * moment you want the whole room to be picture, one press does it.
         *
         * ⚠️ This row stays, whatever happens, because the way back is in it. A control that can
         * hide the control that un-hides it is a trap.
         */}
        <button
          className={'btn' + (toolsHidden ? ' is-on' : '')}
          aria-pressed={toolsHidden}
          onClick={() => setToolsHidden((v) => !v)}
          title={toolsHidden ? 'Show the tools' : 'Hide the tools and draw'}
        >
          {toolsHidden ? '⌄ Tools' : '⌃ Tools'}
        </button>
        {/**
         * ⚠️ FREE, AND THAT IS WHY IT EXISTS. You asked whether a stroke-by-stroke replay would
         * cost too much space: it costs NONE. A drawing here has always been an ordered list of
         * strokes rather than an image, so the recording of how it was made IS the file — this
         * reads the list you already have, in the order it is already in. Nothing is saved,
         * nothing is duplicated, and it works on anything in the gallery the moment you open it.
         *
         * Offered only once there is something to watch, because a replay of one stroke is a
         * button that appears to do nothing.
         */}
        {strokes.length > 1 && (
          <button
            className={'btn' + (replayAt !== null ? ' is-on' : '')}
            aria-pressed={replayAt !== null}
            onClick={() => setReplayAt((v) => (v === null ? 0 : null))}
            title={replayAt !== null ? 'Stop and show the whole picture' : 'Watch it draw itself'}
          >
            {replayAt !== null ? '⏹ Replay' : '▶ Replay'}
          </button>
        )}
        {replayAt !== null && (
          <label className="appearance-slider paint-replay-speed" title="Strokes a second">
            <span className="muted">Speed</span>
            <input
              type="range"
              min={1}
              max={60}
              step={1}
              value={replaySpeed}
              onChange={(e) => setReplaySpeed(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{replaySpeed}</span>
          </label>
        )}
        <button
          className="btn"
          onClick={toggleFull}
          title="Fill the screen with the room — the tools come too"
        >
          ⛶
        </button>
      </div>
      {typing && (
        /**
         * ⚠️ NOTHING TO LOOK AT, ON PURPOSE. The bar that used to sit here showed you the words
         * you could already see on the paper, and offered a size you could already set by
         * dragging. What is left is a field with no appearance, which exists for the two things a
         * window keydown listener cannot do: raise the keyboard on a phone, and let an IME
         * compose a character.
         *
         * ⚠️ IT TAKES THE FOCUS BACK whenever a picker is touched — choosing a colour mid-word
         * moves the focus to that button, and the next letter would go nowhere. See the effect
         * beside pendingText.
         */
        <textarea
          ref={typeBox}
          className="paint-typing-hidden"
          value={typing.words}
          maxLength={240}
          aria-label="The words to put on the picture"
          onChange={(e) => setTyping((v) => (v ? { ...v, words: e.target.value } : v))}
          onKeyDown={(e) => {
            /* ⚠️ stopped as well as handled: the room listens for Escape and Ctrl+Z on the
               window, and a half-typed word is not a selection to drop or an edit to undo */
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.stopPropagation()
              placeText()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              dropText()
            } else if (e.key === 'Enter') {
              /* Shift+Enter is a new line, and the window must not hear it either */
              e.stopPropagation()
            }
          }}
        />
      )}
      {saving && <SaveArt art={saving} onClose={() => setSaving(null)} />}
      <div
        className={'paint-board' + (bg ? ' has-paper' : '') + (shapeAr ? ' has-shape' : '')}
        ref={host}
        /* ⚠️ Asked for, and the cost is honest: a double-click here also leaves two dots, because
           the board is a drawing surface and every press on it paints. The browser's own
           double-click rules do the work, so two deliberate presses in one spot go fullscreen and
           two strokes anywhere apart do not — and undo takes the dots back. */
        onDoubleClick={toggleFull}
        style={
          shapeAr
            ? ({
                ...(bg ? { background: bg } : null),
                '--paint-ar': String(shapeAr),
              } as CSSProperties)
            : bg
              ? { background: bg }
              : undefined
        }
      >
        <canvas
          ref={view}
          className="paint-canvas"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
        />
        {petCrop && (
          <span
            className="paint-crop"
            style={{
              left: `${petCrop.x0 * 100}%`,
              top: `${petCrop.y0 * 100}%`,
              width: `${(petCrop.x1 - petCrop.x0) * 100}%`,
              height: `${(petCrop.y1 - petCrop.y0) * 100}%`,
            }}
            aria-hidden
          >
            <i>this becomes your minion</i>
          </span>
        )}
      </div>

      {/* ⚠️ BELOW THE PICTURE. It is a standing note rather than a control, and thirty-five
          pixels of it sat between the tools and the paper on every visit. */}
      {!call.inCall && (
        <AlsoTogether id="paint">
          Anyone in a call with you can draw on this page at the same time — same picture, same
          paper, live.
        </AlsoTogether>
      )}
      <p className="muted paint-note">
        Drawings are kept as the strokes you made, not as an image — so they redraw sharp at any
        size, undo is free, and one fits in a profile without being hosted anywhere. Nothing here is
        uploaded.
      </p>
    </section>
  )
}
