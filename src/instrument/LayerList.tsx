import { useState, type Dispatch, type SetStateAction } from 'react'
import {
  MAX_LAYERS,
  armRecord,
  clearLayerBars,
  clearLayers,
  layerHeard,
  layerLost,
  layerPlan,
  moveLayerBar,
  removeLayer,
  setLayerFx,
  setLayerGain,
  setLayerInstrument,
  soleDrumPiece,
  splitDrumLayer,
  takeBars,
  toggleLayerSlot,
  toggleMute,
  type Layer,
} from '../audio/looper'
import { DRUMS, INSTRUMENTS, type InstrumentId } from '../audio/synth'
import { useTouchOnly } from '../ui/pointerKind'
import { fxWord } from './fxWord'
import { layerTitle } from './layerTitle'

/**
 * The layers: one row per part, with its sound, the bars it plays in and the controls for it —
 * moved out of InstrumentRoom.tsx unchanged on 11 Nov 2026.
 *
 * ⚠️ WHAT STAYS IN THE ROOM: which layer's notes are open (`editing`), because the note editor
 * below the list opens from here and from four other places, and the names of the people in a
 * jam, which the keyboard uses too. Picking a bar up (`lifted`) belongs to this list alone, so its
 * state moved with it.
 */
export function LayerList({
  layers,
  replacing,
  editing,
  setEditing,
  jamNames,
  onKeep,
}: {
  layers: readonly Layer[]
  replacing: string | null
  editing: string | null
  setEditing: Dispatch<SetStateAction<string | null>>
  jamNames: Record<string, string>
  onKeep: (layerId: string) => void
}) {
  /** the bar picked up and waiting to be put down — the touch half of drag and drop */
  const [lifted, setLifted] = useState<{ id: string; bar: number } | null>(null)
  /* a finger cannot start an HTML5 drag, so the tap-to-lift path is the real one on a phone */
  const touch = useTouchOnly()
  /* the room's own name for the loop's state, so the moved JSX reads exactly as it did there */
  const loop = { layers, replacing }
  return (
    <>
      {loop.layers.length > 0 && (
        <p className="muted inst-layers-count">
          {/* ⚠️ THE CEILING HAS TO BE VISIBLE BEFORE YOU REACH IT. There are twelve slots and
            nothing said so — the first anybody heard of it was a button going dead, or, once
            takes started outliving the people who recorded them, somebody's part quietly not
            arriving. A count is one line and answers it in advance. */}
          {loop.layers.length} of {MAX_LAYERS} layers
          {loop.layers.length >= MAX_LAYERS && ' — delete one to add another'}
        </p>
      )}
      {loop.layers.length > 0 && (
        <ul className="inst-layers">
          {loop.layers.map((l, i) => {
            /**
             * ⚠️ EVERY CONTROL WORKS ON EVERY PART, INCLUDING SOMEBODY ELSE'S.
             *
             * (There is no `is-theirs` on the row either. It was added when these were read-only,
             * and `.inst-key.is-theirs` already means "a key somebody else is holding" — one class
             * name for two unrelated ideas, the second of which had no styling at all.)
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
            return (
              <li
                key={l.id}
                className={
                  (l.muted ? 'is-muted' : '') + (loop.replacing === l.id ? ' is-replacing' : '')
                }
              >
                {/**
                 * ⚠️ THE NAME IS THE SWITCH, and there is no pencil any more.
                 *
                 * Editing a take was behind a ✎ next to five other small buttons, which is a lot of
                 * looking for the thing you most want to do with a layer. The row already names the
                 * layer and counts its notes — "3. 14 notes" is exactly the handle for "show me
                 * those fourteen notes", so it may as well be the control. Pressing the open one
                 * again closes it, because a toggle you cannot un-toggle is a trap.
                 */}
                <button
                  className={'inst-layer-name' + (editing === l.id ? ' is-open' : '')}
                  aria-expanded={editing === l.id}
                  onClick={() => setEditing((e) => (e === l.id ? null : l.id))}
                  title={editing === l.id ? 'Hide these notes' : 'Show these notes'}
                >
                  <span className="inst-layer-caret" aria-hidden>
                    {editing === l.id ? '▾' : '▸'}
                  </span>
                  {i + 1}.
                  {/* ⚠️ A kit layer holding one piece says which — derived, so it is equally
                    true of a split row and of a take where you only ever hit the snare. After a
                    split, "3." and "4." are indistinguishable, and mixing them against each
                    other is the entire point of having split it. */}
                  {soleDrumPiece(l) !== null && (
                    <span className="inst-layer-piece"> {DRUMS[soleDrumPiece(l) as number]}</span>
                  )}
                  {/* ⚠️ WHAT IT IS, WHEN THE BACKING LAID IT — item 1 of the 11 Nov 2026 flow map. A
                      style laid "1. 10 notes", "2. 48 notes" and "3. 8 notes", and which was the
                      beat was only in each row's sound menu. A part somebody played still counts
                      its notes, because that count is the handle for "show me those notes". */}
                  {layerTitle(l) !== null ? (
                    <span> {layerTitle(l)}</span>
                  ) : (
                    <span className="muted"> {l.events.filter((e) => e.on).length} notes</span>
                  )}
                  {/* ⚠️ WHOSE PART IT IS, when it is not yours. Layers from the room sit in the
                  same list and work the same way — that is the point of sharing them — but an
                  arrangement where you cannot tell your bassline from your friend's is one
                  where you mute theirs looking for yours. Absent for your own, because every
                  row saying "you" is a column of noise. */}
                  {l.from && (
                    <span
                      className="inst-layer-who"
                      title={`Recorded by ${jamNames[l.from] ?? 'someone in the room'}`}
                    >
                      {jamNames[l.from] ?? 'Someone'}
                    </span>
                  )}
                </button>

                {/* Re-voice without replaying: the notes were right, the sound was not. Storing
                notes rather than audio is what makes this a dropdown instead of a re-take. */}
                <select
                  className="inst-layer-inst"
                  value={l.instrument}
                  onChange={(e) => setLayerInstrument(l.id, e.target.value as InstrumentId)}
                  title="Play this take on a different instrument"
                >
                  {INSTRUMENTS.map(([id, , name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>

                {/**
                 * The arrangement: which bars this layer plays in.
                 *
                 * ⚠️ Every bar is ON until you turn one off, so a take you just recorded behaves
                 * exactly as it always did and structure is something you opt into. This is the
                 * difference between a stack of loops all playing at once and a track — the
                 * tiling underneath already repeats a one-bar drum part across thirty-two bars,
                 * so the only thing missing was a way to say "not here".
                 */}
                {/**
                 * The track: a row of bars you can put in an order.
                 *
                 * ⚠️ EACH CELL NAMES THE BAR IT PLAYS, not merely whether it plays. That one
                 * change is what turns a mute strip into an arrangement — "bar 3 of this take
                 * sounds here" can be moved, where "on" can only be switched off.
                 *
                 * Two ways to move one, because they suit different hands. Dragging is what a
                 * mouse expects. On a touchscreen an HTML5 drag never starts, so a tap picks a
                 * bar up and a second tap puts it down — which also happens to be easier than
                 * dragging on a small screen even where dragging works.
                 */}
                <span className="inst-arrange" role="group" aria-label="The bars this layer plays">
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
                         * block with nothing in it until the bars are reordered, and its title is
                         * all that said what it was; a phone has no hover and a screen reader read
                         * a nameless button. The name says what the bar IS, and the title (now its
                         * description) keeps saying what a tap does. Visible words were measured
                         * and rejected: the row is a strip of 30px blocks.
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
                         * ⚠️ QUIET UNTIL IT HAS SOMETHING TO SAY. Numbering every cell made the
                         * common case harder to read: a take that plays straight through says
                         * 1 2 3 4, which is four numbers to tell you nothing happened. So a layer
                         * nobody has rearranged looks exactly as it always did — a row of blocks,
                         * on or off — and the numbers appear only once the order stops being the
                         * obvious one, which is the only time they explain anything.
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

                {/* Keeping ONE layer. This is the drum-loop case: a part worth reusing is almost
                never a whole song, and a library of one-layer loops is what makes the next
                song faster to start than the last one. */}
                {/* ⚠️ A WORD AS WELL AS THE ARROW — Evan's call, 9 Nov 2026. ⬇ alone was
                  explained only by its title, which a phone never shows, and every other
                  ⬇ in the room already says what it does: ⬇ Keep song. */}
                <button
                  className="btn"
                  onClick={() => onKeep(l.id)}
                  title="Keep this layer as a loop you can reuse"
                >
                  ⬇ Keep
                </button>

                {/* ⚠️ On the row, not behind a dialog. Balancing parts is done BY EAR, which means
                moving one while the others play — a slider you have to open something to reach
                is a slider you use once and then stop using. */}
                <label className="inst-layer-vol" title="How loud this layer is">
                  <span className="sr-only">Layer volume</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={l.gain ?? 1}
                    onChange={(e) => setLayerGain(l.id, Number(e.target.value))}
                  />
                </label>
                {/**
                 * What this take SOUNDS like, and a way to change your mind.
                 *
                 * The settings are frozen onto the layer when you commit it, which is the whole
                 * point — but frozen with no way back would mean replaying a part you were happy
                 * with just to give it more room. This shows what it kept and re-stamps the
                 * current knobs onto it, so changing the reverb costs a click rather than a
                 * performance.
                 */}
                {/* ⚠️ "COPY FX", NOT WHAT IT HAS — Evan, 11 Nov 2026. The face read "dry" or "echo +
                    room", which looks like a label and is a button: pressing it copies the effects
                    you have set now onto this layer, and only its tooltip said so, which a phone
                    never shows. The words for what the layer has moved into its name and title. */}
                <button
                  className="btn inst-layer-fx"
                  onClick={() => setLayerFx(l.id)}
                  aria-label={`Copy your current effects onto this layer (now: ${fxWord(l.fx)})`}
                  title={
                    `This layer plays with echo ${Math.round(l.fx.echo * 100)}, ` +
                    `space ${Math.round(l.fx.space * 100)}, ` +
                    `vibrato ${Math.round(l.fx.vibrato * 100)}. ` +
                    'Click to copy the effects you have set now onto it.'
                  }
                >
                  {/* ⚠️ "FX" ON A NARROW SCREEN — Evan, 12 Nov 2026. "Copy FX" is 32px wider than the
                      "dry" it replaced, which pushed a drum row that also has Split onto a third
                      line at 375 (113 → 144px). The full words stay in the name and the title. */}
                  <span className="inst-fx-long">Copy FX</span>
                  <span className="inst-fx-short" aria-hidden>
                    FX
                  </span>
                </button>

                {/* The third way to fix a take, after undo and re-voice: play it again over the
                top. The layer keeps its place in the stack rather than jumping to the end. */}
                {/* ⚠️ THE THREE ICONS GET NAMES, NOT WORDS — Evan, 9 Nov 2026. Words were measured
                  at 375: "⏺ Again", "🔊 Mute" and "✕ Delete" took every layer row from 114px to
                  144px, which is 360px down the page at twelve layers. A name reaches a screen
                  reader and the audit; the tooltip stays for a mouse. */}
                <button
                  className="btn"
                  onClick={() => armRecord(l.id)}
                  title="Record this layer again, keeping its place"
                  aria-label="Record this layer again"
                >
                  ⏺
                </button>
                {/* ⚠️ Only on a kit take with more than one piece in it, because that is the
                  only case where it does anything — see splitDrumLayer. */}
                {l.instrument === 'drums' &&
                  new Set(l.events.map((e) => ((e.midi % 12) + 12) % 12)).size > 1 && (
                    <button
                      className="btn"
                      onClick={() => splitDrumLayer(l.id)}
                      /* ⚠️ Says WHY rather than going dead. A split needs one row per piece, so
                       it is the person with the fullest arrangement who finds the button does
                       nothing — exactly the person owed an explanation. */
                      disabled={
                        loop.layers.length -
                          1 +
                          new Set(l.events.map((e) => ((e.midi % 12) + 12) % 12)).size >
                        MAX_LAYERS
                      }
                      title={
                        loop.layers.length -
                          1 +
                          new Set(l.events.map((e) => ((e.midi % 12) + 12) % 12)).size >
                        MAX_LAYERS
                          ? `Not enough room — this kit needs a row per drum and there are only ${MAX_LAYERS}`
                          : 'Give each drum its own row, so they stop sharing one volume and one set of effects'
                      }
                    >
                      {/* ⚠️ A WORD. ⇲ means nothing — it was chosen because it is small, and a
                        rare, deliberate, irreversible-ish action is the last place to save four
                        characters at the cost of anybody knowing what the button does. */}
                      Split
                    </button>
                  )}
                <button
                  className="btn"
                  onClick={() => toggleMute(l.id)}
                  /* a toggle: one name, and the state says whether it is on */
                  aria-label="Mute this layer"
                  aria-pressed={l.muted}
                  title={l.muted ? 'Muted — click to hear it again' : 'Mute this layer'}
                >
                  {l.muted ? '🔇' : '🔊'}
                </button>
                {/* ⚠️ DELETING SOMEBODY ELSE'S TAKE ASKS FIRST, and names them. It has always
                  been allowed — every control works on every part, which is the point of one
                  desk — but it is the only one of them that cannot be undone, and now that a
                  take outlives its author's presence it is also the only way to clear a slot
                  they left behind. Worth a sentence; not worth a different button. */}
                <button
                  className="btn"
                  onClick={() => {
                    const who = l.from ? (jamNames[l.from] ?? 'someone in the room') : null
                    if (who && !window.confirm(`Delete ${who}'s part? This cannot be undone.`))
                      return
                    removeLayer(l.id)
                  }}
                  title={
                    l.from
                      ? `Delete ${jamNames[l.from] ? `${jamNames[l.from]}'s` : 'their'} part — for everyone`
                      : 'Delete this layer'
                  }
                  aria-label={
                    l.from
                      ? `Delete ${jamNames[l.from] ? `${jamNames[l.from]}'s` : 'their'} part — for everyone`
                      : 'Delete this layer'
                  }
                >
                  ✕
                </button>
              </li>
            )
          })}
          {/* Outside the row it belongs to: a grid this wide inside a flex row would either
            squash the row or overflow it, and it reads better as a panel under the stack
            anyway — the list stays a list. */}
          {/* ⚠️ The note editor used to be an <li> here, between the layers and everything
            below them. See where it went. */}
          {/* ⚠️ LAYERS ONLY, and a recording placed in the loop stays where it is — Evan's call,
            9 Nov 2026, on the question #35 left open. A take has its own controls in the takes
            panel; this button lives in the layer list and clears the layer list. */}
          <li className="inst-layers-all">
            <button
              className="btn"
              onClick={clearLayers}
              title="Delete every layer — recordings in the loop stay"
            >
              Clear all
            </button>
          </li>
        </ul>
      )}
    </>
  )
}
