import { useCallback, useEffect, useRef, useState } from 'react'
import { sharedCtx, resumeAudio } from './context'
import { takeBus } from './takeBus'
import { audioSeconds, decodeTake, recordTake, type Recording } from './recordTake'
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
import { liftTake, placeTake, subscribeLoop, loopState, takeFx } from './looper'
import { makeAudition, PLAIN_VOICE, readVoiceFx, type Audition, type VoiceFx } from './takeFx'
import { bounceStems, type Stem, type StemProgress } from './stems'
import { logNow, readLog } from './takeEdit'
import { editedBuffer } from './takeAudio'

const fxOf = (fx: Partial<VoiceFx> | undefined): VoiceFx => ({ ...PLAIN_VOICE, ...fx })

export const mb = (n: number) => (n / (1024 * 1024)).toFixed(1)
export const secs = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`

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

/**
 * The takes: what is kept, what is playing, the recording in progress and every action on them —
 * moved out of TakesPanel.tsx unchanged on 12 Nov 2026, so the panel is the view and this is the
 * state. The calls are the same calls in the same order, so nothing about when they run changed.
 */
export function useTakes() {
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

  return {
    rows,
    used,
    going,
    setGoing,
    held,
    playing,
    say,
    sounds,
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
  }
}
