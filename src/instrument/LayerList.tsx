import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react'
import {
  MAX_LAYERS,
  armRecord,
  clearLayerBars,
  layerHeard,
  layerLost,
  layerPlan,
  loopLength,
  moveLayerBar,
  removeLayer,
  seekTo,
  setLayerFx,
  setLayerGain,
  setLayerInstrument,
  splitDrumLayer,
  takeBars,
  toggleLayerSlot,
  toggleMute,
  type Layer,
  type loopState,
} from '../audio/looper'
import { historyNow, redo, subscribeHistory, undo } from '../audio/history'
import { INSTRUMENTS, type InstrumentId } from '../audio/synth'
import { useTouchOnly } from '../ui/pointerKind'
import { fxWord } from './fxWord'
import { partLines } from './partName'
import { Sheet } from './Sheet'

/** every strip of bars in the list, and the ruler over them — the things that scroll together */
const BAR_STRIPS = '.inst-arrange, .inst-ruler'

/** how many rows one kit take would become if it were split, one per piece */
const piecesIn = (l: Layer) => new Set(l.events.map((e) => ((e.midi % 12) + 12) % 12)).size

/**
 * The parts: one line each, with the bar ruler, undo and redo above them and ✎ New part under
 * them — moved out of InstrumentRoom.tsx unchanged on 11 Nov 2026, and made one line a part by the
 * #311 layout on 14 Nov 2026.
 *
 * ⚠️ A PART IS ITS NAME, ITS BARS, ITS MUTE AND ⋯. Everything else the row carried — the
 * instrument it plays as, its volume, show the notes, record it again, copy your sound onto it,
 * split, keep it as a loop and delete — is in the ⋯ sheet, and every part's volume and mute are in
 * 🎚 Mix as well. The row was 113px tall on a phone. On a desktop, where there is room, the volume
 * stays on the row too (Evan, 14 Nov 2026).
 *
 * ⚠️ WHAT STAYS IN THE ROOM: which layer's notes are open (`editing`), because the note editor
 * at the end of the room opens from here and from four other places, and the names of the people
 * in a jam, which the keyboard uses too. Picking a bar up (`lifted`) and which part's ⋯ is open
 * belong to this list alone.
 */
export function LayerList({
  loop,
  editing,
  setEditing,
  jamNames,
  onKeep,
  newPart,
}: {
  loop: ReturnType<typeof loopState>
  editing: string | null
  setEditing: Dispatch<SetStateAction<string | null>>
  jamNames: Record<string, string>
  onKeep: (layerId: string) => void
  /** start an empty part and open its notes — the room knows which instrument is in your hands */
  newPart: () => void
}) {
  const hist = useSyncExternalStore(subscribeHistory, historyNow, historyNow)
  /** the bar picked up and waiting to be put down — the touch half of drag and drop */
  const [lifted, setLifted] = useState<{ id: string; bar: number } | null>(null)
  /** whose ⋯ is open, by id — a part that has gone takes its sheet with it (see `sheetFor`) */
  const [more, setMore] = useState<string | null>(null)
  /* a finger cannot start an HTML5 drag, so the tap-to-lift path is the real one on a phone */
  const touch = useTouchOnly()
  const full = loop.layers.length >= MAX_LAYERS
  /* ⚠️ looked up, not held: a peer can delete the part whose sheet is open, and a sheet for a
     part that is not there is not open — the same rule openEditor keeps for the notes */
  const sheetFor = more === null ? null : (loop.layers.find((l) => l.id === more) ?? null)
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

  return (
    <div className="inst-parts" ref={list}>
      {/**
       * ⚠️ THE RULER'S ROW CARRIES THE COUNT AND UNDO TOO — the #311 layout, 14 Nov 2026. Undo and
       * redo sit beside the parts they undo, and the count says the ceiling before you reach it:
       * there are twelve slots and nothing said so until a button went dead.
       *
       * ⚠️ SHOWN WHILE THERE IS ANYTHING TO UNDO, not only while there are parts: after Clear all
       * the room is empty and Undo is the one button that matters.
       */}
      {(loop.layers.length > 0 || hist.undo > 0 || hist.redo > 0) && (
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
          {loop.layers.length > 0 && loop.bars > 1 ? (
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
                    {(b + 1) % 4 === 1 ? b + 1 : '·'}
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
      {loop.layers.length > 0 && (
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
            return (
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
                  className={'inst-layer-name' + (editing === l.id ? ' is-open' : '')}
                  aria-expanded={editing === l.id}
                  onClick={() => setEditing((e) => (e === l.id ? null : l.id))}
                  title={editing === l.id ? 'Hide these notes' : 'Show these notes'}
                >
                  <span className="inst-part-line">
                    <span className="inst-layer-caret" aria-hidden>
                      {editing === l.id ? '▾' : '▸'}
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
                    it is one tap further, in 🎚 Mix and in the part's ⋯ — see `.inst-part-vol`. */}
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
                  className={'btn btn-ghost inst-icon' + (more === l.id ? ' is-on' : '')}
                  aria-haspopup="dialog"
                  aria-expanded={more === l.id}
                  aria-label={`More for part ${i + 1}`}
                  onClick={() => setMore(l.id)}
                  title="Its sound, volume, notes and the rest"
                >
                  ⋯
                </button>
              </li>
            )
          })}
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
        {/* the ceiling, said where the button went dead rather than only in its tooltip */}
        {full && (
          <span className="muted inst-note">
            All {MAX_LAYERS} parts used — delete one to add another.
          </span>
        )}
      </div>

      {/**
       * A part's ⋯: everything its row carried besides its bars and its mute.
       *
       * ⚠️ IT CLOSES ITSELF FOR THE ONES THAT TAKE YOU SOMEWHERE ELSE — the notes open at the end
       * of the room, a re-take arms the transport, a kept loop asks for a name, a split or a
       * delete changes the list under it. The sound, the volume and Copy FX leave it open,
       * because those are the ones you change and then listen to.
       */}
      {sheetFor && (
        <Sheet
          title={partLines(sheetFor, loop.layers.indexOf(sheetFor)).name}
          onClose={() => setMore(null)}
        >
          <PartSheet
            l={sheetFor}
            theirs={!!sheetFor.from}
            name={sheetFor.from ? (jamNames[sheetFor.from] ?? null) : null}
            rows={loop.layers.length}
            notesOpen={editing === sheetFor.id}
            close={() => setMore(null)}
            showNotes={() => setEditing((e) => (e === sheetFor.id ? null : sheetFor.id))}
            onKeep={onKeep}
          />
        </Sheet>
      )}
    </div>
  )
}

/** What is in a part's ⋯ sheet — see the note where it opens. */
function PartSheet({
  l,
  theirs,
  name,
  rows,
  notesOpen,
  close,
  showNotes,
  onKeep,
}: {
  l: Layer
  /** recorded by somebody else in the room */
  theirs: boolean
  /** their name, when the room knows it */
  name: string | null
  rows: number
  notesOpen: boolean
  close: () => void
  showNotes: () => void
  onKeep: (layerId: string) => void
}) {
  const pieces = piecesIn(l)
  /* a split needs one row per piece, and the take's own row is freed by it */
  const noRoom = rows - 1 + pieces > MAX_LAYERS
  return (
    <div className="inst-sheet-body">
      {/* Re-voice without replaying: the notes were right, the sound was not. Storing notes
          rather than audio is what makes this a dropdown instead of a re-take. */}
      <label className="inst-pick">
        <span className="muted">Plays as</span>
        <select
          value={l.instrument}
          onChange={(e) => setLayerInstrument(l.id, e.target.value as InstrumentId)}
          title="Play this part on a different instrument"
        >
          {INSTRUMENTS.map(([id, , name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="appearance-slider inst-knob" title="How loud this part is">
        <span className="muted">Volume</span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={l.gain ?? 1}
          onChange={(e) => setLayerGain(l.id, Number(e.target.value))}
        />
        <span className="appearance-slider-val">{Math.round((l.gain ?? 1) * 100)}%</span>
      </label>
      <div className="inst-sheet-list">
        <button
          className="btn btn-ghost"
          onClick={() => {
            showNotes()
            close()
          }}
        >
          {notesOpen ? '▾ Hide the notes' : '▸ Show the notes'}
        </button>
        {/* The third way to fix a take, after undo and re-voice: play it again over the top. The
            part keeps its place in the stack rather than jumping to the end. */}
        <button
          className="btn btn-ghost"
          onClick={() => {
            armRecord(l.id)
            close()
          }}
          title="Record this part again, keeping its place"
        >
          ⏺ Record this part again
        </button>
        {/**
         * What this part SOUNDS like, and a way to change your mind.
         *
         * The settings are frozen onto the part when you commit it, which is the whole point —
         * but frozen with no way back would mean replaying a part you were happy with just to
         * give it more room. This re-stamps the current ⚙ Sound onto it, so changing the reverb
         * costs a press rather than a performance. ⚠️ The words say what it DOES (Evan, 11 Nov
         * 2026: the face once read "dry", which looked like a label) and then what it has now.
         */}
        <button
          className="btn btn-ghost"
          onClick={() => setLayerFx(l.id)}
          title={
            `This part plays with echo ${Math.round(l.fx.echo * 100)}, ` +
            `space ${Math.round(l.fx.space * 100)}, ` +
            `vibrato ${Math.round(l.fx.vibrato * 100)}. ` +
            'Press to copy the effects you have set now onto it.'
          }
        >
          FX Copy your sound onto it <span className="muted">· now {fxWord(l.fx)}</span>
        </button>
        {/* ⚠️ Only on a kit take with more than one piece in it, because that is the only case
            where it does anything — see splitDrumLayer. */}
        {l.instrument === 'drums' && pieces > 1 && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              splitDrumLayer(l.id)
              close()
            }}
            /* ⚠️ Says WHY rather than going dead. A split needs one row per piece, so it is the
               person with the fullest arrangement who finds the button does nothing — exactly the
               person owed an explanation. */
            disabled={noRoom}
            title={
              noRoom
                ? `Not enough room — this kit needs a row per drum and there are only ${MAX_LAYERS}`
                : 'Give each drum its own row, so they stop sharing one volume and one set of effects'
            }
          >
            Split it, one part per drum
            {noRoom && <span className="muted"> · needs {pieces} rows</span>}
          </button>
        )}
        {/* Keeping ONE part. This is the drum-loop case: a part worth reusing is almost never a
            whole song, and a library of one-part loops is what makes the next song faster to
            start than the last one. */}
        <button
          className="btn btn-ghost"
          onClick={() => {
            /* closed first: keeping asks for a name in a dialog of its own */
            close()
            onKeep(l.id)
          }}
          title="Keep this part as a loop you can reuse"
        >
          ⬇ Keep it as a loop
        </button>
        {/* ⚠️ DELETING SOMEBODY ELSE'S TAKE ASKS FIRST, and names them. It has always been
            allowed — every control works on every part, which is the point of one desk — but it
            is the only one of them that cannot be undone by the person whose part it was. */}
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (
              theirs &&
              !window.confirm(
                `Delete ${name ?? 'someone in the room'}'s part? This cannot be undone.`,
              )
            )
              return
            removeLayer(l.id)
            close()
          }}
          title={
            theirs
              ? `Delete ${name ? `${name}'s` : 'their'} part — for everyone`
              : 'Delete this part'
          }
        >
          ✕ {theirs ? `Delete ${name ? `${name}'s` : 'their'} part, for everyone` : 'Delete it'}
        </button>
      </div>
    </div>
  )
}
