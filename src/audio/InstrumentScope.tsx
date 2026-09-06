// A look at what you are actually playing, in the room where you play it.
//
// ⚠️ THIS IS NOT THE VISUALISER, AND THAT IS THE POINT. The visualiser's modes — aurora, swarm,
// weave — are decorative: they move to music beautifully and tell you nothing about it. Sitting
// at a keyboard you want a different question answered. What did that patch just do? Why does
// Steel Pan sound like that and Rhodes not? Did the note stop when I let go? Those are answered
// by a scope and a spectrum, not by a nice pattern.
//
// It also sidesteps a real cost. A visual mode does not consume audio, it consumes a `Frame` —
// bins, waveform, beat features, ink read out of CSS custom properties, pointer position, and a
// rasterised copy of your drawing. Assembling one is ~600 lines inside AudioVisualizer.tsx,
// most of which is not drawing at all: the frame governor added when aurora lagged, art-sprite
// baking, DPR and resize handling. Reusing a mode here means inheriting all of that or unpicking
// it in the most performance-sensitive file on the site. This needs none of it.
//
//
// ⚠️ WHAT IT HONESTLY CANNOT SHOW: WHICH NOTE.
//
// The shared analyser runs a 2048-point FFT, so at 48kHz each bin is 23.4Hz. Measured, a
// semitone is 3.9Hz at C2, 7.8Hz at C3 and 15.6Hz at C4 — all narrower than a single bin. C5 is
// the first octave a bin can separate at all. So for most of a keyboard one bin straddles
// several notes, and labelling them would be the classic way a "useful" readout becomes a
// confident liar. The axis is marked in OCTAVES, which are true at every pitch, and note-level
// detail is left to your ears.
//
// ⚠️ Expect a visible staircase at the bottom. At 65Hz one bin is ~70px wide on a full-width
// canvas and at 5kHz it is barely one, which is lopsided but truthful — smoothing it would draw
// a confident curve through data that has none.
//
// The obvious fix — a bigger FFT — is a trap worth naming. The visualiser reads this same tap
// into a fixed 2048-length buffer and readSpectrum refuses a short read, so raising fftSize
// would not sharpen this; it would make the instrument disappear from the visualiser instead.
import { useEffect, useRef, useState } from 'react'
import { readSpectrum, readWaveform, subscribeTaps, tapFormat } from './audioTap'

/** C2…C7. Octaves, because octaves are true at every resolution. */
const MARKS: Array<[number, string]> = [
  [65.41, 'C2'],
  [130.81, 'C3'],
  [261.63, 'C4'],
  [523.25, 'C5'],
  [1046.5, 'C6'],
  [2093, 'C7'],
]
/** the window worth drawing: below this is rumble, above it is air */
const LO = 50
const HI = 6000

export function InstrumentScope() {
  const cvRef = useRef<HTMLCanvasElement | null>(null)
  /* whether the synth has built its graph yet — before the first keypress there is no analyser
     and nothing to say, and an empty box that never explains itself is worse than a sentence */
  const [live, setLive] = useState(() => !!tapFormat('instrument'))

  useEffect(() => subscribeTaps(() => setLive(!!tapFormat('instrument'))), [])

  useEffect(() => {
    const cv = cvRef.current
    if (!cv || !live) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    /* ⚠️ allocated ONCE. A Uint8Array per frame is the classic way a scope becomes a
       garbage-collection stutter, and the pauses land exactly while something is moving. */
    const spec = new Uint8Array(2048)
    const wave = new Uint8Array(2048)
    let raf = 0
    let w = 0
    let h = 0

    /** log placement, so an octave is the same distance everywhere on the axis */
    const xOf = (hz: number) => (Math.log(hz / LO) / Math.log(HI / LO)) * w

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const r = cv.getBoundingClientRect()
      const nw = Math.max(1, Math.round(r.width * dpr))
      const nh = Math.max(1, Math.round(r.height * dpr))
      if (nw === cv.width && nh === cv.height) return
      cv.width = nw
      cv.height = nh
      w = nw
      h = nh
    }

    const paint = () => {
      size()
      const fmt = tapFormat('instrument')
      const gotSpec = fmt ? readSpectrum('instrument', spec) : false
      const gotWave = readWaveform('instrument', wave)

      const css = getComputedStyle(cv)
      const accent = css.getPropertyValue('--accent').trim() || '#7c6af7'
      const text = css.getPropertyValue('--text').trim() || '#888'

      ctx.clearRect(0, 0, w, h)

      // ── octave marks, behind everything ──
      ctx.strokeStyle = text
      ctx.fillStyle = text
      ctx.globalAlpha = 0.18
      ctx.lineWidth = 1
      ctx.font = `${Math.round(h * 0.13)}px system-ui, sans-serif`
      for (const [hz, label] of MARKS) {
        if (hz < LO || hz > HI) continue
        const x = Math.round(xOf(hz)) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
        ctx.fillText(label, x + 3, h - 3)
      }
      ctx.globalAlpha = 1

      // ── the spectrum: where the energy is, and what shape the harmonics make ──
      if (gotSpec && fmt) {
        const perBin = fmt.rate / fmt.fftSize
        ctx.beginPath()
        ctx.moveTo(0, h)
        /* ⚠️ walked in BINS, not in pixels. Stepping across x and sampling back into the bins
           misses narrow peaks entirely at the low end, where several pixels share one bin and a
           single loud partial can fall between the samples — the peak you most want to see. */
        for (let i = 1; i < fmt.bins; i++) {
          const hz = i * perBin
          if (hz < LO) continue
          if (hz > HI) break
          const x = xOf(hz)
          const y = h - (spec[i] / 255) * h
          ctx.lineTo(x, y)
        }
        ctx.lineTo(w, h)
        ctx.closePath()
        ctx.fillStyle = accent
        ctx.globalAlpha = 0.35
        ctx.fill()
        ctx.globalAlpha = 1
      }

      // ── the waveform: attack, decay, and whether the note actually let go ──
      if (gotWave) {
        const n = Math.min(wave.length, 1024)
        ctx.beginPath()
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * w
          const y = h / 2 + ((wave[i] - 128) / 128) * (h * 0.42)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = accent
        ctx.lineWidth = Math.max(1, h * 0.012)
        ctx.globalAlpha = 0.95
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      if (!gotSpec && !gotWave) {
        ctx.fillStyle = text
        ctx.globalAlpha = 0.4
        ctx.font = `${Math.round(h * 0.16)}px system-ui, sans-serif`
        ctx.fillText('play something', 10, h / 2)
        ctx.globalAlpha = 1
      }

      raf = requestAnimationFrame(paint)
    }

    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [live])

  return (
    <div className="inst-scope">
      <canvas ref={cvRef} aria-hidden />
      <span className="muted inst-scope-note">
        {live
          ? 'Your sound: harmonics across the octaves, and the wave itself.'
          : 'Play a note and this shows what it looks like.'}
      </span>
    </div>
  )
}
