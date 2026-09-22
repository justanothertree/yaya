import { useCallback, useEffect, useRef, useState } from 'react'
import { sharedCtx, resumeAudio } from './context'
import { takeBus } from './takeBus'
import { canRecord, decodeTake, recordTake, type Recording } from './recordTake'
import { allTakes, dropTake, putTake, takenBytes, TAKE_CAP, type TakeRow } from './takes'
import { liftTake, muteTake, placeTake, subscribeLoop, loopState } from './looper'

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
  useEffect(() => subscribeLoop(() => setOnLoop(loopState().takes)), [])

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
              <button className="btn btn-ghost" onClick={() => void bin(r.id)} title="Delete">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <span className="muted inst-takes-meta">
          {mb(used)} of {mb(TAKE_CAP)}MB
        </span>
      )}
    </div>
  )
}
