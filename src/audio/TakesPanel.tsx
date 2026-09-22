import { useCallback, useEffect, useRef, useState } from 'react'
import { sharedCtx, resumeAudio } from './context'
import { takeBus } from './takeBus'
import { canRecord, decodeTake, recordTake, type Recording } from './recordTake'
import { allTakes, dropTake, putTake, takenBytes, TAKE_CAP, type TakeRow } from './takes'
import { liftTake, muteTake, placeTake, subscribeLoop, loopState, takeFx, takeChop } from './looper'
import { PLAIN_VOICE, type VoiceFx } from './takeFx'
import { CHOP_RATES, CHOP_SHAPES, NO_CHOP, type ChopShape } from './chop'
import { bounceStems, type Stem, type StemProgress } from './stems'

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
      src.start()
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

  const bin = useCallback(
    async (id: string) => {
      stopPlaying()
      /* ⚠️ off the loop first. Deleting the audio under a placed take would leave the
         transport holding an id with no bytes — which plays silence rather than breaking, but
         silently, and a row you deleted still listed is worse than either. */
      liftTake(id)
      await dropTake(id)
      await refresh()
    },
    [refresh, stopPlaying],
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
        {going ? `■ Stop — ${secs(held)}` : '● Record a take'}
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
      {say && <span className="muted inst-takes-say">{say}</span>}
      {!rows.length && !going && (
        <span className="muted">
          Takes are recordings — a voice, a room, anything a note cannot be. They stay in this
          browser.
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
                {playing === r.id ? '■' : '▶'} {secs(r.len)}
              </button>
              <span className="muted inst-takes-meta">
                {new Date(r.at).toLocaleDateString()} · {mb(r.bytes)}MB
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
              <button className="btn btn-ghost" onClick={() => void bin(r.id)} title="Delete">
                ✕
              </button>
            </li>
          ))}
        </ul>
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
