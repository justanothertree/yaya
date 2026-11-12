import { useEffect, useRef, useState } from 'react'
import { outsideScale, type Voicing } from '../audio/chordPatterns'
import type { Layer } from '../audio/looper'
import { knob, onKnobChange, setKnob, type Knob } from '../audio/synth'

/**
 * The small parts the Instrument room's rows are built from — moved out of InstrumentRoom.tsx
 * unchanged on 11 Nov 2026, so the room reads as panels rather than as four thousand lines.
 */

/**
 * A number you type, committed once you have finished typing it — and draggable, because tempo
 * is looked for rather than known.
 *
 * ⚠️ A CONTROLLED NUMBER INPUT CANNOT CLAMP ON EVERY KEYSTROKE. BPM is clamped to 40–200, so
 * pressing "1" on the way to 120 committed 40 and put "40" in the box — the reported symptom was
 * "typing any single number key sets bpm to 40", and every tempo ended up whatever the default
 * was because changing it appeared not to work.
 *
 * It was worse than a stuck field: setBpm scales every event in the arrangement so a part keeps
 * its place against the bar lines, so each keystroke also restarted the loop and re-timed the
 * whole song. A half-typed number is not a number yet, and nothing that expensive should run on
 * one.
 *
 * So the text being typed is local and the value is committed on blur or Enter; Escape puts the
 * real one back. The arrows and the wheel still commit immediately, because those only ever
 * produce whole valid values.
 *
 * ⚠️ THE DRAG COMMITS ON RELEASE, not continuously. Sliding through 60 tempos would mean sixty
 * restarts and sixty rescales of every note in the arrangement. The number follows your hand the
 * whole way — that is the part you are steering by — and the song moves once, when you let go.
 */
export function NumField({
  value,
  min,
  max,
  onCommit,
  label,
  title,
}: {
  value: number
  min: number
  max: number
  onCommit: (n: number) => void
  label: string
  title?: string
}) {
  // null means "not being edited" — the field shows the real value
  const [draft, setDraft] = useState<string | null>(null)
  const drag = useRef<{ id: number; y: number; from: number } | null>(null)
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)))

  const commit = (raw: string) => {
    setDraft(null)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n)) onCommit(clamp(n))
  }

  return (
    <label className="inst-pick" title={title}>
      {/* ⚠️ The LABEL is the grip, not the box. Dragging on the input itself would fight text
          selection and the caret, and the one thing a number field must keep is the ability to
          select what is in it. */}
      <span
        className="muted inst-num-grip"
        onPointerDown={(e) => {
          e.preventDefault()
          drag.current = { id: e.pointerId, y: e.clientY, from: value }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || d.id !== e.pointerId) return
          // up is more, and 3px a step: fine enough to land on a number, coarse enough to throw
          setDraft(String(clamp(d.from + (d.y - e.clientY) / 3)))
        }}
        onPointerUp={(e) => {
          const d = drag.current
          if (!d || d.id !== e.pointerId) return
          drag.current = null
          /* ⚠️ NOT inside a setDraft updater. An updater has to be pure — React is free to
             run it twice — and committing from in there re-tempoed the whole arrangement while
             another component was rendering, which React says out loud. `draft` from this render
             is the number under your hand, because every move re-rendered to show it. */
          if (draft !== null) onCommit(clamp(Number(draft)))
          setDraft(null)
        }}
        onPointerCancel={() => {
          drag.current = null
          setDraft(null)
        }}
      >
        {label}
      </span>
      <input
        className="inst-num"
        type="number"
        min={min}
        max={max}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

/**
 * What a toggle does, said on the toggle — or, while it is disabled, why.
 *
 * ⚠️ ON THE BUTTON, NOT IN ITS `title`. Hold, Lead back, the bass and the fill each explained
 * themselves only in a tooltip, and a tooltip does not exist on a phone — so on the device most
 * people play this on, four controls said a word or two and nothing else, and a disabled one
 * gave no reason at all. A second line of three or four words is the smallest thing that is
 * always there; the `title` stays for the longer sentence a mouse can still reach.
 *
 * ⚠️ AND IT CHANGES WITH THE STATE rather than adding a line: the same slot says what the
 * control does or why it cannot, so a disabled control costs no extra space to explain itself.
 */
export function Why({ children }: { children: React.ReactNode }) {
  return <span className="btn-why">{children}</span>
}

/**
 * A backing row playing notes the room's scale does not have — see `outsideScale`.
 *
 * ⚠️ IT ONLY HAPPENS TO A BACKING SOMEBODY EDITED, OR ONE LAID IN ANOTHER KEY. A change of key or
 * scale re-lays every backing it can recognise, and an edited one follows a change of key note
 * for note — but a change of scale cannot be done to notes moved by hand, so they stay in their
 * old scale, and without this the Scale picker would look as if it had failed to reach the row.
 * Picking the progression again lays a fresh one in the room's scale. Chromatic has every note,
 * so it never says this.
 */
export function OffScaleRow({
  layer,
  voicing,
}: {
  layer: Layer | undefined
  voicing: Voicing | null
}) {
  return layer && voicing && outsideScale(layer.events, voicing) ? (
    <span className="muted inst-beats-why">outside this scale — pick it again to fit</span>
  ) : null
}

/**
 * ⚠️ A PRESSED BUTTON THAT MAKES NO SOUND, said beside it. Since 9 Nov 2026 a swap keeps the
 * row's mute (see addPatternLayer), so picking a new beat under a silenced kit lights the button
 * and plays nothing — which, unexplained, reads as the picker being broken. The 🔇 that undoes it
 * is on the layer's own row below; this only says where the silence comes from.
 */
export function MutedRow({ layer }: { layer: Layer | undefined }) {
  return layer?.muted ? <span className="muted inst-beats-why">muted in the layers</span> : null
}

/**
 * One effect, as a slider.
 *
 * Reads the synth rather than holding the value, so the knob and the audio can never disagree —
 * and a value restored from a previous visit shows up here without being threaded through.
 */
export function KnobRow({ k, label, hint }: { k: Knob; label: string; hint: string }) {
  const [v, setV] = useState(() => knob(k))
  // a saved rig moves the knobs without touching the slider, so follow the synth rather than
  // assume this control is the only thing that can change it
  useEffect(() => onKnobChange(() => setV(knob(k))), [k])
  return (
    <label className="appearance-slider inst-knob" title={hint}>
      <span className="muted">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={v}
        onChange={(e) => {
          const next = Number(e.target.value)
          setV(next)
          setKnob(k, next)
        }}
      />
      <span className="appearance-slider-val">{Math.round(v * 100)}</span>
    </label>
  )
}
