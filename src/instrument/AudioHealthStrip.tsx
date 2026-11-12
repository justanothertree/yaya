import { useEffect, useState } from 'react'
import {
  healthOn,
  labOn,
  readHealth,
  resetHealth,
  scanCoverage,
  startHealth,
  stopHealth,
  type AudioHealth,
} from '../audio/audioHealth'
import { sharedCtx } from '../audio/context'
import {
  captureSamples,
  downloadSamples,
  findTicks,
  plainToneOff,
  plainToneOn,
  pooledToneOff,
  pooledToneOn,
  recordOutput,
} from '../audio/recordDebug'
import { noteOff, noteOn, outputTap } from '../audio/synth'

/**
 * The audio health strip, when localStorage.audio_debug is '1'.
 *
 * ⚠️ It reports the TWO THINGS THAT SOUND THE SAME AND ARE NOT. Clipping shows as `clip` rising
 * with peak pinned near 1; dropouts show as `late` rising with peak nowhere near it. Both were
 * zero on the machine this was written on while the fault was audible on a phone, which is
 * precisely why it has to run on the phone.
 */
export function AudioHealthStrip() {
  const [rec, setRec] = useState(false)
  const [ticks, setTicks] = useState('')
  const lab = labOn()
  const bufMs = (() => {
    try {
      const v = localStorage.getItem('audio_latency')
      return v === null ? 'auto' : String(Math.round(Number(v) * 1000))
    } catch {
      return 'auto'
    }
  })()
  const [h, setH] = useState<AudioHealth | null>(null)
  useEffect(() => {
    if (!healthOn()) return
    let alive = true
    /* ⚠️ a console handle on the REAL graph, behind the same debug flag. Every offline
       reconstruction of this instrument comes back clean, so the reconstruction is the wrong
       tool — this drives the actual code path and hands back the actual samples. */
    if (labOn())
      (window as unknown as Record<string, unknown>).__audio = {
        noteOn,
        noteOff,
        outputTap,
        captureSamples,
      }
    void startHealth().then((ok) => {
      if (!ok || !alive) return
      setH(readHealth())
    })
    const t = window.setInterval(() => {
      if (alive) setH(readHealth())
    }, 1000)
    return () => {
      alive = false
      clearInterval(t)
      stopHealth()
    }
  }, [])
  if (!h) return null
  const bad = h.worst !== 'clean'
  /* the real rate, so the tooltip's percentage is this machine's rather than 48kHz's */
  const scanPct = Math.round(scanCoverage(h.sampleRate) * 100)
  /**
   * ⚠️ THREE STATES, NOT TWO, because "not clean" covers two very different things.
   *
   * Measuring stays on for everybody — a counter per audio quantum and one scan a second, and it
   * is how the crackle was found rather than guessed at. What was wrong was SHOWING it always:
   * "clean · late 0ms · clip 0 · squash 0dB · in 0 · out 0" and a reset button as the second
   * thing in a room whose whole goal is that somebody who does not care about software can open
   * it and work it out.
   *
   * But hiding everything except faults would undo a deliberate decision: LIMITING was made
   * visible precisely because a limiter leaning on the mix is what produced a year of "it
   * crackles" while the strip said everything was fine. So it still shows — in words, quietly.
   *
   * ⚠️ AND IT IS NOT A FAULT. Measured: one plain drum beat alone latches about -14dB of
   * reduction, because a kick transient is exactly what a fast limiter grabs. Painting that red
   * next to numbers nobody can act on would teach everybody to ignore the strip, which costs more
   * than showing it ever bought. Clipping and dropouts keep the red technical readout; being
   * leant on gets one sentence saying what to do about it.
   */
  if (!bad && !lab) return null
  const onlyLoud = !lab && h.worst === 'LIMITING'
  if (onlyLoud)
    return (
      <p className="muted inst-health-soft">
        The mix is loud enough to be squashed — pull a layer&rsquo;s volume down if it sounds flat.
      </p>
    )
  return (
    <div className="inst-health" style={bad ? { color: '#f46b6b' } : undefined}>
      <div
        title={
          /* ⚠️ THE COVERAGE FIGURE IS ASKED FOR, NOT TYPED. It used to say 4.3% beside a
             cadence defined in audioHealth, and when the scan moved onto the 20Hz sampler the
             sentence would have gone on claiming the old number — the exact rot CLAUDE.md
             describes, in the file that would never have contradicted it. */
          `in, squash, clip and out are all latched from the same 20Hz sampler, which sees ${scanPct}% ` +
          'of the audio. A zero still means "none seen in the windows looked at", not "none ' +
          'happened" — but it used to mean 4.3% of them. clip counts samples PAST full scale, ' +
          'and out is the mix as it leaves the limiter, before your volume: at 0.7 a peak of ' +
          '1.10 reaches the speakers at 0.77.'
        }
      >
        <strong>{h.worst === 'clean' ? 'clean' : h.worst}</strong> · late {h.driftMs}ms · clip ~
        {h.clippedTotal} · squash {h.reductionWorst}dB · in {h.preMax} · out ~{h.peakMax}
        <button
          className="btn"
          onClick={() => {
            resetHealth()
            setH(readHealth())
          }}
          style={{ marginLeft: '0.4rem', padding: '0 0.35rem', fontSize: '0.7rem' }}
        >
          reset
        </button>
        {/* the workbench from the crackle investigation — off unless audio_lab is set */}
        {lab && (
          <>
            {/**
             * ⚠️ THE BUFFER, AS A CONTROL RATHER THAN A CONSOLE INCANTATION. A pop that survives every
             * fix to the signal and is absent from a recording of the rendered output is the shape of
             * the audio thread running late — the case every DAW answers by raising the buffer. It
             * needs a REAL reload to take effect, which is the trap: setting the value and changing
             * the hash leaves the old AudioContext alive and looks like the setting does nothing.
             * Verified here: default is 481 frames, and 50ms gives 2405.
             */}
            <select
              className="btn"
              value={bufMs}
              onChange={(e) => {
                try {
                  if (e.target.value === 'auto') localStorage.removeItem('audio_latency')
                  else localStorage.setItem('audio_latency', String(Number(e.target.value) / 1000))
                } catch {
                  /* private mode: nothing to remember it in */
                }
                location.reload()
              }}
              style={{ marginLeft: '0.3rem', fontSize: '0.7rem' }}
              title="Audio buffer. Bigger is safer against dropouts and slower to respond."
              aria-label="Audio buffer size"
            >
              <option value="auto">buffer: auto</option>
              <option value="20">buffer: 20ms</option>
              <option value="50">buffer: 50ms</option>
              <option value="100">buffer: 100ms</option>
            </select>
            {/**
             * ⚠️ RECORDS WHILE YOU PLAY, THEN SAYS WHERE THE TICKS WERE. Script-driven notes are
             * metronome-regular and caught the artefact twice in a hundred presses; a person playing
             * hits it constantly. So this goes where the hands are — play through it, and it reports
             * how many single-sample edges it found and when, then hands over the WAV.
             */}
            <button
              className="btn"
              disabled={rec}
              onClick={() => {
                const tap = outputTap()
                if (!tap) return
                setRec(true)
                setTicks('listening…')
                void captureSamples(tap, 15)
                  .then((x) => {
                    const found = findTicks(x, sharedCtx().sampleRate)
                    setTicks(
                      found.length
                        ? `${found.length} tick${found.length === 1 ? '' : 's'}, worst step ` +
                            `${Math.max(...found.map((t) => t.peakStep)).toFixed(3)}: ` +
                            found
                              .slice(0, 6)
                              .map((t) => `${t.atMs}ms ×${t.ratio}`)
                              .join(', ')
                        : 'no ticks found in 15s',
                    )
                    /* ⚠️ hand the recording over whenever it caught something. A count says a fault
                     exists; only the samples say what it is, and the person who can provoke it is
                     not the person who can read it. */
                    if (found.length) downloadSamples(x, `ticks-${found.length}.wav`)
                  })
                  .finally(() => setRec(false))
              }}
              style={{ marginLeft: '0.3rem', padding: '0 0.35rem', fontSize: '0.7rem' }}
              title="Record 15s while you play, then report every click it can find"
            >
              catch pop 15s
            </button>
            {/**
             * ⚠️ THE BISECTION. Hammer this on the browser where it is worst. It is one oscillator
             * and one gain straight to the destination — none of the instrument's chain — so if it
             * clicks, nothing we wrote is the cause; if it is clean, the cause is ours and can be
             * found by adding the chain back a piece at a time.
             */}
            <button
              className="btn"
              onPointerDown={() => plainToneOn(440)}
              onPointerUp={() => plainToneOff()}
              onPointerLeave={() => plainToneOff()}
              style={{ marginLeft: '0.3rem', padding: '0 0.35rem', fontSize: '0.7rem' }}
              title="A bare sine straight to the speakers — no filter, limiter, reverb or bus. Hammer it."
            >
              plain tone
            </button>
            {/**
             * ⚠️ THE SAME TONE WITH NO NODE CHURN. The plain tone still clicks, so nothing in its
             * signal is at fault — what is left is that it builds and tears down two nodes on every
             * press. Here the oscillator is made once and never stopped, and a press only moves a
             * gain. Clean here but not there means the cause is graph mutation, and the fix is a
             * voice pool for the whole instrument.
             */}
            <button
              className="btn"
              onPointerDown={() => pooledToneOn(440)}
              onPointerUp={() => pooledToneOff()}
              onPointerLeave={() => pooledToneOff()}
              style={{ marginLeft: '0.3rem', padding: '0 0.35rem', fontSize: '0.7rem' }}
              title="Same bare tone, but nothing is created or destroyed per press. Hammer it."
            >
              pooled tone
            </button>
            {ticks && <span style={{ marginLeft: '0.4rem' }}>{ticks}</span>}
            {/* five seconds of exactly what came out, as a WAV — for when every number says the
              signal is clean and it audibly is not */}
            <button
              className="btn"
              disabled={rec}
              onClick={() => {
                const tap = outputTap()
                if (!tap) return
                setRec(true)
                void recordOutput(tap, 5).finally(() => setRec(false))
              }}
              style={{ marginLeft: '0.3rem', padding: '0 0.35rem', fontSize: '0.7rem' }}
              title="Record 5s of the instrument output to a WAV file"
            >
              {rec ? 'recording…' : 'rec 5s'}
            </button>
          </>
        )}
      </div>
      <div className="muted">
        {/* ⚠️ WHICH BUILD THIS IS. Several reports in this investigation may have been made
            against a build that predated the fix being discussed, and there was no way to tell
            from either side — which turns a real result into an ambiguous one. The deploy already
            stamps the commit; it just was not shown anywhere. */}
        {/* ⚠️ `dropped` IS GONE FROM HERE, because it can only ever be zero. It comes from the
            worklet counter that compares currentTime against itself — the verdict above already
            refuses to consult it for exactly that reason ("a verdict from a dead counter"), and
            yet it was still being printed as "late 0", beside a REAL late figure in milliseconds
            on the line above. Two numbers with one name, one of which cannot move. A meter that
            always reads zero is not reassurance, it is a broken gauge that looks like one. */}
        build {import.meta.env.VITE_APP_VERSION || 'dev'} · buffer {h.bufferMs}ms · now: gaps{' '}
        {h.gaps} peak ~{h.peak} squash {h.reduction}dB · voices {h.voices} · notes {h.on}/{h.off}
      </div>
    </div>
  )
}
