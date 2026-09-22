import { sharedCtx } from './context'
import {
  loopLength,
  loopState,
  muteTake,
  setMetronome,
  startLoop,
  stopLoop,
  toggleMute,
} from './looper'
import { outputTap } from './synth'
import { takeBus } from './takeBus'
import { toWav } from './wav'

/**
 * Every part of a song as its own file.
 *
 * ⚠️ BOUNCED IN REAL TIME, NOT RENDERED OFFLINE, and that is a deliberate trade. An
 * OfflineAudioContext would be faster than real time and sample-exact — and it would need the
 * synth to build its whole graph on a second context, which synth.ts does not do: it holds one
 * module-level context, one bus pool keyed to it, one shared impulse belonging to it. Teaching
 * it to render somewhere else is a refactor of the thing this repository most relies on
 * working, and the prize is that a four-bar loop exports in one second instead of five.
 *
 * ⚠️ AND WHAT YOU GET IS EXACTLY WHAT YOU HEARD, which an offline render cannot promise. The
 * tap is the live output, after the limiter, through the real bus, with the real effects — so
 * a stem cannot differ from the mix in any way the engine is capable of differing. For a thing
 * whose whole purpose is "take this into something else and it should sound the same", that is
 * worth more than the four seconds.
 *
 * ⚠️ IT IS A SOLO, NOT A TAP PER PART. Muting everything else and recording the master means a
 * stem is definitionally "the song with only this in it" — no second signal path to keep in
 * agreement with the one people listen to, which is the bug this codebase keeps paying for.
 */

export type Stem = { name: string; blob: Blob; seconds: number }

/**
 * Both halves of the output, summed.
 *
 * ⚠️ TAKES DO NOT GO THROUGH THE SYNTH. They have their own bus straight to the destination —
 * see takeBus — so tapping the instrument alone would export a song with every recording
 * missing, silently and only in the exported file.
 */
function tapAll(ctx: AudioContext): GainNode {
  const sum = ctx.createGain()
  const inst = outputTap()
  if (inst) inst.connect(sum)
  takeBus().connect(sum)
  return sum
}

/**
 * Record whatever is sounding for `seconds`.
 *
 * ScriptProcessorNode is deprecated and is still the right tool, for the reasons recordDebug
 * gives: three lines, supported everywhere, and its own latency does not matter because the
 * samples are being kept rather than played.
 */
function capture(ctx: AudioContext, from: AudioNode, seconds: number): Promise<Float32Array> {
  const node = ctx.createScriptProcessor(4096, 1, 1)
  const bits: Float32Array[] = []
  node.onaudioprocess = (e) => bits.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  from.connect(node)
  /* ⚠️ a ScriptProcessor whose output reaches nothing is never pulled, so it never runs — the
     same trap recordDebug documents. Through a silent gain, so it is driven and adds nothing. */
  const quiet = ctx.createGain()
  quiet.gain.value = 0
  node.connect(quiet).connect(ctx.destination)

  return new Promise((done) => {
    window.setTimeout(
      () => {
        try {
          from.disconnect(node)
          node.disconnect()
          quiet.disconnect()
        } catch {
          /* already torn down */
        }
        node.onaudioprocess = null
        let n = 0
        for (const b of bits) n += b.length
        const all = new Float32Array(n)
        let at = 0
        for (const b of bits) {
          all.set(b, at)
          at += b.length
        }
        done(all)
      },
      seconds * 1000 + 120,
    )
  })
}

const safe = (s: string) => s.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'part'

export type StemProgress = { doing: string; done: number; of: number }

/**
 * Bounce each layer and each take on its own.
 *
 * ⚠️ THE METRONOME IS OFF FOR ALL OF IT. A click is a thing you play along to, not a thing that
 * belongs in a file you are going to open somewhere else — and it is not part of any one stem,
 * so leaving it on would put it in every single one of them.
 *
 * ⚠️ AND EVERYTHING IS PUT BACK, including when it fails. What is muted is a thing the person
 * set up; a bounce that leaves their song soloed on the last part is a bounce that broke the
 * song to export it.
 */
export async function bounceStems(say?: (p: StemProgress) => void): Promise<Stem[]> {
  const st = loopState()
  const parts: { id: string; kind: 'layer' | 'take'; name: string }[] = [
    ...st.layers.map((l, i) => ({
      id: l.id,
      kind: 'layer' as const,
      name: `${i + 1}-${l.instrument}`,
    })),
    ...st.takes.map((t, i) => ({ id: t.id, kind: 'take' as const, name: `take-${i + 1}` })),
  ]
  if (!parts.length) return []

  const ctx = sharedCtx()
  const len = loopLength()
  const wasPlaying = st.playing
  const wasMetronome = st.metronome
  /* what was already silent stays silent afterwards — see the note above */
  const mutedLayers = new Set(st.layers.filter((l) => l.muted).map((l) => l.id))
  const mutedTakes = new Set(st.takes.filter((t) => t.muted).map((t) => t.id))

  const isMuted = (id: string, kind: 'layer' | 'take') =>
    kind === 'layer'
      ? (loopState().layers.find((l) => l.id === id)?.muted ?? false)
      : (loopState().takes.find((t) => t.id === id)?.muted ?? false)
  const setMuted = (id: string, kind: 'layer' | 'take', want: boolean) => {
    if (isMuted(id, kind) === want) return
    if (kind === 'layer') toggleMute(id)
    else muteTake(id)
  }

  const out: Stem[] = []
  try {
    stopLoop()
    if (wasMetronome) setMetronome(false)
    const sum = tapAll(ctx)

    for (let i = 0; i < parts.length; i++) {
      const me = parts[i]
      say?.({ doing: me.name, done: i, of: parts.length })
      for (const p of parts) setMuted(p.id, p.kind, p.id !== me.id)
      /* ⚠️ from the top every time, so each stem starts where the others do and they line up
         when they are dropped into anything else. A bounce that began mid-pass would export
         parts that only fit together if you knew how far in each one started. */
      stopLoop()
      startLoop()
      const samples = await capture(ctx, sum, len)
      stopLoop()
      out.push({
        name: `${safe(me.name)}.wav`,
        blob: toWav(samples, ctx.sampleRate),
        seconds: samples.length / ctx.sampleRate,
      })
    }
    say?.({ doing: '', done: parts.length, of: parts.length })
  } finally {
    for (const p of parts)
      setMuted(p.id, p.kind, p.kind === 'layer' ? mutedLayers.has(p.id) : mutedTakes.has(p.id))
    if (wasMetronome) setMetronome(true)
    stopLoop()
    if (wasPlaying) startLoop()
  }
  return out
}
