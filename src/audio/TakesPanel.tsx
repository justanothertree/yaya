import { useCallback, useEffect, useRef, useState } from 'react'
import { sharedCtx, resumeAudio } from './context'
import { takeBus } from './takeBus'
import { audioSeconds, canRecord, decodeTake, recordTake, type Recording } from './recordTake'
import {
  allTakes,
  dropTake,
  putTake,
  setTakeVoice,
  takenBytes,
  TAKE_CAP,
  TAKE_MAX_SECONDS,
  type PutResult,
  type TakeRow,
} from './takes'
import { liftTake, muteTake, placeTake, subscribeLoop, loopState, takeFx, takeChop } from './looper'
import { makeAudition, PLAIN_VOICE, readVoiceFx, type Audition, type VoiceFx } from './takeFx'
import { CHOP_RATES, CHOP_SHAPES, NO_CHOP, type ChopShape } from './chop'
import { bounceStems, type Stem, type StemProgress } from './stems'
import { TakeEditor } from './TakeEditor'
import { editLen, isWholeEdit, logNow, readLog } from './takeEdit'
import { editedBuffer } from './takeAudio'

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

const fxOf = (fx: Partial<VoiceFx> | undefined): VoiceFx => ({ ...PLAIN_VOICE, ...fx })

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

const mb = (n: number) => (n / (1024 * 1024)).toFixed(1)
const secs = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`

/**
 * Close a recording and keep what it caught.
 *
 * ⚠️ OUTSIDE THE COMPONENT ON PURPOSE, so the unmount path can call it. Leaving the room while
 * a recording is going has two jobs — let the microphone go, and do not throw away what was
 * sung — and neither may touch component state, because by then there is no component to set.
 * Returns null when nothing usable arrived, which is the one case with nothing to keep.
 */
async function keepWhatWasCaught(r: Recording): Promise<PutResult | null> {
  const got = await r.stop()
  if (!got) return null
  const id = `take_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  return putTake(id, got.blob, got.len)
}

export function TakesPanel() {
  const [rows, setRows] = useState<TakeRow[]>([])
  const [used, setUsed] = useState(0)
  const [going, setGoing] = useState<Recording | null>(null)
  const [held, setHeld] = useState(0)
  const [playing, setPlaying] = useState<string | null>(null)
  const [say, setSay] = useState('')
  const out = useRef<{
    id: string
    src: AudioBufferSourceNode
    gain: GainNode
    aud: Audition
  } | null>(null)
  /**
   * Each recording's own sound, as the panel last set it — seeded from the stored rows and then
   * owned here, because a write to the row is coalesced and the slider must not wait for it.
   * A PLACED take answers from the loop instead (see `soundOf`), which is where it is heard.
   */
  const [sounds, setSounds] = useState<Record<string, VoiceFx>>({})
  /**
   * ⚠️ "AS RECORDED" IS A COMPARISON, NOT A MODE: it lives in the open ⚙ panel and is switched
   * off when the panel closes. A preview that had silently stayed dry since last week would be
   * the exact confusion this control exists to remove.
   */
  const [dry, setDry] = useState(false)
  /** row writes waiting to settle, one per recording — see `keepSound` */
  const pend = useRef(new Map<string, { fx: VoiceFx; timer: number }>())
  /**
   * The live recording, where a cleanup can reach it.
   *
   * ⚠️ A REF BESIDE THE STATE, BECAUSE AN UNMOUNT CANNOT READ STATE. The teardown effect below
   * runs with `[]` deps, so it closes over the `going` of the first render — null, for ever.
   * That is how the effect came to promise it stopped "both of them" and stop one: it was
   * written against a variable it could not see move. Written at each of the three places that
   * change, rather than mirrored by an effect, so it is never a render behind.
   */
  const goingRef = useRef<Recording | null>(null)
  /** false from the moment this room is taken off the screen — see `begin` */
  const alive = useRef(true)
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
    const got = await allTakes()
    setRows(got)
    /* ⚠️ only recordings not already held: a row re-read while a write is still settling would
       otherwise put the slider back to where it was a moment ago */
    setSounds((had) => {
      const next = { ...had }
      for (const r of got) if (!(r.id in next)) next[r.id] = fxOf(readVoiceFx(r.voice))
      return next
    })
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
   * ⚠️ STOPPED ON THE WAY OUT, BOTH OF THEM — AND FROM 21 SEP TO 6 NOV IT WAS ONE. This said
   * "both" and the body stopped the playing take only, because `going` is state and an effect
   * with `[]` deps closes over the first render's copy of it. Measured 6 Nov 2026 with a real
   * MediaStream and real tracks: press 🎤, walk out of the instrument, and the track reads
   * `live` four seconds later with the room unmounted, the Stop button gone and no control
   * anywhere on the site that can release it. The recording dot stays lit until the tab
   * closes. The comment was the specification; the code was half of it.
   *
   * ⚠️ AND IT KEEPS WHAT WAS SUNG rather than dropping it. takes.ts refuses to evict a
   * recording at the storage cap because "that silently deletes something somebody sang, which
   * is the one thing a recorder must never do" — and a tap on the wrong nav link is not a
   * decision to throw a take away. The microphone is released either way; that part is the
   * bug. Keeping it is the part that follows the rule already written down.
   */
  useEffect(() => {
    /**
     * ⚠️ SET IN THE BODY, NOT ONLY CLEARED IN THE CLEANUP, because StrictMode runs the cleanup
     * once on mount in dev — and a flag that is only ever set false would then be false for
     * the life of the component, so `begin` below would drop every recording it was handed.
     * App.tsx has two notes about this same double-invoke; this is the third.
     */
    alive.current = true
    /* the same Map for the life of the panel — held here so the cleanup reads the one it wrote */
    const waiting = pend.current
    return () => {
      alive.current = false
      try {
        out.current?.src.stop()
      } catch {
        /* never started */
      }
      out.current?.aud.dispose()
      /* a sound still settling is written now rather than lost with the panel */
      for (const [id, p] of waiting) {
        window.clearTimeout(p.timer)
        void setTakeVoice(id, p.fx)
      }
      waiting.clear()
      const r = goingRef.current
      goingRef.current = null
      /* nothing can be told about this — the panel has gone — so the only report is the row */
      if (r) void keepWhatWasCaught(r)
    }
  }, [])

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
    on.aud.dispose()
    setPlaying(null)
  }, [])

  /**
   * What a take sounds like now: the loop's copy while it is placed — that is the one being heard
   * — and the recording's own otherwise.
   */
  const soundOf = useCallback(
    (id: string): VoiceFx => {
      const placed = onLoop.find((t) => t.id === id)
      return placed ? fxOf(placed.fx) : (sounds[id] ?? PLAIN_VOICE)
    },
    [onLoop, sounds],
  )

  /**
   * ⚠️ COALESCED, because the row write carries the whole recording. `setTakeVoice` is a
   * read-modify-write of a row whose blob is the take itself, and a slider dragged across its
   * range is dozens of changes a second — so a recording's sound reaches the disk 400ms after
   * it stops moving, and is flushed before anything that reads it back (placing it, leaving).
   */
  const keepSound = useCallback((id: string, fx: VoiceFx) => {
    const was = pend.current.get(id)
    if (was) window.clearTimeout(was.timer)
    const timer = window.setTimeout(() => {
      pend.current.delete(id)
      void setTakeVoice(id, fx)
    }, 400)
    pend.current.set(id, { fx, timer })
  }, [])
  const flushSound = useCallback(async (id: string) => {
    const p = pend.current.get(id)
    if (!p) return
    window.clearTimeout(p.timer)
    pend.current.delete(id)
    await setTakeVoice(id, p.fx)
  }, [])

  /** Change a take's sound — wherever it is being heard, and on the recording itself. */
  const setSound = useCallback(
    (id: string, change: Partial<VoiceFx>) => {
      const next = { ...soundOf(id), ...change }
      setSounds((had) => ({ ...had, [id]: next }))
      if (onLoop.some((t) => t.id === id)) takeFx(id, change)
      keepSound(id, next)
      if (out.current?.id === id && !dry) out.current.aud.hear(next)
    },
    [soundOf, onLoop, keepSound, dry],
  )

  /* the comparison is heard the moment it is pressed, on whatever is previewing */
  useEffect(() => {
    const on = out.current
    if (on) on.aud.hear(dry ? null : soundOf(on.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the switch, not every slider
  }, [dry])

  const play = useCallback(
    async (row: TakeRow) => {
      stopPlaying()
      resumeAudio()
      const whole = await decodeTake(row.blob)
      if (!whole) return setSay('That take will not play in this browser.')
      /**
       * ⚠️ THE EDITED AUDIO, FROM THE SAME FUNCTION THE EDITOR AND THE LOOP ASK. This used to
       * decode the take and hand the raw buffer an offset and a duration, which works for one
       * kept span and cannot express two — and the first pass shipped with this button playing
       * the whole recording while the other two played the trimmed one. There is no second
       * conversion here to drift any more: it plays exactly what `editedBuffer` builds.
       */
      const buf = editedBuffer(whole, logNow(readLog(row.log, row.trim, whole.duration)))
      const ctx = sharedCtx()
      /* ⚠️ the takes' bus, so this obeys the instrument fader — and see takeBus for why
         it is not makeGain, which would play into nowhere and steal the slider on the way */
      const gain = ctx.createGain()
      gain.connect(takeBus())
      /* ⚠️ THROUGH ITS SOUND — the loop's own chain — unless the comparison says as recorded */
      const aud = makeAudition(ctx, gain)
      aud.hear(dry ? null : soundOf(row.id))
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(aud.in)
      src.onended = () => {
        if (out.current?.src !== src) return
        out.current = null
        setPlaying(null)
        /* the echo and the room ring on after the last sample, so they are let finish */
        window.setTimeout(() => {
          aud.dispose()
          gain.disconnect()
        }, 4000)
      }
      out.current = { id: row.id, src, gain, aud }
      setPlaying(row.id)
      src.start()
    },
    [stopPlaying, dry, soundOf],
  )

  const begin = useCallback(async () => {
    setSay('')
    stopPlaying()
    const r = await recordTake()
    if (!r) return setSay('No microphone, or the browser said no.')
    /**
     * ⚠️ THE ROOM MAY HAVE GONE WHILE THE PROMPT WAS STILL UP, and then nothing can ever stop
     * this. getUserMedia does not resolve until the person answers, so the stream can arrive
     * after the unmount — and it is reachable only through the state the next two lines set,
     * which no longer exists. Measured 6 Nov 2026: left the room with the prompt pending, the
     * stream was created afterwards and read `live` with no Stop button on screen and no
     * reference anywhere that could release it. The recording dot was lit for a room that was
     * not there.
     *
     * ⚠️ DROPPED HERE, WHERE THE UNMOUNT ABOVE KEEPS. Nothing was sung into this one on
     * purpose — the question was still on screen when the person left.
     */
    if (!alive.current) return r.drop()
    setHeld(0)
    goingRef.current = r
    setGoing(r)
  }, [stopPlaying])

  const finish = useCallback(async () => {
    const r = goingRef.current
    if (!r) return
    /* ⚠️ cleared before the await, or an unmount in that window stops the same recorder twice */
    goingRef.current = null
    setGoing(null)
    const kept = await keepWhatWasCaught(r)
    if (!kept) return setSay('Nothing came through the microphone.')
    if (!kept.ok)
      setSay(
        kept.why === 'full'
          ? `Full — ${mb(TAKE_CAP)}MB of takes already. Delete one to make room.`
          : 'This browser will not keep recordings.',
      )
    await refresh()
  }, [refresh])

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
      /* the placement starts from the recording's sound, so one still settling is written first */
      await flushSound(row.id)
      if (!(await placeTake(row.id))) setSay('That take will not play in this browser.')
    },
    [onLoop, flushSound],
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
