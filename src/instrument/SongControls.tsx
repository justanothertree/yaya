import { useSyncExternalStore } from 'react'
import { type InstrumentId } from '../audio/synth'
import { SnapPicker } from '../audio/SnapPicker'
import { songNotes, songToLayers } from '../audio/songFile'
import { library, removeFromLibrary, subscribeLibrary, type LibraryItem } from '../audio/library'

import { jam } from '../party/jam'
import {
  armRecord,
  cancelRecord,
  loopState,
  loopLength,
  captureLast,
  loadSong,
  addLayers,
  addEmptyLayer,
  MAX_LAYERS,
  setBars,
  setBpm,
  setMetronome,
  setQuantize,
  startLoop,
  stopLoop,
  seekTo,
} from '../audio/looper'
import { historyNow, redo, subscribeHistory, undo } from '../audio/history'
import { NumField } from './rowParts'

import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

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
 * The song's controls: the transport (play, the first-run starter, record, capture, click, tempo,
 * bars, snap, undo), the row under it (Beats & chords, Library, Keep song, New part), the library
 * list, the playhead, a song somebody offered in a jam, and the bar ruler — moved out of
 * InstrumentRoom.tsx unchanged on 11 Nov 2026.
 *
 * ⚠️ WHAT STAYS IN THE ROOM is what other parts of the room also change: which panels are open
 * (the keyboard shortcuts open and close them), the capture message (Shift-C sets it too), which
 * layer's notes are open, and the live ref the keyboard keeps current. The history, the library
 * and the jam are stores, so this reads them itself.
 */
export function SongControls({
  loop,
  live,
  editing,
  setEditing,
  beatsOpen,
  setBeatsOpen,
  libOpen,
  setLibOpen,
  capMsg,
  setCapMsg,
  keep,
}: {
  loop: ReturnType<typeof loopState>
  live: MutableRefObject<{ inst: InstrumentId }>
  editing: string | null
  setEditing: Dispatch<SetStateAction<string | null>>
  beatsOpen: boolean
  setBeatsOpen: Dispatch<SetStateAction<boolean>>
  libOpen: boolean
  setLibOpen: Dispatch<SetStateAction<boolean>>
  capMsg: string | null
  setCapMsg: Dispatch<SetStateAction<string | null>>
  keep: (kind: 'song' | 'loop', layerId?: string) => void
}) {
  const hist = useSyncExternalStore(subscribeHistory, historyNow, historyNow)
  const saved = useSyncExternalStore(subscribeLibrary, library, library)
  const jamming = useSyncExternalStore(jam.subscribe, jam.getState, jam.getState)
  return (
    <>
      {capMsg && (
        <p className="muted inst-capture-note" role="status">
          {capMsg}
        </p>
      )}
      <div className="inst-row inst-transport">
        <button
          className={'btn' + (loop.playing ? ' is-on' : '')}
          onClick={() => (loop.playing ? stopLoop() : startLoop())}
          title={loop.playing ? 'Stop the loop' : 'Start the loop'}
        >
          {loop.playing ? '⏹ Stop' : '▶ Play'}
        </button>

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
                onClick={() => setBeatsOpen((v) => !v)}
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
        </button>

        <button
          className={'btn' + (loop.metronome ? ' is-on' : '')}
          aria-pressed={loop.metronome}
          onClick={() => setMetronome(!loop.metronome)}
          title="Click on every beat"
        >
          🎯 Click
        </button>

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

        {/**
         * ⚠️ UNDO AND REDO FOR THE WHOLE ROOM — Evan, 9 Nov 2026 — where "↶ Undo take" was. That
         * took back the last LAYER and nothing else could be taken back at all; these take back
         * the last change, whatever it was: a deletion, Clear all, a swap, a drag, a tempo, a song
         * opened over your work. See history.ts, including why a jam partner's changes are not
         * yours to undo.
         *
         * ⚠️ SHOWN WHILE THERE IS ANYTHING TO UNDO, not only while there are layers: after Clear
         * all the room is empty and Undo is the one button that matters.
         *
         * ⚠️ AND STOOD DOWN WHILE THE NOTE EDITOR IS OPEN, which has its own undo for its own
         * notes and takes Ctrl+Z for it. Two undos answering one key would each take a step.
         */}
        {(loop.layers.length > 0 || hist.undo > 0 || hist.redo > 0) && (
          /* one unit, so a phone wraps the pair onto the next line together rather than
           splitting them — measured at 375, Redo alone went down a line */
          <span className="inst-undo" role="group" aria-label="Undo and redo">
            <button
              className="btn"
              onClick={() => undo()}
              disabled={!hist.undo || !!editing}
              title={
                editing
                  ? 'The note editor has its own undo while it is open'
                  : 'Undo your last change to the layers (Ctrl+Z)'
              }
            >
              ↶ Undo
            </button>
            <button
              className="btn"
              onClick={() => redo()}
              disabled={!hist.redo || !!editing}
              title={
                editing
                  ? 'The note editor has its own redo while it is open'
                  : 'Redo what you undid (Ctrl+Shift+Z)'
              }
            >
              ↷ Redo
            </button>
          </span>
        )}
      </div>
      {/**
       * ⚠️ TWO LINES, TWO JOBS — Evan, 10 Nov 2026: "group related controls". The first is the
       * LOOP: play it, record into it, keep what you just played, keep time, undo. The second is
       * the PARTS: drop in a beat or chords, open a song, keep this one, start an empty part. They
       * used to be one row in the order they were added, so Record sat on the second line under
       * Library and ▶ Play's nearest neighbour was ✎ New part. Nothing was hidden or renamed.
       */}
      <div className="inst-row inst-transport">
        {/* ⚠️ HERE TOO, not only in the start row. The start row disappears the moment you have
          a layer — and so, with it, did the only way to reach the beats, so adding a drum part
          to something you had already begun was impossible. A doorway that closes behind you is
          worse than no doorway: the feature looks like it was imagined rather than built. */}
        <button
          className={'btn' + (beatsOpen ? ' is-on' : '')}
          aria-pressed={beatsOpen}
          onClick={() => setBeatsOpen((v) => !v)}
          disabled={loop.layers.length >= MAX_LAYERS}
          title={
            loop.layers.length >= MAX_LAYERS
              ? `That is all ${MAX_LAYERS} layers — delete one to add another`
              : 'Drums, chords, a bassline and a fill — drop any of them in, then change them'
          }
        >
          🥁 Beats & chords
        </button>
        <button
          className={'btn' + (libOpen ? ' is-on' : '')}
          aria-pressed={libOpen}
          onClick={() => setLibOpen((v) => !v)}
          title="Songs and loops you have kept"
        >
          📁 Library{saved.length ? ` · ${saved.length}` : ''}
        </button>
        <button
          className="btn"
          disabled={!loop.layers.length}
          onClick={() => keep('song')}
          title="Keep this whole arrangement"
        >
          ⬇ Keep song
        </button>
        {/* Start a part by drawing it rather than by playing it. The editor was only reachable
          through a recording, which meant placing four notes by hand required performing them
          first. */}
        <button
          className="btn"
          onClick={() => setEditing(addEmptyLayer(live.current.inst) || null)}
          disabled={loop.layers.length >= MAX_LAYERS}
          title={
            loop.layers.length >= MAX_LAYERS
              ? `That is all ${MAX_LAYERS} layers — delete one to add another`
              : 'Add an empty layer and draw notes into it'
          }
        >
          ✎ New part
        </button>
      </div>

      {/* ⚠️ BELOW THE BUTTON THAT OPENS IT, WHICH IT WAS NOT. This rendered a hundred and
        fifty lines earlier, so 📁 Library and 🥁 Beats — two disclosure buttons side by side in
        the same row — opened in opposite directions: measured at 1440x900 with a song loaded,
        both buttons sat at y=1500, Beats opened its panel at 1636 and the library opened at
        1275, two hundred and twenty-five pixels ABOVE the button and off the top of the
        screen. Pressing it looked exactly like pressing a button that does nothing.

        ⚠️ AND THE ROW IT LEFT WAS THE WRONG HOME ANYWAY. It sat between the scale picker and
        the takes panel, which is playing-the-keyboard material — so the one panel you open
        while arranging a song lived up among the controls you use before you start. */}
      {libOpen && (
        <div className="inst-row inst-library">
          {!saved.length ? (
            <span className="muted">
              Nothing kept yet. Record something, then <strong>Keep song</strong> — or ⬇ a single
              layer to reuse later.
            </span>
          ) : (
            <ul className="inst-lib-list">
              {saved.map((it: LibraryItem) => (
                <li key={it.id}>
                  <span className="inst-lib-name">
                    {it.kind === 'loop' ? '🔁' : '🎵'} {it.name}
                  </span>
                  <span className="muted inst-lib-meta">
                    {it.song.layers.length} layer{it.song.layers.length === 1 ? '' : 's'} ·{' '}
                    {songNotes(it.song)} notes · {it.song.bpm}bpm
                  </span>
                  {/* Two different verbs, and the distinction is the whole point of the library.
                    Open REPLACES what you have; Add brings this part in alongside it. */}
                  <button
                    className="btn"
                    onClick={() => {
                      loadSong(it.song.bpm, it.song.bars, songToLayers(it.song))
                      setEditing(null)
                      // ⚠️ offered, not pushed — see jam.offerSong. A no-op when nobody is jamming.
                      jam.offerSong(it.song)
                    }}
                    title="Open this, replacing what you have now"
                  >
                    Open
                  </button>
                  <button
                    className="btn"
                    onClick={() => addLayers(songToLayers(it.song))}
                    title="Add these layers to what you are working on"
                  >
                    + Add
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      if (window.confirm(`Delete “${it.name}”?`)) removeFromLibrary(it.id)
                    }}
                    title="Delete this"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
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

      {/**
       * ⚠️ THE BAR NUMBERS, AND THE WAY TO JUMP TO ONE.
       *
       * The tiles below say which bars a layer plays, but nothing said WHICH bar you were
       * looking at — you counted along the row. This is the same cell width as a tile, so a
       * number sits directly above its column, and clicking one moves the playhead there.
       *
       * Seeking is here rather than on the tiles because a tile already means two things — turn
       * this bar off, or pick it up and move it — and a third would make every click a guess.
       * The ruler has nothing else to do.
       */}
      {loop.layers.length > 0 && loop.bars > 1 && (
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
      )}
    </>
  )
}
