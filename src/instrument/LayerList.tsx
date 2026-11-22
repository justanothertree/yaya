import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  MAX_LAYERS,
  clearLayerBars,
  layerHeard,
  layerLost,
  layerPlan,
  loopLength,
  moveLayerBar,
  moveTake,
  muteTake,
  seekTo,
  setLayerGain,
  setTakeGain,
  takeBars,
  takeSound,
  toggleLayerSlot,
  toggleMute,
  type Layer,
  type loopState,
} from '../audio/looper'
import { setTakePlace } from '../audio/takes'
import { peaks } from '../audio/takeEdit'
import {
  dragTo,
  fitBar,
  heardFor,
  moveBy,
  sayWhere,
  stepFor,
  whereIs,
  xAt,
  type Scale,
  type Song,
} from '../audio/timeline'
import { historyNow, redo, subscribeHistory, undo } from '../audio/history'
import { hasLyrics, linesFor } from '../audio/lyricLines'
import { useTouchOnly } from '../ui/pointerKind'
import { partLines } from './partName'
import type { PartTab } from './PartPanel'
import { setWordsLevel, singingNow, startSinging, stopSinging, subscribeSinging } from './singAlong'

/**
 * A button that opens a panel takes focus as it is pressed, so the panel can give it back.
 *
 * ⚠️ SAFARI DOES NOT FOCUS A BUTTON YOU CLICK, and neither does Firefox on a Mac. The part menu
 * and the lyrics box both hand focus back to whatever had it when they opened (Panel, and the
 * dialog contract), which in Chrome is the button that opened them. Measured in WebKit, 15 Nov
 * 2026: closing the part menu with Escape left focus on the room's container instead of the
 * part's name, so the next Tab started from the top of the room. Focusing the button on press is
 * what Chrome already does, and costs nothing where it already happened.
 */
const pressed = (e: { currentTarget: HTMLElement }) =>
  e.currentTarget.focus({ preventScroll: true })

/** every strip of bars in the list, and the ruler over them — the things that scroll together */
const BAR_STRIPS = '.inst-arrange, .inst-ruler'

/** the space between two bars, which `.inst-arrange` and `.inst-ruler` both set as their gap */
const GAP = 2
/** the narrowest a bar is drawn: the bar tile's own size before the timeline (see .inst-bar-cell) */
const MIN_BAR = 12
/** and the widest, so a one-bar song is not a single block across a wide screen */
const MAX_BAR = 400
const BEATS_PER_BAR = 4

/**
 * Whether a dragged recording moves a whole beat at a time — on until somebody turns it off, and
 * remembered on this device, because it is a way of working rather than a property of a song.
 */
const SNAP_KEY = 'inst.snap.v1'
const snapAtFirst = () => {
  try {
    return localStorage.getItem(SNAP_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * The parts: one line each, with the bar ruler, undo and redo above them and ✎ New part under
 * them — moved out of InstrumentRoom.tsx unchanged on 11 Nov 2026, and made one line a part by the
 * #311 layout on 14 Nov 2026.
 *
 * ⚠️ A PART IS ITS NAME, ITS BARS, ITS MUTE AND ⋯. Its name and its ⋯ open the part's menu
 * (PartPanel, 15 Nov 2026) — the name on its notes, the ⋯ on its sound — which holds everything
 * else the row and the old ⋯ sheet carried, and every part's volume and mute are in 🎚 Mix as
 * well. On a desktop, where there is room, the volume stays on the row too (Evan, 14 Nov 2026).
 *
 * ⚠️ WHAT STAYS IN THE ROOM: which part's menu is open and on which tab (`open`), because it
 * opens from here and from four other places, and the names of the people in a jam, which the
 * keyboard uses too. Picking a bar up (`lifted`) belongs to this list alone.
 *
 * ⚠️ AND THE SONG'S WORDS HAVE A ROW HERE, under the part that sings them — the "Add lyrics" Evan
 * could not find on a song he had already built (15 Nov 2026). They were inside 🎤 Voice, behind
 * a fold, in a box that forgot them when the page went.
 */
export function LayerList({
  loop,
  open,
  openPart,
  closePart,
  jamNames,
  newPart,
  showLyrics,
  beatsOpen,
  toggleBeats,
  openVoice,
}: {
  loop: ReturnType<typeof loopState>
  /** whose menu is open, and on which tab */
  open: { id: string; tab: PartTab } | null
  openPart: (id: string, tab: PartTab) => void
  closePart: () => void
  jamNames: Record<string, string>
  /** start an empty part and open its notes — the room knows which instrument is in your hands */
  newPart: () => void
  /** open the lyrics box, at a bar when one was pressed */
  showLyrics: (bar?: number) => void
  /** 🥁 Beats, whose door is down here with the other ways to add a part — see SongTools */
  beatsOpen: boolean
  toggleBeats: () => void
  /** 🎤 Voice, where a recording's own controls are */
  openVoice: () => void
}) {
  const hist = useSyncExternalStore(subscribeHistory, historyNow, historyNow)
  const singing = useSyncExternalStore(subscribeSinging, singingNow, singingNow)
  /** the bar picked up and waiting to be put down — the touch half of drag and drop */
  const [lifted, setLifted] = useState<{ id: string; bar: number } | null>(null)
  /* a finger cannot start an HTML5 drag, so the tap-to-lift path is the real one on a phone */
  const touch = useTouchOnly()
  const full = loop.layers.length >= MAX_LAYERS
  /** the notes are open, which is when the editor has Ctrl+Z and these buttons stand down */
  const editing = open?.tab === 'notes' ? open.id : null
  const anyWords = loop.layers.some(hasLyrics)
  /**
   * ⚠️ ON A PHONE THE ROWS SHOW THEIR BARS OR THEIR VOLUME, ONE AT A TIME — Evan, 21 Nov 2026:
   * "easy volume for every part … shown on that timeline". A desktop row has room for both and
   * keeps both. A phone row is a name, about three bars and two buttons, and a fader beside those
   * would leave the bars a sliver; so 🎚 Volume swaps every row's bars for its fader, in the same
   * place, and swaps them back. Every row — parts, words and recordings — in one tap.
   */
  const [levelsOn, setLevelsOn] = useState(false)
  const [snap, setSnap] = useState(snapAtFirst)
  const toggleSnap = () =>
    setSnap((was) => {
      try {
        localStorage.setItem(SNAP_KEY, was ? '0' : '1')
      } catch {
        /* a private window: it holds for this visit */
      }
      return !was
    })
  /** one bar line to the next, as drawn — measured, because a thumb's bars are wider (see below) */
  const [pitch, setPitch] = useState(MIN_BAR + GAP)
  const barLen = (60 / loop.bpm) * BEATS_PER_BAR
  const song: Song = { beat: 60 / loop.bpm, len: loopLength(), beatsPerBar: BEATS_PER_BAR }
  const scale: Scale = { pitch, barLen }
  const arranged = loop.layers.some((l) => l.play || l.plan)
  const anything = loop.layers.length > 0 || loop.takes.length > 0
  /** who recorded a part, when it was not you */
  const whoOf = (l: Layer) => (l.from ? (jamNames[l.from] ?? 'Someone') : null)

  /**
   * ⚠️ THE BARS OF EVERY PART SCROLL AS ONE, WITH THE RULER — or a column stops being a column.
   *
   * A part is one line since the #311 layout, so its bars share the line with its name and its
   * buttons, and on a phone about three of them fit (measured at 375: a 99px window onto a 32-bar
   * strip 1,035px long). Each strip scrolls inside itself, which keeps the page from going
   * sideways — but scrolled on its own, one row's bar 5 would sit under another row's bar 1 and
   * the ruler would label neither, which is the exact disorder the strip's own CSS note forbids.
   * So whichever strip moves, the others follow.
   *
   * ⚠️ AND A FOLLOWER'S OWN SCROLL IS NOT PASSED BACK. A part whose bars were rearranged ends in
   * an "all" button, so its strip runs a button further than the rest; set to its far end, the
   * others stop short. Passing their stopped-short scroll back would pull that row back too, and
   * its "all" would be out of reach. So each scroll this sets is remembered, and the event it
   * causes is let go.
   */
  const list = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = list.current
    if (!el) return
    const echoes = new WeakMap<HTMLElement, number>()
    const follow = (e: Event) => {
      const from = e.target
      if (!(from instanceof HTMLElement) || !from.matches(BAR_STRIPS)) return
      const echo = echoes.get(from)
      echoes.delete(from)
      if (echo === from.scrollLeft) return
      for (const s of el.querySelectorAll<HTMLElement>(BAR_STRIPS)) {
        if (s === from || s.scrollLeft === from.scrollLeft) continue
        s.scrollLeft = from.scrollLeft
        /* what it actually landed on, which a shorter strip clamps */
        echoes.set(s, s.scrollLeft)
      }
    }
    /* scroll does not bubble, so it is caught on the way down */
    el.addEventListener('scroll', follow, true)
    return () => el.removeEventListener('scroll', follow, true)
  }, [])
  /* a part that arrives, or a ruler that appears, starts where the others already are */
  useEffect(() => {
    const strips = list.current?.querySelectorAll<HTMLElement>(BAR_STRIPS)
    if (!strips?.length) return
    const x = Math.max(...Array.from(strips, (s) => s.scrollLeft))
    for (const s of strips) if (s.scrollLeft !== x) s.scrollLeft = x
  }, [loop.layers.length, loop.bars])

  /**
   * ⚠️ THE BARS FILL THE STRIP, SO THE LIST IS A TIMELINE — Evan, 21 Nov 2026. A bar was a 12px
   * tile whatever the room, which is a list of switches; a timeline has to be wide enough to put a
   * recording on a beat. So every bar is drawn as wide as lets the song fill the narrowest strip,
   * through one variable, `--bar-w`, which the tiles, the ruler, the words and the recordings all
   * read — the columns line up by construction, the promise the ruler's own CSS note makes.
   *
   * ⚠️ AND THE DISTANCE FROM ONE BAR TO THE NEXT IS MEASURED, NOT ASSUMED. On a thumb a tile has a
   * floor of 1.9rem (see .inst-bar-cell), so a long song's bars are wider than `--bar-w` says;
   * placing a recording from the variable would put it a few pixels a bar away from the bars it is
   * drawn under. The tile on the page is asked instead.
   *
   * ⚠️ A REARRANGED PART'S STRIP ENDS IN AN "all" BUTTON, so its bars are fitted short of it: filled
   * to the edge, that one strip would run on by a button and scroll while the others could not,
   * which is a column that is not a column (see the scroll note above).
   */
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const fit = () => {
      const strips = Array.from(el.querySelectorAll<HTMLElement>('.inst-layers .inst-arrange'))
      if (!strips.length) return
      const all = el.querySelector<HTMLElement>('.inst-bar-all')
      /* the bars are put away while a phone shows the volumes: keep what they measured */
      if (!strips[0].getClientRects().length) return
      const room = Math.min(...strips.map((x) => x.clientWidth)) - (all ? all.offsetWidth + GAP : 0)
      const w = fitBar(room, loop.bars, GAP, MIN_BAR, MAX_BAR)
      el.style.setProperty('--bar-w', `${w}px`)
      const cell = el.querySelector<HTMLElement>('.inst-bar-cell, .inst-ruler-cell')
      const next = (cell ? cell.getBoundingClientRect().width : w) + GAP
      setPitch((was) => (Math.abs(was - next) < 0.01 ? was : next))
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(el)
    return () => watch.disconnect()
  }, [loop.bars, loop.layers.length, loop.takes.length, arranged, levelsOn])

  /**
   * ⚠️ ONE PLAYHEAD, DOWN THROUGH EVERY ROW — the "one shared playhead" of the request. Each row's
   * bars scroll inside themselves, so the line is placed over the whole list rather than inside any
   * one strip, at the playhead's distance into the bars less however far they are scrolled, and it
   * is hidden when that is outside the strip.
   *
   * ⚠️ WRITTEN STRAIGHT TO ITS STYLE, after the render the transport tick already causes — reading
   * where the strips are during a render would be layout in the middle of React's work.
   */
  const playhead = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = list.current
    const line = playhead.current
    if (!el || !line) return
    const strips = el.querySelectorAll<HTMLElement>('.inst-layers .inst-arrange')
    const first = strips[0]
    if (!loop.playing || !first || !first.getClientRects().length) {
      line.hidden = true
      return
    }
    const box = el.getBoundingClientRect()
    const at = first.getBoundingClientRect()
    const x = at.left - box.left + loop.position * loop.bars * pitch - first.scrollLeft
    const top = (el.querySelector<HTMLElement>('.inst-ruler') ?? first).getBoundingClientRect().top
    const bottom = strips[strips.length - 1].getBoundingClientRect().bottom
    line.hidden = x < at.left - box.left - 1 || x > at.right - box.left
    line.style.transform = `translateX(${x}px)`
    line.style.top = `${top - box.top}px`
    line.style.height = `${bottom - top}px`
  })

  return (
    <div className={'inst-parts' + (levelsOn ? ' is-levels' : '')} ref={list}>
      {/**
       * ⚠️ THE RULER'S ROW CARRIES THE COUNT AND UNDO TOO — the #311 layout, 14 Nov 2026. Undo and
       * redo sit beside the parts they undo, and the count says the ceiling before you reach it:
       * there are twelve slots and nothing said so until a button went dead.
       *
       * ⚠️ SHOWN WHILE THERE IS ANYTHING TO UNDO, not only while there are parts: after Clear all
       * the room is empty and Undo is the one button that matters.
       */}
      <div className="inst-tl-playhead" ref={playhead} hidden aria-hidden />
      {(anything || hist.undo > 0 || hist.redo > 0) && (
        <div className="inst-parts-head">
          <span className="muted inst-layers-count">
            {loop.layers.length ? `${loop.layers.length} of ${MAX_LAYERS} parts` : 'No parts yet'}
          </span>
          {/**
           * ⚠️ THE BAR NUMBERS, AND THE WAY TO JUMP TO ONE.
           *
           * The tiles below say which bars a part plays, but nothing said WHICH bar you were
           * looking at — you counted along the row. Same cell width as a tile, and it starts
           * where the tiles start (the name column is the same width above and below), so a
           * number sits directly above its column. Clicking one moves the playhead there.
           *
           * Seeking is here rather than on the tiles because a tile already means two things —
           * turn this bar off, or pick it up and move it — and a third would make every click a
           * guess. The ruler has nothing else to do.
           */}
          {anything && loop.bars > 1 ? (
            <div className="inst-ruler" role="group" aria-label="Jump to a bar">
              {Array.from({ length: loop.bars }, (_, b) => {
                const at = (loopLength() * b) / Math.max(1, loop.bars)
                const now = Math.floor(loop.position * loop.bars) === b
                return (
                  <button
                    key={b}
                    className={'inst-ruler-cell' + (now && loop.playing ? ' is-now' : '')}
                    onClick={() => seekTo(at)}
                    title={`Jump to bar ${b + 1}`}
                    /* ⚠️ A NAME, NOT ONLY A TOOLTIP: the cell reads "·" and a phone has no hover */
                    aria-label={`Jump to bar ${b + 1}`}
                  >
                    {/* every number once there is room for one, the first of each four before */}
                    {(b + 1) % 4 === 1 || pitch >= 24 ? b + 1 : '·'}
                  </button>
                )
              })}
            </div>
          ) : (
            <span />
          )}
          {/**
           * ⚠️ UNDO AND REDO FOR THE WHOLE ROOM — Evan, 9 Nov 2026. They take back the last
           * change, whatever it was: a deletion, Clear all, a swap, a drag, a tempo, a song opened
           * over your work. See history.ts, including why a jam partner's changes are not yours to
           * undo. The glyphs carry their names, as a part's mute and ⋯ do.
           *
           * ⚠️ AND STOOD DOWN WHILE THE NOTE EDITOR IS OPEN, which has its own undo for its own
           * notes and takes Ctrl+Z for it. Two undos answering one key would each take a step.
           */}
          <span className="inst-undo" role="group" aria-label="Undo and redo">
            <button
              className="btn inst-icon"
              onClick={() => undo()}
              disabled={!hist.undo || !!editing}
              aria-label="Undo"
              title={
                editing
                  ? 'The note editor has its own undo while it is open'
                  : 'Undo your last change to the parts (Ctrl+Z)'
              }
            >
              ↶
            </button>
            <button
              className="btn inst-icon"
              onClick={() => redo()}
              disabled={!hist.redo || !!editing}
              aria-label="Redo"
              title={
                editing
                  ? 'The note editor has its own redo while it is open'
                  : 'Redo what you undid (Ctrl+Shift+Z)'
              }
            >
              ↷
            </button>
          </span>
        </div>
      )}
      {anything && (
        <ul className="inst-layers">
          {loop.layers.map((l, i) => {
            /**
             * ⚠️ EVERY CONTROL WORKS ON EVERY PART, INCLUDING SOMEBODY ELSE'S.
             *
             * These were briefly disabled on a peer's row, because at the time an edit to their
             * take changed only your copy — a silent disagreement about the arrangement, which is
             * the exact thing sharing the layers was meant to end. The fix was never to take the
             * controls away: if you are jamming you are at one desk, and at a desk anybody can
             * reach the fader. So the edit travels instead (see canonicalId), and the name below
             * stays only to say whose playing it is.
             */
            /**
             * ⚠️ WHAT IS WRITTEN DOWN AND WHAT IS HEARD ARE TWO DIFFERENT ROWS — see arrange.ts.
             * `plan` is the arrangement somebody made and is what the drag and the pick-up work
             * on; `heard` is what the scheduler will actually play, which is `plan` with every
             * part the take no longer has removed. Drawing from `plan` is what let a cell read
             * "plays part 2 of 1" while sounding nothing.
             */
            const plan = layerPlan(l)
            const heard = layerHeard(l)
            const lost = layerLost(l)
            const parts = takeBars(l)
            const said = partLines(l, i)
            const who = whoOf(l)
            return [
              <li
                key={l.id}
                className={
                  'inst-part' +
                  (l.muted ? ' is-muted' : '') +
                  (loop.replacing === l.id ? ' is-replacing' : '')
                }
              >
                {/**
                 * ⚠️ THE NAME IS THE SWITCH, and there is no pencil any more.
                 *
                 * The row already names the part — "3. 14 notes" is exactly the handle for "show
                 * me those fourteen notes", so it may as well be the control. Pressing the open
                 * one again closes it, because a toggle you cannot un-toggle is a trap. Since the
                 * #311 layout the name's second line says what it plays on, which was the row's
                 * own dropdown and is in its ⋯ now (see partName).
                 */}
                <button
                  className={'inst-layer-name' + (open?.id === l.id ? ' is-open' : '')}
                  aria-haspopup="dialog"
                  aria-expanded={open?.id === l.id}
                  onClick={(e) => {
                    pressed(e)
                    if (editing === l.id) closePart()
                    else openPart(l.id, 'notes')
                  }}
                  title={
                    editing === l.id ? 'Close this part' : 'Its notes, its volume and its sound'
                  }
                >
                  <span className="inst-part-line">
                    <span className="inst-layer-caret" aria-hidden>
                      {open?.id === l.id ? '▾' : '▸'}
                    </span>{' '}
                    {said.name}
                  </span>
                  {/* ⚠️ WHOSE PART IT IS, when it is not yours. An arrangement where you cannot
                      tell your bassline from your friend's is one where you mute theirs looking
                      for yours. Absent for your own, because every row saying "you" is a column
                      of noise. */}
                  <small className="inst-part-line inst-part-detail">
                    {who && (
                      <span
                        className="inst-layer-who"
                        title={`Recorded by ${l.from ? (jamNames[l.from] ?? 'someone in the room') : ''}`}
                      >
                        {who}
                      </span>
                    )}
                    {said.detail}
                  </small>
                </button>

                {/**
                 * The track: a row of bars you can put in an order.
                 *
                 * ⚠️ Every bar is ON until you turn one off, so a take you just recorded behaves
                 * exactly as it always did and structure is something you opt into.
                 *
                 * ⚠️ EACH CELL NAMES THE BAR IT PLAYS, not merely whether it plays. That one
                 * change is what turns a mute strip into an arrangement — "bar 3 of this take
                 * sounds here" can be moved, where "on" can only be switched off.
                 *
                 * Two ways to move one, because they suit different hands. Dragging is what a
                 * mouse expects. On a touchscreen an HTML5 drag never starts, so a tap picks a
                 * bar up and a second tap puts it down.
                 *
                 * ⚠️ THE NAME BEFORE IT IS A FIXED WIDTH, which is what keeps a column a column:
                 * the tiles of every part start at the same x, so bar 4 of one part sits over bar
                 * 4 of the next, and the ruler above starts there too. See `.inst-part`.
                 */}
                <span className="inst-arrange" role="group" aria-label="The bars this part plays">
                  {plan.map((src, b) => {
                    /* has this layer actually been rearranged, or is it just playing in order? */
                    const arranged = !!l.plan
                    const held = lifted?.id === l.id && lifted.bar === b
                    /* ⚠️ `heard`, not `src`: a slot can hold a part and still be silent */
                    const sounds = heard[b] != null
                    const gone = lost[b]
                    return (
                      <button
                        key={b}
                        className={
                          'inst-bar-cell' +
                          (sounds ? ' is-on' : '') +
                          (gone ? ' is-lost' : '') +
                          (held ? ' is-lifted' : '')
                        }
                        aria-pressed={sounds}
                        /* a lost part is still theirs to move, so it stays draggable */
                        draggable={!touch && src != null}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/bar', String(b))
                          setLifted({ id: l.id, bar: b })
                        }}
                        onDragOver={(e) => {
                          if (e.dataTransfer.types.includes('text/bar')) e.preventDefault()
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          const from = Number(e.dataTransfer.getData('text/bar'))
                          if (Number.isFinite(from)) moveLayerBar(l.id, from, b)
                          setLifted(null)
                        }}
                        onDragEnd={() => setLifted(null)}
                        onClick={() => {
                          if (lifted && lifted.id === l.id) {
                            if (lifted.bar === b) toggleLayerSlot(l.id, b)
                            else moveLayerBar(l.id, lifted.bar, b)
                            setLifted(null)
                          } else if (src == null) {
                            toggleLayerSlot(l.id, b)
                          } else {
                            setLifted({ id: l.id, bar: b })
                          }
                        }}
                        /**
                         * ⚠️ A NAME AS WELL AS THE TOOLTIP — Evan, 9 Nov 2026. A cell is a coloured
                         * block with nothing in it until the bars are reordered; a phone has no
                         * hover and a screen reader read a nameless button. The name says what the
                         * bar IS, and the title keeps saying what a tap does.
                         */
                        aria-label={
                          src == null
                            ? `Bar ${b + 1}, silent`
                            : gone
                              ? `Bar ${b + 1}, part ${src + 1}, which this take does not have`
                              : `Bar ${b + 1}, part ${src + 1} of ${parts}`
                        }
                        title={
                          src == null
                            ? `Bar ${b + 1}: silent — tap to fill it`
                            : lifted && lifted.id === l.id
                              ? `Put bar ${lifted.bar + 1} here`
                              : gone
                                ? /* ⚠️ names WHICH part, because that is the recoverable half of
                                   it — the slot can be moved or switched off deliberately,
                                   where an unexplained empty cell just loses the arrangement */
                                  `Bar ${b + 1} holds part ${src + 1}, which this take does not have — silent`
                                : `Bar ${b + 1} plays part ${src + 1} of ${parts} — tap to pick it up`
                        }
                      >
                        {/**
                         * ⚠️ QUIET UNTIL IT HAS SOMETHING TO SAY. A take that plays straight
                         * through would say 1 2 3 4, which is four numbers to tell you nothing
                         * happened; the numbers appear once the order stops being the obvious one.
                         */}
                        {arranged ? (src == null ? '·' : src + 1) : ''}
                      </button>
                    )
                  })}
                  {(l.play || l.plan) && (
                    <button
                      className="btn inst-bar-all"
                      onClick={() => clearLayerBars(l.id)}
                      title="Play in every bar again"
                    >
                      all
                    </button>
                  )}
                </span>

                {/* ⚠️ ON THE ROW ON A DESKTOP, where there is room (Evan, 14 Nov 2026). Balancing
                    parts is done BY EAR, which means moving one while the others play. On a phone
                    it takes the bars' place under 🎚 Volume (see `levelsOn`), and is in 🎚 Mix and
                    the part's ⋯ as well — see `.inst-part-vol`. */}
                <label className="inst-layer-vol inst-part-vol" title="How loud this part is">
                  <span className="sr-only">Volume of part {i + 1}</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={l.gain ?? 1}
                    onChange={(e) => setLayerGain(l.id, Number(e.target.value))}
                  />
                </label>
                <button
                  className="btn inst-icon"
                  onClick={() => toggleMute(l.id)}
                  /* a toggle: one name, and the state says whether it is on */
                  aria-label={`Mute part ${i + 1}`}
                  aria-pressed={!!l.muted}
                  title={l.muted ? 'Muted — click to hear it again' : 'Mute this part'}
                >
                  {l.muted ? '🔇' : '🔊'}
                </button>
                <button
                  className={
                    'btn btn-ghost inst-icon' +
                    (open?.id === l.id && open.tab !== 'notes' ? ' is-on' : '')
                  }
                  aria-haspopup="dialog"
                  aria-expanded={open?.id === l.id && open.tab !== 'notes'}
                  aria-label={`More for part ${i + 1}`}
                  onClick={(e) => {
                    pressed(e)
                    openPart(l.id, 'sound')
                  }}
                  title="Its sound, its volume and the rest"
                >
                  ⋯
                </button>
              </li>,
              hasLyrics(l) && (
                <LyricsRow
                  key={`${l.id}-words`}
                  l={l}
                  bars={loop.bars}
                  wide={pitch >= 44}
                  singing={singing}
                  showLyrics={showLyrics}
                />
              ),
            ]
          })}
          {/**
           * ⚠️ A RECORDING IN THE LOOP IS PART OF THE SONG, SO IT IS IN THE LIST OF IT (15 Nov
           * 2026). It was only inside 🎤 Voice, so the parts list was the song minus its vocal,
           * and muting a take meant opening a tool. Its row has the mute; its name opens 🎤 Voice,
           * where its sound, its trim and the rest still live.
           */}
          {loop.takes.map((t, k) => (
            <TakeRow
              key={t.id}
              id={t.id}
              at={t.at}
              gain={t.gain ?? 1}
              n={k + 1}
              muted={!!t.muted}
              openVoice={openVoice}
              song={song}
              scale={scale}
              bars={loop.bars}
              snap={snap}
            />
          ))}
        </ul>
      )}

      {/* Start a part by drawing it rather than by playing it. The editor was only reachable
          through a recording, which meant placing four notes by hand required performing them
          first. Under the parts since the #311 layout, where the new one appears. */}
      <div className="inst-row inst-parts-foot">
        <button
          className="btn btn-ghost"
          onClick={newPart}
          disabled={full}
          title={
            full
              ? `That is all ${MAX_LAYERS} parts — delete one to add another`
              : 'Add an empty part and draw notes into it'
          }
        >
          ✎ New part
        </button>
        {/* ⚠️ HERE SINCE 15 NOV 2026, beside ✎ New part: every way to add a part from the parts,
            in one row. It was among the tools below, a row away from where its parts land. The
            panel it opens is the same one, still in SongTools, placed just under this row. */}
        <button
          className={'btn' + (beatsOpen ? ' is-on' : ' btn-ghost')}
          aria-expanded={beatsOpen}
          aria-controls="inst-tool-beats"
          onClick={toggleBeats}
          /* it adds parts, so it goes dead at the ceiling — but never while open, or the one way
             to close it would be the button that had stopped working */
          disabled={full && !beatsOpen}
          title="Drums, chords, a bassline and a fill — drop any of them in, then change them"
        >
          🥁 Beats
        </button>
        {/* ⚠️ THE DOOR TO THE WORDS, on the song rather than inside 🎤 Voice — see the note at the
            top. Once a part has words it gets its own row above, which is the door from then on. */}
        {!anyWords && (
          <button
            className="btn btn-ghost"
            onClick={(e) => {
              pressed(e)
              showLyrics()
            }}
            title="Write words for the song, a line for each bar, and hear them sung"
          >
            🎤 Add lyrics
          </button>
        )}
        {/* the ceiling, said where the button went dead rather than only in its tooltip */}
        {full && (
          <span className="muted inst-note">
            All {MAX_LAYERS} parts used — delete one to add another.
          </span>
        )}
        {/* a phone's way to the volumes on the rows — see `levelsOn`; a desktop shows both */}
        {anything && (
          <button
            className={'btn inst-levels-toggle' + (levelsOn ? ' is-on' : ' btn-ghost')}
            aria-pressed={levelsOn}
            onClick={() => setLevelsOn((v) => !v)}
            title={levelsOn ? 'Show the bars again' : 'Show a volume for every row'}
          >
            🎚 Volume
          </button>
        )}
        {/**
         * ⚠️ SNAP, UNDER THE RECORDINGS IT MOVES, and only while there are some. On, a take moves a
         * whole beat at a time; off, it goes exactly where it is put. "Snap takes" rather than
         * "Snap", because the tempo menu already has a snap, for the notes you play — two buttons
         * called one word that do different things is a guess every time.
         *
         * ⚠️ NOT BESIDE UNDO, where it went first: at 375 the ruler's row is a name column, the
         * ruler and whatever sits at its end, and the button took the ruler from 106px to 53px —
         * under two bars of a four-bar song, which is a ruler in name only.
         */}
        {loop.takes.length > 0 && (
          <button
            className={'btn inst-snap' + (snap ? ' is-on' : ' btn-ghost')}
            aria-pressed={snap}
            onClick={toggleSnap}
            title={
              snap
                ? 'Takes move a whole beat at a time. Press to put them anywhere.'
                : 'Takes go exactly where you put them. Press to move them a beat at a time.'
            }
          >
            Snap takes
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * A recording playing in the loop, as a row of the song: its mute, the door to its controls, and
 * the recording itself, drawn where it plays — which is where it is moved from.
 */
function TakeRow({
  id,
  at,
  gain,
  n,
  muted,
  openVoice,
  song,
  scale,
  bars,
  snap,
}: {
  id: string
  at: number
  /** its volume on the song, 0 to 2 */
  gain: number
  n: number
  muted: boolean
  openVoice: () => void
  song: Song
  scale: Scale
  bars: number
  snap: boolean
}) {
  const where = whereIs(at, song)
  return (
    <li className={'inst-part inst-take-row' + (muted ? ' is-muted' : '')}>
      <button
        className="inst-layer-name"
        aria-controls="inst-tool-voice"
        onClick={openVoice}
        title="Its sound and its trim, in 🎤 Voice"
      >
        <span className="inst-part-line">🎤 Take {n}</span>
        <small className="inst-part-line inst-part-detail">
          bar {where.bar} · beat {where.beat}
        </small>
      </button>
      <span className="inst-arrange inst-take-lane">
        <span
          className="inst-take-track"
          style={{ width: bars * scale.pitch - GAP, ['--pitch' as string]: `${scale.pitch}px` }}
        >
          <TakeClip id={id} at={at} n={n} song={song} scale={scale} snap={snap} />
        </span>
      </span>
      <label className="inst-layer-vol inst-part-vol" title="How loud this take is">
        <span className="sr-only">Volume of take {n}</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={gain}
          onChange={(e) => setTakeGain(id, Number(e.target.value))}
        />
      </label>
      <button
        className="btn inst-icon"
        onClick={() => muteTake(id)}
        aria-label={`Mute take ${n}`}
        aria-pressed={muted}
        title={muted ? 'Muted — click to hear it again' : 'Mute this take'}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <span className="inst-icon-slot" aria-hidden />
    </li>
  )
}

/**
 * A recording on the timeline: as long as what it plays, with its sound drawn in it, and moved by
 * dragging it or with the arrow keys.
 *
 * ⚠️ POINTER EVENTS, NOT HTML5 DRAG, because a finger never starts an HTML5 drag (the bar tiles
 * above have a second, tap-to-lift path for exactly that reason). One handler serves a mouse, a pen
 * and a thumb; `touch-action: pan-y` in the CSS leaves the page's own scrolling to a finger moving
 * up and down.
 *
 * ⚠️ THE MOVE IS SHOWN WHILE IT HAPPENS AND MADE WHEN IT ENDS. Moving the take on the loop at every
 * pixel would stop and restart its sound under the pointer the whole way across; it is moved once,
 * on release, and where it goes is kept on the recording too, so taking it off the loop and putting
 * it back returns it there (setTakePlace).
 *
 * ⚠️ AND THE CAPTURE IS ALLOWED TO FAIL. `setPointerCapture` throws for a pointer the browser does
 * not consider live — CLAUDE.md has it measured — and it is only there so a drag that leaves the
 * clip keeps going. The move must not depend on it.
 */
function TakeClip({
  id,
  at,
  n,
  song,
  scale,
  snap,
}: {
  id: string
  at: number
  n: number
  song: Song
  scale: Scale
  snap: boolean
}) {
  const [drag, setDrag] = useState<{ x0: number; to: number } | null>(null)
  const sound = takeSound(id)
  const shown = drag ? drag.to : at
  const secs = heardFor(shown, sound?.duration ?? 0, song.len)
  const width = Math.max(6, xAt(secs, scale))
  const put = (to: number) => {
    if (to === at) return
    moveTake(id, to)
    void setTakePlace(id, to)
  }
  /* Alt places it freely for one move, the way most music programs do */
  const snapping = (e: { altKey: boolean }) => snap && !e.altKey
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* a pointer the browser does not count as live — the move still works inside the clip */
    }
    setDrag({ x0: e.clientX, to: at })
  }
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return
    const to = dragTo(at, e.clientX - drag.x0, { ...song, snap: snapping(e), scale })
    if (to !== drag.to) setDrag({ ...drag, to })
  }
  const up = () => {
    if (!drag) return
    put(drag.to)
    setDrag(null)
  }
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    const how = { ...song, snap: snapping(e) }
    if (e.key === 'Home') put(moveBy(at, -at, how))
    else if (dir) put(moveBy(at, dir * stepFor(how, e.shiftKey), how))
    else return
    e.preventDefault()
  }
  return (
    <button
      className={'inst-take-clip' + (drag ? ' is-moving' : '')}
      style={{ left: xAt(shown, scale), width }}
      role="slider"
      aria-label={`Take ${n}, where it plays`}
      aria-valuemin={0}
      aria-valuemax={Math.round(song.len * 1000) / 1000}
      aria-valuenow={shown}
      aria-valuetext={`Starts at ${sayWhere(shown, song)}`}
      title={
        snap
          ? 'Drag to move it a beat at a time (hold Alt to place it freely), or use the arrow keys'
          : 'Drag to move it, or use the arrow keys'
      }
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={key}
    >
      <TakeWave sound={sound} width={width} />
    </button>
  )
}

/**
 * The recording's sound, drawn small — the picture that says where in it the singing is, which is
 * what anybody placing it is actually lining up.
 *
 * ⚠️ DRAWN WHEN THE SOUND OR THE WIDTH CHANGES, never on the transport's tick: `peaks` looks at
 * every sample (see takeEdit.ts) and the list re-renders forty times a second while the song plays.
 */
function TakeWave({ sound, width }: { sound: AudioBuffer | undefined; width: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const w = Math.max(1, Math.round(width))
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const h = c.clientHeight || 16
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    const g = c.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, c.width, c.height)
    if (!sound) return
    const cols = c.width
    const p = peaks(sound.getChannelData(0), cols)
    const mid = c.height / 2
    g.fillStyle = getComputedStyle(c).color
    for (let i = 0; i < cols; i++) {
      const lo = Math.max(-1, p[i * 2])
      const hi = Math.min(1, p[i * 2 + 1])
      g.fillRect(i, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid))
    }
  }, [sound, w])
  return <canvas ref={ref} className="inst-take-wave" style={{ width: w }} aria-hidden />
}

/**
 * The words, as a row under the part that sings them: one cell per bar of the song, marked where
 * there are words, and a ▶ that sings the song through.
 *
 * ⚠️ IT IS A ROW OF THE ARRANGEMENT, so its cells sit under the bars they belong to and scroll
 * with them (`.inst-arrange` is one of the strips the list moves together). Pressing a cell opens
 * the lyrics box at that bar.
 */
function LyricsRow({
  l,
  bars,
  wide,
  singing,
  showLyrics,
}: {
  l: Layer
  bars: number
  /** a bar is wide enough to show its words rather than a mark that it has some */
  wide: boolean
  singing: boolean
  showLyrics: (bar?: number) => void
}) {
  const lines = linesFor(l, bars)
  const filled = lines.filter((w) => w.trim()).length
  return (
    <li className="inst-part inst-lyrics-row">
      <button
        className="inst-layer-name"
        aria-haspopup="dialog"
        onClick={(e) => {
          pressed(e)
          showLyrics()
        }}
        title="Change the words"
      >
        <span className="inst-part-line">🎤 Lyrics</span>
        <small className="inst-part-line inst-part-detail">
          {filled} bar{filled === 1 ? '' : 's'} of words
        </small>
      </button>
      <span className="inst-arrange" role="group" aria-label="The words in each bar">
        {lines.map((w, b) => (
          <button
            key={b}
            className={'inst-bar-cell inst-word-cell' + (w.trim() ? ' is-on' : '')}
            onClick={(e) => {
              pressed(e)
              showLyrics(b)
            }}
            aria-label={`Bar ${b + 1}: ${w.trim() || 'no words'}`}
            title={w.trim() ? `Bar ${b + 1}: ${w.trim()}` : `Bar ${b + 1}: no words — tap to add`}
          >
            {w.trim() ? wide ? <span className="inst-word-text">{w.trim()}</span> : '♪' : ''}
          </button>
        ))}
      </span>
      {/* how loud the words are sung — saved on the part with them (Layer.wordsGain) */}
      <label className="inst-layer-vol inst-part-vol" title="How loud the words are sung">
        <span className="sr-only">Volume of the lyrics</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={l.wordsGain ?? 1}
          onChange={(e) => setWordsLevel(l.id, Number(e.target.value))}
        />
      </label>
      <button
        className={'btn inst-icon' + (singing ? ' is-on' : '')}
        onClick={() => (singing ? stopSinging() : startSinging())}
        aria-label={singing ? 'Stop singing' : 'Sing the song through'}
        aria-pressed={singing}
        title={singing ? 'Stop singing' : 'Play the song from the top with the words sung'}
      >
        {singing ? '■' : '▶'}
      </button>
      <span className="inst-icon-slot" aria-hidden />
    </li>
  )
}
