import { useState } from 'react'
import {
  MAX_LAYERS,
  addPartLike,
  armRecord,
  clearLayerBars,
  layerHeard,
  takeBars,
  loopLength,
  removeLayer,
  setLayerFx,
  setLayerFxValue,
  setLayerGain,
  setLayerInstrument,
  splitDrumLayer,
  toggleMute,
  type Layer,
  type loopState,
} from '../audio/looper'
import { copyInto } from '../audio/noteClip'
import { toNotes } from '../audio/noteEdit'
import { INSTRUMENTS, type InstrumentId } from '../audio/synth'
import { PianoRoll } from '../sections/PianoRoll'
import { fxWord } from './fxWord'
import { Panel } from './Panel'
import { partLines } from './partName'
import { KNOBS } from './knobs'

export type PartTab = 'notes' | 'sound' | 'more'
const TABS: Array<[PartTab, string]> = [
  ['notes', 'Notes'],
  ['sound', 'Sound'],
  ['more', 'More'],
]

/** how many rows one kit take would become if it were split, one per piece */
const piecesIn = (l: Layer) => new Set(l.events.map((e) => ((e.midi % 12) + 12) % 12)).size

/**
 * A part's menu: its volume, its sound and its notes, in one place — Evan, 15 Nov 2026: "tapping
 * a layer part opens one menu (a sheet on phone, a panel on desktop) holding that layer's volume,
 * its extra sound settings, and its piano roll, instead of those sitting at the bottom of the
 * screen."
 *
 * ⚠️ IT REPLACES TWO THINGS, AND LOSES NOTHING FROM EITHER. The piano roll used to open at the
 * end of the room, 1,500px from the part you pressed on a phone; the ⋯ sheet held the rest. Every
 * control from both is here: Notes is the editor itself; Sound is what it plays as, its own
 * effects (new — they could only be copied from the knobs before) and Copy your sound onto it;
 * More is record again, split, keep as a loop and delete.
 *
 * ⚠️ THE VOLUME AND THE MUTE SIT ABOVE THE TABS, so they are there whichever tab is open —
 * balancing a part is done by ear while changing it, not as a separate visit.
 *
 * ⚠️ AND IT OUTLIVES ITS PART BY NOTHING. The room asks `openEditor` after every change and closes
 * this when the part has gone (a delete, Clear all, a jam partner removing it).
 */
export function PartPanel({
  l,
  loop,
  tab,
  setTab,
  open,
  close,
  held,
  theirs,
  onKeep,
}: {
  l: Layer
  loop: ReturnType<typeof loopState>
  tab: PartTab
  setTab: (t: PartTab) => void
  /** move the panel to another part, on a given tab */
  open: (id: string, tab: PartTab) => void
  close: () => void
  held: number[]
  /** recorded by somebody else in the room: their name, or '' when the room does not know it */
  theirs: string | null
  onKeep: (layerId: string) => void
}) {
  const i = loop.layers.indexOf(l)
  const said = partLines(l, i)
  const nameOf = (id: string) => {
    const k = loop.layers.findIndex((x) => x.id === id)
    return k < 0 ? null : partLines(loop.layers[k], k).name
  }
  return (
    <Panel
      title={said.name}
      detail={said.detail}
      onClose={close}
      className="inst-part-panel"
      /* ⚠️ the roll uses Escape itself first — a selection, then its select tool — and closes
         this when it has nothing left to use it on; see Panel. A field keeps Escape too, so the
         roll stands aside while somebody is in one and this closes instead. */
      escape={() => tab !== 'notes' || typingIn()}
    >
      <div className="inst-part-panel-top">
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
        <button
          className="btn inst-icon"
          onClick={() => toggleMute(l.id)}
          aria-label={`Mute ${said.name}`}
          aria-pressed={!!l.muted}
          title={l.muted ? 'Muted — click to hear it again' : 'Mute this part'}
        >
          {l.muted ? '🔇' : '🔊'}
        </button>
      </div>
      {/* ⚠️ A GROUP OF PRESSED BUTTONS, like the room's other choices, rather than ARIA tabs —
          tabs promise arrow-key movement between them, and a promise a control does not keep is
          worse for a screen reader than the plainer thing that is true */}
      <div className="inst-part-tabs" role="group" aria-label="Show this part's">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            aria-pressed={tab === t}
            className={'btn' + (tab === t ? ' is-on' : ' btn-ghost')}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="inst-part-pane">
        {tab === 'notes' && (
          <>
            {/* ⚠️ `.inst-roll-host` STAYS ON IT: the room's Ctrl+Z asks for that class to know the
                editor has the key — see InstrumentRoom's keyboard handler */}
            <div className="inst-roll-host">
              <PianoRoll
                layer={l}
                bpm={loop.bpm}
                quantize={loop.quantize}
                position={loop.position}
                loopLen={loopLength()}
                held={held}
                onClose={close}
                inPanel
                partName={nameOf}
              />
            </div>
            <CopyAll l={l} loop={loop} open={open} />
          </>
        )}
        {tab === 'sound' && <SoundTab l={l} />}
        {tab === 'more' && (
          <>
            <PartBars l={l} bars={loop.bars} />
            <MoreTab
              l={l}
              rows={loop.layers.length}
              theirs={theirs}
              close={close}
              onKeep={onKeep}
            />
          </>
        )}
      </div>
    </Panel>
  )
}

/** is somebody typing in a field — where Escape belongs to the field, not to the roll */
const typingIn = () => {
  const t = document.activeElement
  return !!t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
}

/**
 * "Copy all its notes to…" — every note of this part into another one, or into a new part shaped
 * like this one, in the same bars.
 *
 * ⚠️ IT TAKES YOU TO THEM. The paste happens in the other part's own editor (see `pending` in
 * noteClip.ts), so you see where they landed, and the ↶ beside them takes the copy back.
 */
function CopyAll({
  l,
  loop,
  open,
}: {
  l: Layer
  loop: ReturnType<typeof loopState>
  open: (id: string, tab: PartTab) => void
}) {
  const others = loop.layers.filter((x) => x.id !== l.id)
  const full = loop.layers.length >= MAX_LAYERS
  const [to, setTo] = useState<string>('')
  const count = l.events.filter((e) => e.on).length
  const target = others.some((x) => x.id === to) ? to : full ? (others[0]?.id ?? '') : to || 'new'
  if (!count) return null
  const go = () => {
    const notes = toNotes(l.events, l.len)
    const into = target === 'new' ? addPartLike(l.id) : target
    if (!into) return
    copyInto(notes, l.id, into)
    open(into, 'notes')
  }
  return (
    <div className="inst-row inst-copy-all">
      <label className="inst-pick">
        <span className="muted">
          Copy all {count} note{count === 1 ? '' : 's'} to
        </span>
        <select value={target} onChange={(e) => setTo(e.target.value)}>
          {!full && <option value="new">a new part</option>}
          {others.map((x) => (
            <option key={x.id} value={x.id}>
              {partLines(x, loop.layers.indexOf(x)).name}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-ghost" onClick={go} disabled={!target}>
        ⧉ Copy
      </button>
    </div>
  )
}

/** What it plays as, and its own effects. */
function SoundTab({ l }: { l: Layer }) {
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
      {/**
       * ⚠️ THIS PART'S OWN EFFECTS, which could not be changed before — only replaced wholesale
       * with whatever ⚙ Sound said at the time (the button below). The same six sliders, the
       * same words, so the two sets read as the same controls aimed at different things: those
       * shape what your hands play, these shape this part.
       */}
      <div className="inst-row inst-knobs">
        {KNOBS.map(([k, label, hint]) => (
          <label key={k} className="appearance-slider inst-knob" title={hint}>
            <span className="muted">{label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={l.fx[k]}
              onChange={(e) => setLayerFxValue(l.id, k, Number(e.target.value))}
            />
            <span className="appearance-slider-val">{Math.round(l.fx[k] * 100)}</span>
          </label>
        ))}
      </div>
      {/**
       * What this part SOUNDS like, and a way to change your mind. The settings are frozen onto
       * the part when you commit it; this re-stamps the current ⚙ Sound onto it, so changing the
       * reverb costs a press rather than a performance. The words say what it DOES and then what
       * it has now (Evan, 11 Nov 2026).
       */}
      <button
        className="btn btn-ghost"
        onClick={() => setLayerFx(l.id)}
        title="Put the effects from ⚙ Sound onto this part, in place of its own"
      >
        FX Copy your sound onto it <span className="muted">· now {fxWord(l.fx)}</span>
      </button>
    </div>
  )
}

/** Record it again, split it, keep it, delete it — the ones that take you somewhere else. */
/**
 * Which bars a part plays, said in words, and the way back to all of them.
 *
 * ⚠️ THE TILES ON ITS ROW ARE THE ARRANGEMENT, AND WHAT THEY DO WAS ONLY EVER IN A TOOLTIP (15 Nov
 * 2026) — tap one to pick it up, tap another to move it there, tap it again to leave that bar
 * silent — and a phone shows no tooltip. The part menu is where a phone goes for a part, so it
 * says it here, with Play in every bar beside it. The tiles and their own "all" stay on the row.
 */
function PartBars({ l, bars }: { l: Layer; bars: number }) {
  const heard = layerHeard(l).slice(0, bars)
  const on = heard.filter((x) => x != null).length
  const moved =
    !!l.plan && heard.some((src, b) => src != null && src !== b % Math.max(1, takeBars(l)))
  return (
    <div className="inst-part-bars">
      <p className="muted inst-note">
        {on === bars ? `Plays in all ${bars} bars` : `Plays in ${on} of ${bars} bars`}
        {moved ? ', in an order of its own' : ''}. On its row, tap a bar to pick it up, then tap
        another to move it there, or the same one again to leave that bar silent.
      </p>
      {(l.play || l.plan) && (
        <button className="btn btn-ghost" onClick={() => clearLayerBars(l.id)}>
          Play in every bar
        </button>
      )}
    </div>
  )
}

function MoreTab({
  l,
  rows,
  theirs,
  close,
  onKeep,
}: {
  l: Layer
  rows: number
  theirs: string | null
  close: () => void
  onKeep: (layerId: string) => void
}) {
  const pieces = piecesIn(l)
  /* a split needs one row per piece, and the take's own row is freed by it */
  const noRoom = rows - 1 + pieces > MAX_LAYERS
  /* whose it is, as the confirmation says it and as the button does — "their" when the room
     does not know the name */
  const who = theirs === null ? null : theirs || 'someone in the room'
  const whose = theirs === null ? null : theirs ? `${theirs}'s` : 'their'
  return (
    <div className="inst-sheet-list">
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
      {/* ⚠️ Only on a kit take with more than one piece in it — see splitDrumLayer. Says WHY
          rather than going dead: it is the fullest arrangement that runs out of rows. */}
      {l.instrument === 'drums' && pieces > 1 && (
        <button
          className="btn btn-ghost"
          onClick={() => {
            splitDrumLayer(l.id)
            close()
          }}
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
      {/* Keeping ONE part — the drum-loop case: a library of one-part loops is what makes the
          next song faster to start than the last one. */}
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
      {/* ⚠️ DELETING SOMEBODY ELSE'S TAKE ASKS FIRST, and names them: it is the one control that
          cannot be undone by the person whose part it was. */}
      <button
        className="btn btn-ghost"
        onClick={() => {
          if (who && !window.confirm(`Delete ${who}'s part? This cannot be undone.`)) return
          removeLayer(l.id)
          close()
        }}
        title={whose ? `Delete ${whose} part — for everyone` : 'Delete this part'}
      >
        ✕ {whose ? `Delete ${whose} part, for everyone` : 'Delete it'}
      </button>
    </div>
  )
}
