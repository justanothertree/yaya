import { canRecord } from './recordTake'
import { TAKE_CAP, type TakeRow } from './takes'
import { muteTake, takeChop } from './looper'
import { PLAIN_VOICE, type VoiceFx } from './takeFx'
import { CHOP_RATES, CHOP_SHAPES, NO_CHOP, type ChopShape } from './chop'
import { TakeEditor } from './TakeEditor'
import { editLen, isWholeEdit, logNow, readLog } from './takeEdit'
import { mb, secs, useTakes } from './useTakes'

/**
 * Singing, kept beside the song.
 *
 * ⚠️ THE SMALLEST THING THAT IS ACTUALLY USEFUL, and deliberately not the arrangement. Putting
 * a voice IN the loop — on a bar, following the tempo, muted per section — is a real piece of
 * work and it needs somewhere to put the audio first. This is that somewhere, doing the one
 * job that stands on its own: sing over what you have made, hear it back, keep it or bin it.
 *
 * ⚠️ AND IT IS NOT A LAYER. A Layer holds note events and the looper's header explains at
 * length why that is right; a take is the exception that cannot be notes, so it sits beside the
 * layers rather than pretending to be one. See takes.ts.
 */

/**
 * The five things worth turning on a voice, in the order the chain applies them.
 *
 * ⚠️ NAMED FOR WHAT THEY DO TO A VOICE, not for the node underneath. "Highpass and
 * highshelf" is two controls and a lesson; "Tone" is one slider that goes from warm to thin,
 * which is the thing somebody actually wants to move. See takeFx.
 */
const KNOBS: [keyof VoiceFx, string, string][] = [
  ['tone', 'Tone', 'Warm on the left, thin on the right'],
  ['squeeze', 'Even', 'Holds the loud bits down so the quiet ones can be heard'],
  ['double', 'Double', 'A second copy just behind it, so one voice sounds like two'],
  ['echo', 'Echo', 'Repeats'],
  ['echoTime', 'Echo gap', 'How far apart the repeats are'],
  ['space', 'Space', 'The room it sounds like it was sung in'],
]

/**
 * What this take plays right now, read from its stored history.
 *
 * ⚠️ READ, NOT REMEMBERED. The row in IndexedDB is the only truth about an edit; a copy held
 * in this component would be a second one, and the two would part company the moment the
 * editor changed something — which is the disagreement this pass exists to remove.
 */
const editOf = (r: TakeRow) => logNow(readLog(r.log, r.trim, r.len))

/** what each chop shape does, in the fewest words that are true — see chop.ts */
const CHOP_SAYS: Record<ChopShape, string> = {
  off: 'No chopping',
  gate: 'Cut in and out on the beat',
  swell: 'Fade up into every beat',
  duck: 'Drop on the beat and breathe back',
  tremolo: 'Wobble in time',
  stutter: 'Repeat the last bit of the bar',
}

export function TakesPanel() {
  const {
    rows,
    used,
    going,
    setGoing,
    held,
    playing,
    say,
    dry,
    setDry,
    goingRef,
    onLoop,
    open,
    setOpen,
    cut,
    setCut,
    sure,
    setSure,
    stems,
    bouncing,
    parts,
    refresh,
    stopPlaying,
    soundOf,
    setSound,
    play,
    begin,
    finish,
    openFile,
    bin,
    toLoop,
    doBounce,
  } = useTakes()

  if (!canRecord())
    return (
      <div className="inst-row inst-takes">
        <span className="muted">This browser cannot record audio.</span>
      </div>
    )

  return (
    <div className="inst-row inst-takes">
      <button
        className={'btn' + (going ? ' is-on' : '')}
        onClick={() => void (going ? finish() : begin())}
        title={going ? 'Stop and keep it' : 'Sing or play something into the microphone'}
      >
        {/* ⚠️ THE MIC GLYPH BECAUSE THERE ARE TWO RECORD BUTTONS IN THIS ROOM, and they record
            different kinds of thing: the transport's ⏺ Record keeps the NOTES you play, which are
            editable, quantisable and transposable, and this one keeps SOUND off a microphone,
            which is none of those. Reported as "there are two record functions" by somebody who
            had met both and could not tell which was which — a fair complaint about two buttons
            that both said Record. The word "take" is this room's name for the audio kind and the
            line below the button explains it; the glyph is what makes them tell apart at a
            glance, before anybody reads anything. */}
        {going ? `■ Stop — ${secs(held)}` : '🎤 Record a take'}
      </button>
      {going && (
        <button
          className="btn btn-ghost"
          onClick={() => {
            goingRef.current = null
            going.drop()
            setGoing(null)
          }}
          title="Throw this one away"
        >
          Discard
        </button>
      )}
      {/**
       * ⚠️ A LABEL WRAPPING A HIDDEN INPUT, not a button that clicks one. A file dialog may
       * only be opened from a real user gesture, and a `ref.current.click()` inside a handler
       * is one indirection away from browsers that refuse it. A label IS the gesture.
       *
       * ⚠️ AND NOTHING LEAVES THE MACHINE. The file is read into a Blob and put in the same
       * IndexedDB store a recording goes to — there is no upload here and no server that
       * would take one. The copy under the list says so, because "where did my voice memo
       * go" is a fair question to have about a site.
       */}
      {!going && (
        <label className="btn btn-ghost inst-takes-open" title="Use a sound file you already have">
          📂 Open a file
          <input
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              /* ⚠️ cleared, or picking the same file twice in a row fires no change event
                 and the second attempt silently does nothing */
              e.target.value = ''
              if (f) void openFile(f)
            }}
          />
        </label>
      )}
      {say && <span className="muted inst-takes-say">{say}</span>}
      {!rows.length && !going && (
        <span className="muted">
          {/* ⚠️ IT NAMED ONE WAY IN AND THERE ARE TWO NOW, which is the same rot as the beats
              panel: a sentence that lists what a feature does goes stale the moment the
              feature grows, and nothing downstream contradicts it. It also has one more job
              than it looks — "stay in this browser" is the answer to the question somebody
              has about handing a site a voice memo, so it goes before the invitation. */}
          Takes are recordings — a voice, a room, anything a note cannot be. Sing one or open a
          sound file you already have; either way it stays in this browser.
        </span>
      )}
      {rows.length > 0 && (
        <ul className="inst-takes-list">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                className="btn btn-ghost"
                onClick={() => void (playing === r.id ? stopPlaying() : play(r))}
              >
                {/* ⚠️ HOW LONG IT PLAYS, NOT HOW LONG IT WAS RECORDED — the figure beside a
                    play button is a claim about what pressing it does. Measured on screen
                    after a reload: a trimmed take's row read 0:04 while the button played one
                    second, because the length came off the stored row and the sound came off
                    the trim. The original is still named in the line beside it. */}
                {playing === r.id ? '■' : '▶'} {secs(editLen(editOf(r)))}
              </button>
              <span className="muted inst-takes-meta">
                {new Date(r.at).toLocaleDateString()} · {mb(r.bytes)}MB
                {/* ⚠️ SAID WHERE THE SIZE IS SAID, because the two together are the thing that
                    would otherwise look like a bug: a row reading 1 second and 0.4MB. The
                    recording is whole and only part of it is being played, and that sentence
                    belongs beside the number that gives it away. */}
                {!isWholeEdit(editOf(r), r.len) && ` · ${secs(r.len)} kept whole`}
              </span>
              {/* ⚠️ WHAT IT DOES, NOT WHERE IT GOES. "Add to loop" describes the mechanism;
                  this says the outcome, which is the thing somebody is deciding between. */}
              <button
                className={'btn btn-ghost' + (onLoop.some((t) => t.id === r.id) ? ' is-on' : '')}
                onClick={() => void toLoop(r)}
                title={
                  onLoop.some((t) => t.id === r.id)
                    ? 'Stop playing this with the loop'
                    : 'Play this every time the loop comes round'
                }
              >
                {onLoop.some((t) => t.id === r.id) ? '● In the loop' : '○ In the loop'}
              </button>
              {onLoop.some((t) => t.id === r.id) && (
                <button
                  className="btn btn-ghost"
                  onClick={() => muteTake(r.id)}
                  title={onLoop.find((t) => t.id === r.id)?.muted ? 'Unmute' : 'Mute'}
                >
                  {onLoop.find((t) => t.id === r.id)?.muted ? '🔇' : '🔊'}
                </button>
              )}
              {/* ⚠️ EVERY TAKE, NOT ONLY A PLACED ONE. This was offered only once a take was in
                  the loop, "because that is when the chain exists" — so a recording could not
                  be given a sound, or heard with one, until it was part of the song. The sound
                  belongs to the recording now and a preview plays through the same chain. */}
              <button
                className={'btn btn-ghost' + (open === r.id ? ' is-on' : '')}
                onClick={() => {
                  setDry(false)
                  setOpen(open === r.id ? null : r.id)
                }}
                title="How it sounds"
              >
                ⚙<span className="sr-only">How it sounds</span>
              </button>
              {/* ⚠️ SEEING IT IS A SEPARATE THING FROM EFFECTING IT, and it is available
                  whether or not the take is on the loop — the first question anybody has about
                  a recording is where the singing starts, and that is not a question about the
                  arrangement. ⚙ is only offered for a placed take because its chain does not
                  exist otherwise; a waveform always does. */}
              <button
                className={'btn btn-ghost' + (cut === r.id ? ' is-on' : '')}
                onClick={() => setCut(cut === r.id ? null : r.id)}
                title="Look at it and choose a part"
              >
                ✎{!isWholeEdit(editOf(r), r.len) && <span aria-hidden> ·</span>}
                <span className="sr-only">
                  {isWholeEdit(editOf(r), r.len)
                    ? 'Edit this recording'
                    : 'Edit this recording — trimmed'}
                </span>
              </button>
              {/**
               * ⚠️ IT ASKS NOW, AND IT DID NOT. One press of ✕ destroyed a recording outright —
               * no confirm, no undo, and the blob is the only copy there will ever be. Every
               * other path to losing a take is already careful: `putTake` refuses at the cap
               * rather than evicting, `sweepTakes` takes the ids to KEEP so a forgetful caller
               * deletes nothing, and a trim does not touch the bytes at all. This was the one
               * door left open, and it was a single mis-tap wide on a phone.
               *
               * ⚠️ NOT `window.confirm`, which is auto-dismissed in the Browser pane and
               * returns false — so a confirmed delete would appear to do nothing and the
               * feature would read as broken (CLAUDE.md records an hour lost to exactly that on
               * the paint room's Clear button). Two presses of the same button, with the second
               * one saying what it will do.
               */}
              {sure === r.id ? (
                <button
                  className="btn is-danger"
                  onClick={() => void bin(r.id)}
                  title="This cannot be undone"
                >
                  Delete for good?
                </button>
              ) : (
                <button
                  className="btn btn-ghost"
                  onClick={() => setSure(r.id)}
                  title="Delete this recording"
                >
                  ✕<span className="sr-only">Delete this recording</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {cut !== null && rows.some((r) => r.id === cut) && (
        <TakeEditor
          key={cut}
          row={rows.find((r) => r.id === cut)!}
          sound={dry ? null : soundOf(cut)}
          onChanged={() => void refresh()}
        />
      )}
      {open !== null && rows.some((r) => r.id === open) && (
        <div className="inst-takes-fx">
          {KNOBS.map(([key, label, hint]) => (
            <label key={key} className="inst-takes-knob" title={hint}>
              <span className="muted">{label}</span>
              <input
                type="range"
                min={key === 'tone' ? -1 : 0}
                max={key === 'echoTime' ? 0.8 : 1}
                step={0.02}
                value={soundOf(open)[key]}
                onChange={(e) => setSound(open, { [key]: Number(e.target.value) })}
                /* ⚠️ the instrument's keyboard listens on window, and a range takes only
                   arrows and Home/End — none of which are notes. See the note in
                   InstrumentRoom about the two sliders that swallowed every key. */
              />
            </label>
          ))}
          {/* ⚠️ "Flat" resets the SETTINGS and "As recorded" bypasses them: the chain at its
              settings' centre still filters the rumble (see `tone` in takeFx), so the two are
              different sounds, and the old title here — "Back to how it was recorded" —
              described the second while doing the first. */}
          <button
            className="btn btn-ghost"
            onClick={() => setSound(open, PLAIN_VOICE)}
            title="Every setting back to the middle"
          >
            Flat
          </button>
          <button
            className={'btn btn-ghost' + (dry ? ' is-on' : '')}
            aria-pressed={dry}
            onClick={() => setDry(!dry)}
            title="Hear the preview without any of this — press again for the sound"
          >
            As recorded
          </button>
          {/* ⚠️ THE CHOP SITS WITH THE REST, because from where somebody is standing it is
              one more thing you do to a take — even though underneath it is the only control
              here that is timed against the bar rather than applied to a signal. And that is
              why it is only HERE once the take is in the loop: it is cut against the loop's
              bars, and a preview on its own has none. Said in one line rather than hidden. */}
          {!onLoop.some((t) => t.id === open) && (
            <span className="muted inst-takes-note">
              Previews play with this sound. Chop needs the loop's beat — put it in the loop to use
              it.
            </span>
          )}
          {onLoop.some((t) => t.id === open) && (
            <label className="inst-takes-knob" title="How it is cut up against the bar">
              <span className="muted">Chop</span>
              <select
                value={(onLoop.find((t) => t.id === open)?.chop ?? NO_CHOP).shape}
                onChange={(e) => takeChop(open, { shape: e.target.value as ChopShape })}
              >
                {CHOP_SHAPES.map((sh) => (
                  <option key={sh} value={sh} title={CHOP_SAYS[sh]}>
                    {sh === 'off' ? 'none' : sh}
                  </option>
                ))}
              </select>
            </label>
          )}
          {onLoop.some((t) => t.id === open) &&
            (onLoop.find((t) => t.id === open)?.chop ?? NO_CHOP).shape !== 'off' && (
              <>
                <label className="inst-takes-knob" title="How many cuts to a bar">
                  <span className="muted">Per bar</span>
                  <select
                    value={(onLoop.find((t) => t.id === open)?.chop ?? NO_CHOP).rate}
                    onChange={(e) => takeChop(open, { rate: Number(e.target.value) })}
                  >
                    {CHOP_RATES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inst-takes-knob" title="How much of it">
                  <span className="muted">Depth</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={(onLoop.find((t) => t.id === open)?.chop ?? NO_CHOP).amount}
                    onChange={(e) => takeChop(open, { amount: Number(e.target.value) })}
                  />
                </label>
              </>
            )}
        </div>
      )}
      {/* ⚠️ WITH THE TAKES, because a stem is the same idea one step on: a take is one part
          of a song you recorded, and a stem is one part of a song you are taking somewhere
          else. Both are "a piece of this, on its own". */}
      <div className="inst-takes-stems">
        {parts > 0 && (
          <button
            className={'btn btn-ghost' + (bouncing ? ' is-on' : '')}
            disabled={!!bouncing}
            onClick={() => void doBounce()}
            title="Bounce every layer and every take to its own WAV, in real time"
          >
            {bouncing
              ? `Bouncing ${bouncing.doing || '…'} (${bouncing.done}/${bouncing.of})`
              : '⬇ Stems'}
          </button>
        )}
        {stems.map((st) => (
          <a
            key={st.name}
            className="btn btn-ghost"
            href={URL.createObjectURL(st.blob)}
            download={st.name}
          >
            {st.name}
          </a>
        ))}
      </div>
      {rows.length > 0 && (
        <span className="muted inst-takes-meta">
          {mb(used)} of {mb(TAKE_CAP)}MB
        </span>
      )}
    </div>
  )
}
