import { useEffect, useRef, useState } from 'react'
import { sharedCtx } from './context'
import { harmonyAbove, splitLyrics } from './lyrics'
import {
  addLayers,
  loopLength,
  loopOrigin,
  loopState,
  startLoop,
  type Layer,
  type LoopEvent,
} from './looper'
import { toNotes } from './noteEdit'
import { fitSyllables } from './pocket'
import { PRESETS, singInto, type PresetId } from './singer'
import { fxSnapshot, partInput, type Fx } from './synth'

/**
 * 🎤 Sing — the prototype from docs/2026-11-10-sung-lyrics-plan.md, phase 0.
 *
 * ⚠️ TO BE HEARD, NOT KEPT. It sings typed lyrics over one layer's notes, fitted to the beat by
 * pocket.ts, with `_` holding the last one across the next — and nothing here is saved: the lyric lives in
 * this panel and goes when the page does. Whether this is the sound Evan means decides whether
 * phase 1 (lyrics stored on the notes themselves) gets built at all.
 *
 * ⚠️ IT COMES IN AT THE TOP OF THE LOOP, so the words land on the same beats as the backing. With
 * the loop stopped it starts the loop and sings from its first beat.
 */
const SAMPLE = 'glit-ter in the dark _ to-night'
/* scale steps of the sample melody, one per syllable: up to the fifth and back down */
const SAMPLE_STEPS = [0, 2, 4, 4, 5, 4, 2, 0]
/* the voice brings its own vibrato, glide and breath, so its part bus adds only a little room */
const DRY: Fx = { echo: 0, echoTime: 0.26, space: 0.25, vibrato: 0, glide: 0, tone: 0.5 }
const PRESET_IDS = Object.keys(PRESETS) as PresetId[]
/* a doubled voice is part of what makes the breathy and glitchy sounds; clean starts single */
const DOUBLED: Record<PresetId, boolean> = { clean: false, breathy: true, glitchy: true }
const ABOUT: Record<PresetId, string> = {
  clean: 'A plain voice with a light vibrato on long notes.',
  breathy: 'Soft and airy, with a slower, wider vibrato.',
  glitchy: 'Hard tune, a light stutter and a little grit.',
}

export function SingPanel({
  layers,
  degrees,
  root,
}: {
  layers: readonly Layer[]
  degrees: readonly number[]
  root: number
}) {
  const [open, setOpen] = useState(false)
  const [lyric, setLyric] = useState(SAMPLE)
  const [layerId, setLayerId] = useState<string | null>(null)
  const [preset, setPreset] = useState<PresetId>('clean')
  const [double, setDouble] = useState(DOUBLED.clean)
  const [harmony, setHarmony] = useState(false)
  const [singing, setSinging] = useState(false)
  const stop = useRef<(() => void) | null>(null)
  const timer = useRef<number | null>(null)

  const stopNow = () => {
    stop.current?.()
    stop.current = null
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setSinging(false)
  }
  /* leaving the room silences the voice — a line scheduled into the future would otherwise sing on */
  useEffect(() => () => stop.current?.(), [])

  const candidates = layers.filter((l) => l.instrument !== 'drums' && l.events.some((e) => e.on))
  const layer =
    candidates.find((l) => l.id === layerId) ?? candidates[candidates.length - 1] ?? null
  const notes = layer ? toNotes(layer.events, layer.len) : []
  const { sung, spare } = fitSyllables(notes, splitLyrics(lyric), {
    beat: 60 / loopState().bpm,
    snap: loopState().quantize,
    len: layer?.len,
  })

  const sing = () => {
    stopNow()
    if (!layer || !sung.length) return
    const was = loopState().playing
    if (!was) startLoop()
    const c = sharedCtx()
    const lap = loopLength()
    const origin = loopOrigin()
    /* the next top of the loop — or this one, if the loop has only just been started */
    const soon = c.currentTime + 0.1
    const start = !was ? origin : origin + Math.max(0, Math.ceil((soon - origin) / lap)) * lap
    stop.current = singInto(c, partInput('sing', DRY, 0.9), sung, start, {
      preset,
      double,
      harmony: harmony ? (m) => harmonyAbove(m, degrees, root) : null,
      beat: 60 / loopState().bpm,
      seed: Math.floor(Math.random() * 1e9),
      /* a line that waits for the top of the loop has time for its first consonant before it */
      lead: Math.max(0, start - (c.currentTime + 0.03)),
    })
    setSinging(true)
    timer.current = window.setTimeout(
      () => {
        stop.current = null
        timer.current = null
        setSinging(false)
      },
      (start + layer.len - c.currentTime) * 1000 + 300,
    )
  }

  /** a short melody in the room's key, as a muted layer, so there is something to sing at once */
  const sample = () => {
    const lap = loopLength()
    const slot = lap / SAMPLE_STEPS.length
    const base = 72 + (root > 5 ? root - 12 : root)
    const events: LoopEvent[] = []
    SAMPLE_STEPS.forEach((step, i) => {
      const L = degrees.length
      const midi = base + Math.floor(step / L) * 12 + degrees[step % L]
      events.push({ t: i * slot, midi, on: true })
      events.push({ t: i * slot + slot * 0.9, midi, on: false })
    })
    const id = `${Date.now()}-sing-line`
    addLayers([
      { id, instrument: 'keys', muted: true, len: lap, fx: fxSnapshot(), events, gain: 0.8 },
    ])
    setLayerId(id)
    setLyric(SAMPLE)
  }

  const choose = (id: PresetId) => {
    setPreset(id)
    setDouble(DOUBLED[id])
  }

  return (
    <div className="inst-sing card">
      <button
        className={'btn' + (open ? ' is-on' : ' btn-ghost')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        🎤 Sing lyrics <span className="muted">· prototype</span>{' '}
        <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          <p className="muted inst-note">
            A synthesised voice sings your words on a layer&rsquo;s notes, on the beat. Split words
            with <kbd>-</kbd>, hold a syllable across a note with <kbd>_</kbd>. Nothing is saved
            yet.
          </p>
          <div className="inst-row">
            <label className="inst-pick">
              <span className="muted">Notes of</span>
              <select
                value={layer?.id ?? ''}
                onChange={(e) => setLayerId(e.target.value || null)}
                disabled={!candidates.length}
              >
                {!candidates.length && <option value="">no layer yet</option>}
                {candidates.map((l) => (
                  <option key={l.id} value={l.id}>
                    {`${layers.indexOf(l) + 1}. ${l.instrument}${l.muted ? ' (muted)' : ''}`}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-ghost" onClick={sample}>
              ✎ Try a sample line
            </button>
          </div>
          <textarea
            className="inst-sing-lyric"
            value={lyric}
            onChange={(e) => setLyric(e.target.value)}
            rows={2}
            aria-label="Lyrics"
            placeholder={SAMPLE}
          />
          <p className="muted inst-note" aria-live="polite">
            {layer
              ? `${sung.map((s) => (s.hold ? '~' : s.text)).join(' · ')}${
                  spare ? ` — ${spare} left over, add notes or shorten the words` : ''
                }`
              : 'Record or draw a melody first, or try the sample line.'}
          </p>
          <div className="inst-beats-row">
            <span className="muted inst-beats-genre">Voice</span>
            {PRESET_IDS.map((id) => (
              <button
                key={id}
                className={'btn' + (preset === id ? '' : ' btn-ghost')}
                aria-pressed={preset === id}
                onClick={() => choose(id)}
              >
                {PRESETS[id].name}
              </button>
            ))}
          </div>
          <div className="inst-beats-row">
            <span className="muted inst-beats-genre">Add</span>
            <button
              className={'btn' + (double ? '' : ' btn-ghost')}
              aria-pressed={double}
              onClick={() => setDouble((v) => !v)}
            >
              Double
            </button>
            <button
              className={'btn' + (harmony ? '' : ' btn-ghost')}
              aria-pressed={harmony}
              onClick={() => setHarmony((v) => !v)}
            >
              Harmony
            </button>
          </div>
          <p className="muted inst-note">
            {ABOUT[preset]}
            {double ? ' Double sings it twice, slightly apart.' : ''}
            {harmony ? ' Harmony adds a third above.' : ''}
          </p>
          <div className="inst-row">
            <button
              className={'btn' + (singing ? ' is-on' : '')}
              onClick={singing ? stopNow : sing}
              disabled={!singing && (!layer || !sung.length)}
            >
              {singing ? '■ Stop singing' : '▶ Sing'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
