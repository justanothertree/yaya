import { useState, useSyncExternalStore } from 'react'
import { SnapPicker } from '../audio/SnapPicker'
import { songToLayers } from '../audio/songFile'
import { jam } from '../party/jam'
import {
  armRecord,
  cancelRecord,
  loopState,
  captureLast,
  loadSong,
  setBars,
  setBpm,
  setMetronome,
  setQuantize,
  startLoop,
  stopLoop,
} from '../audio/looper'
import { setSongName } from './songName'
import { NumField, Why } from './rowParts'
import { Sheet } from './Sheet'
import { tempoFace } from './tempoFace'

import type { Dispatch, SetStateAction } from 'react'

/**
 * Tempos as words, because "how fast?" is not a question about numbers.
 *
 * ⚠️ FOUR, NOT TWELVE. The point is to be choosable in a second by somebody who does not
 * know what 96 means — a list long enough to need reading is the same blank page with more steps
 * on it. The number field beside them is still there for anybody who does know, and the chosen
 * value is shown so the two never feel like different settings.
 */
const TEMPOS: Array<[number, string]> = [
  [70, 'Slow'],
  [90, 'Steady'],
  [120, 'Upbeat'],
  [140, 'Fast'],
]

/**
 * The song's controls: the transport (play, record, capture), the click and the button for speed,
 * length and snap, the first-run starter, the playhead and a song somebody offered in a jam.
 * Moved out of InstrumentRoom.tsx unchanged on 11 Nov 2026, and regrouped by the #311 layout on
 * 14 Nov 2026: undo and redo went to the bar ruler with the bar ruler itself (see LayerList), the
 * mic takes to 🎤 Voice, and Beats, the library, Keep song and Stems to the tools under the parts
 * (see SongTools). ✎ New part sits under the parts.
 *
 * ⚠️ WHAT STAYS IN THE ROOM is what other parts of the room also change: which tool is open (the
 * first-visit step opens Beats, and keeping a song opens Songs), the capture message (Shift-C and
 * keeping set it too), and which layer's notes are open.
 */
export function SongControls({
  loop,
  setEditing,
  beatsOpen,
  toggleBeats,
  capMsg,
  setCapMsg,
}: {
  loop: ReturnType<typeof loopState>
  setEditing: Dispatch<SetStateAction<string | null>>
  /** whether the 🥁 Beats tool is open, which the first-visit step opens and closes */
  beatsOpen: boolean
  toggleBeats: () => void
  capMsg: string | null
  setCapMsg: Dispatch<SetStateAction<string | null>>
}) {
  const jamming = useSyncExternalStore(jam.subscribe, jam.getState, jam.getState)
  const [tempoOpen, setTempoOpen] = useState(false)
  return (
    <>
      {capMsg && (
        <p className="muted inst-capture-note" role="status">
          {capMsg}
        </p>
      )}
      {/**
       * ⚠️ ROW ONE IS WHAT YOU PRESS WHILE MAKING A SONG — the #311 layout, 14 Nov 2026. Play, then
       * the two ways to keep what you play. On a phone ▶ Play sat at 763px, under the bottom bar,
       * so the keys and the transport were never on screen together.
       */}
      <div className="inst-row inst-transport">
        <button
          className={'btn' + (loop.playing ? ' is-on' : '')}
          onClick={() => (loop.playing ? stopLoop() : startLoop())}
          title={loop.playing ? 'Stop the loop' : 'Start the loop'}
        >
          {loop.playing ? '⏹ Stop' : '▶ Play'}
        </button>

        <button
          className={
            'btn inst-rec' + (loop.recording ? ' is-rec' : loop.waiting ? ' is-armed' : '')
          }
          onClick={() => (loop.waiting || loop.recording ? cancelRecord() : armRecord())}
          title="Record a pass — it starts at the top of the loop"
        >
          {loop.recording
            ? loop.replacing
              ? '⏺ Replacing'
              : '⏺ Recording'
            : loop.waiting
              ? // ⚠️ Only the last bar gets a number, because only the last bar gets clicks.
                // Arming early in a long loop can be eight beats away, and counting "8…7…6" at
                // somebody is not a count-in — it is a wait. The clicks and the digits describe
                // the same four beats.
                loop.countIn && loop.countIn <= 4
                ? `⏳ ${loop.countIn}…`
                : '⏳ Armed…'
              : '⏺ Record'}
          {/* ⚠️ SAID ON THE BUTTON — item 2 of the 11 Nov 2026 flow map. Record, Capture and the
              mic take are three ways to keep something, and the one sentence that told them apart
              belonged to the starter row, which is gone after the first layer. Pressing it while
              armed or recording throws the pass away (cancelRecord), so that is what it says. */}
          <Why>{loop.waiting || loop.recording ? 'tap to cancel' : 'from the top'}</Why>
        </button>

        {/**
         * Capture — Josh's idea, and the best one in the transport.
         *
         * ⚠️ It does not start anything. Everything you play is already in a rolling buffer, so
         * this asks "keep what just happened" rather than "start keeping things". The whole
         * value is that you decide AFTER hearing it, which is when you actually know.
         */}
        <button
          className="btn"
          onClick={() => {
            const r = captureLast()
            /**
             * ⚠️ AND IT OPENS WHAT IT KEPT, which is the whole of the gap this closes. Capture is
             * a decision made AFTER playing — you press it because you liked what you heard — so
             * the next thing anybody wants is to look at what they got. Leaving the notes closed
             * meant the reward for pressing it was a four-second message and no visible change.
             */
            if (r.ok && r.id) setEditing(r.id)
            setCapMsg(
              !r.ok
                ? 'Nothing to capture yet — play something first.'
                : r.tempoSet
                  ? `Captured ${r.notes} notes · tempo set to ${r.bpm} from your playing`
                  : `Captured ${r.notes} notes`,
            )
            window.setTimeout(() => setCapMsg(null), 4000)
          }}
          title="Keep the last loop's worth of what you just played — no need to have been recording"
        >
          ⧉ Capture
          <Why>keep what you played</Why>
        </button>
      </div>

      {/**
       * ⚠️ ROW TWO IS SET ONCE A SONG AND READ OFTEN — the click, and one button for speed, length
       * and snap that reads all three (Evan, 14 Nov 2026: "yes, if the button reads all three
       * values, and the sheet has every control the toolbar has today"). The six controls they
       * were cost a phone two lines of toolbar on every visit.
       */}
      <div className="inst-row inst-transport inst-transport-set">
        <button
          className={'btn' + (loop.metronome ? ' is-on' : '')}
          aria-pressed={loop.metronome}
          onClick={() => setMetronome(!loop.metronome)}
          title="Click on every beat"
        >
          🎯 Click
        </button>

        <button
          className="btn btn-ghost inst-tempo-open"
          aria-haspopup="dialog"
          aria-expanded={tempoOpen}
          onClick={() => setTempoOpen(true)}
          title="Speed, length and snap"
        >
          <span>{tempoFace(loop.bpm, loop.bars, loop.quantize)}</span>
          <span aria-hidden>▾</span>
        </button>
      </div>
      {tempoOpen && (
        <Sheet title="Speed, length and snap" onClose={() => setTempoOpen(false)}>
          <div className="inst-row inst-sheet-row">
            <NumField
              label="BPM"
              value={loop.bpm}
              min={40}
              max={200}
              onCommit={setBpm}
              title="How fast the loop runs — type it, or drag the word up and down"
            />

            <NumField
              label="Bars"
              value={loop.bars}
              min={1}
              max={32}
              onCommit={setBars}
              title="How long the loop is — type it, or drag the word up and down"
            />

            {/* ⚠️ The SAME control the note editor shows, from one component — it used to be a
              dropdown here and nothing at all in there, so opening the editor looked like snap had
              turned into the Length buttons. See SnapPicker. */}
            <SnapPicker value={loop.quantize} onPick={setQuantize} />
          </div>
        </Sheet>
      )}

      {/**
       * ⚠️ THE FIRST TWO DECISIONS, IN FRONT OF YOU, ONCE.
       *
       * Every song on this site is at the default tempo. Part of that was a real bug — typing a
       * number could not change it — but the rest is that nothing ever suggested choosing one,
       * and a tempo picked after you have recorded a part is a tempo you have already committed
       * to. It is the first decision and it was the least visible thing in the room.
       *
       * The beat beside it is the same problem from the other end: the room assumes you can
       * play something, and somebody who cannot play drums has nothing to build against. One
       * bar of something makes every other control in here suddenly worth using.
       *
       * ⚠️ IT GOES AWAY THE MOMENT THERE IS A LAYER, and never comes back on its own. This is
       * scaffolding for the blank page, not a panel — leaving it up would mean paying for a
       * beginner's row on every session forever, which is how a room gets cluttered by
       * features that were only ever meant to be a start.
       */}
      {!loop.layers.length && (
        <div className="inst-start">
          <span className="inst-start-step">
            <span className="muted">1. How fast?</span>
            {TEMPOS.map(([n, label]) => (
              <button
                key={n}
                className={'btn' + (loop.bpm === n ? ' is-on' : ' btn-ghost')}
                aria-pressed={loop.bpm === n}
                onClick={() => setBpm(n)}
                title={`${label} — ${n} beats a minute`}
              >
                {label}
              </button>
            ))}
            <span className="muted inst-start-bpm">{loop.bpm}</span>
          </span>
          <span className="inst-start-step">
            <span className="muted">2. Something to play over</span>
            <button
              className={'btn' + (beatsOpen ? ' is-on' : '')}
              aria-pressed={beatsOpen}
              onClick={toggleBeats}
              title="Drums, chords, a bassline and a fill — drop any of them in, then change them"
            >
              🥁 Pick a style, a beat or some chords
            </button>
            <span className="muted inst-start-or">or just play</span>
          </span>
          {/**
           * ⚠️ STEP 3, BECAUSE THE SCAFFOLDING STOPPED EXACTLY WHERE THE CONFUSION STARTS. The
           * row taught the two decisions you make BEFORE playing and then said "or just play",
           * which is where somebody's first try ended: they played something good and had no
           * idea what to do about it. Capture is the answer and its name does not say so — and
           * a `title` is not an answer either, because a tooltip does not exist on a phone.
           *
           * ⚠️ IT NAMES THE BUTTON RATHER THAN BEING ONE. A second Capture here would be two
           * controls doing one job, and the one in the transport is the one that will still be
           * there tomorrow when this row has gone.
           */}
          <span className="inst-start-step">
            <span className="muted">3. Liked what you played?</span>
            <span className="muted inst-start-or">
              press ⧉ Capture — it keeps the last bit, no recording needed
            </span>
          </span>
        </div>
      )}

      {/* the playhead — a bar you can glance at rather than count against */}
      {loop.playing && (
        <div className="inst-playhead" aria-hidden>
          <span style={{ width: `${Math.round(loop.position * 100)}%` }} />
        </div>
      )}

      {jamming.offer && (
        /**
         * ⚠️ A CHOICE, not a notification. Taking it replaces every layer you have, which is
         * the one thing a message from somebody else must never do on its own — so the button
         * says what it will cost and the other one simply makes it go away.
         */
        <p className="inst-offer">
          <strong>{jamming.offer.from === 'me' ? 'You' : jamming.offer.name}</strong> opened “
          {jamming.offer.song.name}” — {jamming.offer.song.layers.length} part
          {jamming.offer.song.layers.length === 1 ? '' : 's'}
          <button
            className="btn"
            onClick={() => {
              const o = jamming.offer
              if (!o) return
              loadSong(o.song.bpm, o.song.bars, songToLayers(o.song))
              setSongName(o.song.name)
              jam.clearOffer()
            }}
            title="Replaces the parts you have now"
          >
            Load it
          </button>
          <button className="btn btn-ghost" onClick={() => jam.clearOffer()}>
            No thanks
          </button>
        </p>
      )}
    </>
  )
}
