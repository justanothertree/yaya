import { useCallback, useEffect, useRef, useState } from 'react'
import { sharedCtx, resumeAudio } from './context'
import { takeBus } from './takeBus'
import { audioSeconds, canRecord, decodeTake, recordTake, type Recording } from './recordTake'
import {
  allTakes,
  dropTake,
  putTake,
  takenBytes,
  TAKE_CAP,
  TAKE_MAX_SECONDS,
  type TakeRow,
} from './takes'
import { liftTake, muteTake, placeTake, subscribeLoop, loopState, takeFx, takeChop } from './looper'
import { PLAIN_VOICE, type VoiceFx } from './takeFx'
import { CHOP_RATES, CHOP_SHAPES, NO_CHOP, type ChopShape } from './chop'
import { bounceStems, type Stem, type StemProgress } from './stems'
import { TakeEditor } from './TakeEditor'
import { isWhole, trimFrames, trimLen } from './takeEdit'

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

const fxOf = (fx: VoiceFx | undefined): VoiceFx => ({ ...PLAIN_VOICE, ...fx })

/** what each chop shape does, in the fewest words that are true — see chop.ts */
const CHOP_SAYS: Record<ChopShape, string> = {
  off: 'No chopping',
  gate: 'Cut in and out on the beat',
  swell: 'Fade up into every beat',
  duck: 'Drop on the beat and breathe back',
  tremolo: 'Wobble in time',
  stutter: 'Repeat the last bit of the bar',
}

const mb = (n: number) => (n / (1024 * 1024)).toFixed(1)
const secs = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`

export function TakesPanel() {
  const [rows, setRows] = useState<TakeRow[]>([])
  const [used, setUsed] = useState(0)
  const [going, setGoing] = useState<Recording | null>(null)
  const [held, setHeld] = useState(0)
  const [playing, setPlaying] = useState<string | null>(null)
  const [say, setSay] = useState('')
  const out = useRef<{ src: AudioBufferSourceNode; gain: GainNode } | null>(null)
  /* which takes are on the loop, straight from the transport so the two cannot disagree */
  const [onLoop, setOnLoop] = useState(() => loopState().takes)
  /** which take's controls are showing, if any */
  const [open, setOpen] = useState<string | null>(null)
  /** which take's waveform is open, if any — a separate question from its effects */
  const [cut, setCut] = useState<string | null>(null)
  /** which take has been asked about deleting; cleared the moment anything else happens */
  const [sure, setSure] = useState<string | null>(null)
  const [stems, setStems] = useState<Stem[]>([])
  const [bouncing, setBouncing] = useState<StemProgress | null>(null)
  /**
   * How many parts there are to bounce.
   *
   * ⚠️ A FIRST VISIT HAS NONE, and the button was offered anyway. Found by clearing the
   * built site's origin and looking at the instrument the way somebody arriving does: an empty
   * one showed ⬇ Stems, and pressing it answered "nothing to bounce". A control whose only
   * possible outcome is an apology should not be there yet.
   */
  const [parts, setParts] = useState(() => loopState().layers.length + loopState().takes.length)
  useEffect(
    () =>
      subscribeLoop(() => {
        setOnLoop(loopState().takes)
        setParts(loopState().layers.length + loopState().takes.length)
      }),
    [],
  )

  const refresh = useCallback(async () => {
    setRows(await allTakes())
    setUsed(await takenBytes())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /* how long the current recording has been going, for the button to count up */
  useEffect(() => {
    if (!going) return
    const t = window.setInterval(() => setHeld((Date.now() - going.from) / 1000), 200)
    return () => window.clearInterval(t)
  }, [going])

  /**
   * ⚠️ STOPPED ON THE WAY OUT, BOTH OF THEM. A recording left running holds the microphone open
   * with the browser's recording dot lit on a page nobody is looking at, and a playing take
   * left running sings over whatever room you went to next.
   */
  useEffect(
    () => () => {
      try {
        out.current?.src.stop()
      } catch {
        /* never started */
      }
    },
    [],
  )

  const stopPlaying = useCallback(() => {
    const on = out.current
    if (!on) return
    out.current = null
    try {
      on.src.stop()
      on.gain.disconnect()
    } catch {
      /* already finished on its own */
    }
    setPlaying(null)
  }, [])

  const play = useCallback(
    async (row: TakeRow) => {
      stopPlaying()
      resumeAudio()
      const buf = await decodeTake(row.blob)
      if (!buf) return setSay('That take will not play in this browser.')
      const ctx = sharedCtx()
      /* ⚠️ the takes' bus, so this obeys the instrument fader — and see takeBus for why
         it is not makeGain, which would play into nowhere and steal the slider on the way */
      const gain = ctx.createGain()
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(gain)
      gain.connect(takeBus())
      src.onended = () => {
        if (out.current?.src === src) stopPlaying()
      }
      out.current = { src, gain }
      setPlaying(row.id)
      /**
       * ⚠️ THE TRIM, HERE TOO. Found by reloading the page and looking at the list: this ▶
       * played the whole four seconds of a take the editor and the transport had both agreed
       * was one — three controls on one recording and one of them disagreeing, which is the
       * shape this repository keeps finding. The frames come from the same function the
       * editor and the export ask, so there is no second conversion to drift.
       */
      const { offset, frames } = trimFrames(row.trim, buf.duration, buf.sampleRate)
      if (!frames) return stopPlaying()
      src.start(0, offset / buf.sampleRate, frames / buf.sampleRate)
    },
    [stopPlaying],
  )

  const begin = useCallback(async () => {
    setSay('')
    stopPlaying()
    const r = await recordTake()
    if (!r) return setSay('No microphone, or the browser said no.')
    setHeld(0)
    setGoing(r)
  }, [stopPlaying])

  const finish = useCallback(async () => {
    const r = going
    if (!r) return
    setGoing(null)
    const got = await r.stop()
    if (!got) return setSay('Nothing came through the microphone.')
    const id = `take_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
    const kept = await putTake(id, got.blob, got.len)
    if (!kept.ok)
      setSay(
        kept.why === 'full'
          ? `Full — ${mb(TAKE_CAP)}MB of takes already. Delete one to make room.`
          : 'This browser will not keep recordings.',
      )
    await refresh()
  }, [going, refresh])

  /**
   * ⚠️ THE ARMED DELETE DISARMS ITSELF. A button that has turned into "Delete for good?" and
   * stays that way is a trap: you come back to the room a minute later, press what you think
   * is the ✕ you remember, and it goes. Six seconds is long enough to read it and decide.
   */
  useEffect(() => {
    if (!sure) return
    const t = window.setTimeout(() => setSure(null), 6000)
    return () => window.clearTimeout(t)
  }, [sure])

  /**
   * Open a sound file that already exists, as a take.
   *
   * ⚠️ THREE REFUSALS BEFORE THE EXPENSIVE STEP, in the order that makes each one cheap. Size
   * first, because it is free and the common mistake (an album, a podcast) fails here. Then
   * duration, from the container's own metadata — a check the size cannot do, because the
   * ratio between bytes on disk and megabytes of AudioBuffer is the bitrate. Only then the
   * decode, which is the one that can take the tab down and the only honest test of whether
   * this browser can actually open the format.
   *
   * ⚠️ AND EVERY REFUSAL SAYS WHICH ONE IT IS. "That didn't work" for a file that is too long,
   * a file that is too big and a file this browser has never heard of sends somebody to try
   * the same thing three times. The numbers are in the sentence.
   */
  const openFile = useCallback(
    async (file: File) => {
      setSay('')
      stopPlaying()
      const room = TAKE_CAP - (await takenBytes())
      if (file.size > room)
        return setSay(
          room <= 0
            ? `Full — ${mb(TAKE_CAP)}MB of takes already. Delete one to make room.`
            : `That file is ${mb(file.size)}MB and there is ${mb(room)}MB left. Delete a take to make room.`,
        )
      setSay('Opening…')
      const secsLong = await audioSeconds(file)
      if (secsLong === null)
        return setSay(`${file.name} is not a sound file this browser can open.`)
      if (secsLong > TAKE_MAX_SECONDS)
        return setSay(
          `That is ${Math.round(secsLong / 60)} minutes long — ${TAKE_MAX_SECONDS / 60} is the most a take can be.`,
        )
      /* the decode is both the last check and the thing that proves it will play later */
      if (!(await decodeTake(file))) return setSay(`${file.name} will not open in this browser.`)
      const id = `take_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      const kept = await putTake(id, file, secsLong)
      setSay(
        kept.ok
          ? `Opened ${file.name} — ${secs(secsLong)}. It stays in this browser.`
          : kept.why === 'full'
            ? `Full — ${mb(TAKE_CAP)}MB of takes already. Delete one to make room.`
            : 'This browser will not keep recordings.',
      )
      await refresh()
    },
    [refresh, stopPlaying],
  )

  const bin = useCallback(
    async (id: string) => {
      setSure(null)
      if (cut === id) setCut(null)
      stopPlaying()
      /* ⚠️ off the loop first. Deleting the audio under a placed take would leave the
         transport holding an id with no bytes — which plays silence rather than breaking, but
         silently, and a row you deleted still listed is worse than either. */
      liftTake(id)
      await dropTake(id)
      await refresh()
    },
    [refresh, stopPlaying, cut],
  )

  const toLoop = useCallback(
    async (row: TakeRow) => {
      const on = onLoop.some((t) => t.id === row.id)
      if (on) return liftTake(row.id)
      if (!(await placeTake(row.id))) setSay('That take will not play in this browser.')
    },
    [onLoop],
  )

  /**
   * ⚠️ IT TAKES AS LONG AS THE SONG, ONCE PER PART, and the button says so before you press
   * it rather than after. A bounce is the one thing in here that cannot be instant — see the
   * note in stems.ts about why it is a real-time bounce — and a control that goes quiet for
   * twenty seconds without having warned you reads as broken.
   */
  const doBounce = useCallback(async () => {
    setStems([])
    setSay('')
    try {
      const got = await bounceStems(setBouncing)
      setStems(got)
      if (!got.length) setSay('Nothing to bounce — record a layer or a take first.')
    } finally {
      setBouncing(null)
    }
  }, [])

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
                {playing === r.id ? '■' : '▶'} {secs(trimLen(r.trim, r.len))}
              </button>
              <span className="muted inst-takes-meta">
                {new Date(r.at).toLocaleDateString()} · {mb(r.bytes)}MB
                {/* ⚠️ SAID WHERE THE SIZE IS SAID, because the two together are the thing that
                    would otherwise look like a bug: a row reading 1 second and 0.4MB. The
                    recording is whole and only part of it is being played, and that sentence
                    belongs beside the number that gives it away. */}
                {!isWhole(r.trim, r.len) && ` · ${secs(r.len)} kept whole`}
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
              {/* ⚠️ ONLY ONCE IT IS ON THE LOOP, because that is when the chain exists and
                  when a change is audible. Six sliders on a take nobody has placed is a wall of
                  controls for something that is not playing. */}
              {onLoop.some((t) => t.id === r.id) && (
                <button
                  className={'btn btn-ghost' + (open === r.id ? ' is-on' : '')}
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                  title="How it sounds"
                >
                  ⚙
                </button>
              )}
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
                ✎{!isWhole(r.trim, r.len) && <span aria-hidden> ·</span>}
                <span className="sr-only">
                  {isWhole(r.trim, r.len) ? 'Edit this recording' : 'Edit this recording — trimmed'}
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
          onChanged={() => void refresh()}
        />
      )}
      {open !== null && onLoop.some((t) => t.id === open) && (
        <div className="inst-takes-fx">
          {KNOBS.map(([key, label, hint]) => (
            <label key={key} className="inst-takes-knob" title={hint}>
              <span className="muted">{label}</span>
              <input
                type="range"
                min={key === 'tone' ? -1 : 0}
                max={key === 'echoTime' ? 0.8 : 1}
                step={0.02}
                value={fxOf(onLoop.find((t) => t.id === open)?.fx)[key]}
                onChange={(e) => takeFx(open, { [key]: Number(e.target.value) })}
                /* ⚠️ the instrument's keyboard listens on window, and a range takes only
                   arrows and Home/End — none of which are notes. See the note in
                   InstrumentRoom about the two sliders that swallowed every key. */
              />
            </label>
          ))}
          <button
            className="btn btn-ghost"
            onClick={() => takeFx(open, PLAIN_VOICE)}
            title="Back to how it was recorded"
          >
            Flat
          </button>
          {/* ⚠️ THE CHOP SITS WITH THE REST, because from where somebody is standing it is
              one more thing you do to a take — even though underneath it is the only control
              here that is timed against the bar rather than applied to a signal. */}
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
          {(onLoop.find((t) => t.id === open)?.chop ?? NO_CHOP).shape !== 'off' && (
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
