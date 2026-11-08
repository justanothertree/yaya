import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { LabStage } from './LabStage'
import { PICTURES, type PictureId } from './jigsaw'
import {
  MAX_COLOURS,
  MIN_COLOURS,
  PALETTES_KEY,
  asCss,
  asHexList,
  contrast,
  findPalette,
  fitImage,
  grade,
  hex,
  keep,
  oklab,
  parseHex,
  readKept,
  samples,
  srgb,
  toImage,
  type Kept,
  type Lab,
} from './palette'
import { createPalette, type PaletteView } from './paletteEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Source = PictureId | 'own'
type Swatch = { lab: Lab; locked: boolean; share: number }
const MODES = ['🖼 Picture', '🎨 Flat', '▦ Dithered'] as const

/** the size a picture is worked at: big enough to pick from, small enough to read back at once */
const WORK = 1024
/** every this-many'th pixel is clustered: about 50,000 of a 1024 × 768 picture */
const STEP = 16
/** an own photo larger than this is not read at all */
const PHOTO_LIMIT = 25 * 1024 * 1024

const readStore = () => {
  try {
    return readKept(localStorage.getItem(PALETTES_KEY))
  } catch {
    return []
  }
}

const pct = (x: number) =>
  x >= 0.995 ? '100%' : x < 0.005 && x > 0 ? '<1%' : `${Math.round(x * 100)}%`

export function PaletteDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [source, setSource] = useState<Source>('dusk')
  const [count, setCount] = useState(6)
  const [swatches, setSwatches] = useState<Swatch[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [mode, setMode] = useState(1)
  const [split, setSplit] = useState(0.5)
  const [kept, setKept] = useState<Kept[]>(readStore)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const engine = useRef<PaletteView | null>(null)
  const pixels = useRef<{ rgba: Uint8Array | Uint8ClampedArray; w: number; h: number } | null>(null)
  const sampled = useRef<Float32Array>(new Float32Array(0))
  const seed = useRef(1)
  const dirty = useRef(true)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const now = useRef({ mode, split, swatches, selected })
  now.current = { mode, split, swatches, selected }

  useEffect(() => {
    try {
      localStorage.setItem(PALETTES_KEY, JSON.stringify(kept))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [kept])

  /** show these colours on the GPU, with one picked out when somebody has a swatch selected */
  useEffect(() => {
    engine.current?.colours(
      swatches.map((s) => s.lab),
      selected ?? -1,
    )
    dirty.current = true
  }, [swatches, selected])
  useEffect(() => {
    dirty.current = true
  }, [mode, split])

  /** find a palette for the current picture, holding the locked colours still */
  const fit = (k = count, locked = swatches.filter((s) => s.locked).map((s) => s.lab)) => {
    const f = findPalette(sampled.current, k, seed.current, locked)
    setSwatches(f.colours.map((lab, i) => ({ lab, locked: f.locked[i], share: f.share[i] })))
    setSelected(null)
  }
  const fitNow = useRef(fit)
  fitNow.current = fit

  const reroll = () => {
    seed.current = (seed.current * 48271 + 11) % 2147483647
    fit()
  }

  const takePixels = (rgba: Uint8Array | Uint8ClampedArray, w: number, h: number) => {
    pixels.current = { rgba, w, h }
    sampled.current = samples(rgba, STEP)
  }

  /** locked colours carry over to a new picture — that is what locking is for — but when every
   *  colour is locked the new picture can change nothing, and that wants saying */
  const stuck = () =>
    swatches.length > 0 && swatches.every((s) => s.locked)
      ? ' Every colour is locked, so the palette has not changed: unlock some to fit them to this picture.'
      : ''

  const paint = async (id: PictureId) => {
    const v = engine.current
    if (!v) return
    setBusy(true)
    try {
      const rgba = await v.paint(id, WORK, Math.round((WORK * 3) / 4))
      takePixels(rgba, WORK, Math.round((WORK * 3) / 4))
      fitNow.current()
    } finally {
      setBusy(false)
    }
  }

  const choose = (s: Source) => {
    if (s === 'own') return fileRef.current?.click()
    setSource(s)
    setNote(stuck().trim() || null)
    void paint(s)
  }

  const photo = async (file: File) => {
    if (file.size > PHOTO_LIMIT)
      return setNote('That file is too big — a picture under 25 MB, please.')
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      return setNote('That file could not be read as a picture.')
    }
    const k = Math.min(1, WORK / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * k))
    const h = Math.max(1, Math.round(bitmap.height * k))
    const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
    if (!c) return setNote('This browser would not read the picture.')
    c.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const data = c.getImageData(0, 0, w, h).data
    engine.current?.photo(data, w, h)
    takePixels(data, w, h)
    setSource('own')
    fit(count)
    setNote(
      'Your picture stays on this device: it is never uploaded, and only the palettes you keep are saved.' +
        stuck(),
    )
  }

  /** a colour taken from the picture: it replaces the selected swatch, or joins as a new one */
  const pick = (lab: Lab) => {
    const locked = swatches.filter((s) => s.locked).map((s) => s.lab)
    if (selected !== null) {
      const rest = swatches.filter((s, i) => s.locked && i !== selected).map((s) => s.lab)
      fit(count, [...rest, lab])
      setNote(`Picked ${hex(srgb(lab))} — locked, and the unlocked colours refitted round it.`)
    } else if (count < MAX_COLOURS) {
      setCount(count + 1)
      fit(count + 1, [...locked, lab])
      setNote(`Added ${hex(srgb(lab))}, locked.`)
    } else
      setNote(`That is ${MAX_COLOURS} colours already: select a swatch to replace it with a pick.`)
  }

  const toggleLock = (i: number) =>
    setSwatches((was) => was.map((s, j) => (j === i ? { ...s, locked: !s.locked } : s)))

  const remove = (i: number) => {
    if (count <= MIN_COLOURS) return
    const locked = swatches.filter((s, j) => s.locked && j !== i).map((s) => s.lab)
    setCount(count - 1)
    fit(count - 1, locked)
  }

  const changeCount = (n: number) => {
    const k = Math.min(MAX_COLOURS, Math.max(MIN_COLOURS, n))
    setCount(k)
    // locked colours beyond the new count cannot all stay: the first ones do
    fit(k)
  }

  const rgbs = swatches.map((s) => srgb(s.lab))
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setNote(`Copied ${what}.`)
    } catch {
      setNote('This browser would not copy — select the text below and copy it yourself.')
    }
  }
  const keepThis = () => {
    const next = keep(kept, rgbs, Date.now())
    if (!next)
      return setNote(
        `That is ${kept.length} palettes kept, the most this keeps: remove one to keep another.`,
      )
    setKept(next)
    setNote('Kept in this browser.')
  }
  const load = (p: Kept) => {
    const labs = p.colours.map((c) => oklab(parseHex(c)!))
    setCount(labs.length)
    fit(labs.length, labs)
    setNote('Every colour of that palette is locked; unlock any to let it refit to this picture.')
  }

  // the pairs readable as text on a background, best first: what a palette is for, on a page
  const pairs = rgbs
    .flatMap((a, i) =>
      rgbs.slice(i + 1).map((b, j) => ({ a, b, i, j: i + 1 + j, r: contrast(a, b) })),
    )
    .filter((p) => p.r >= 3)
    .sort((x, y) => y.r - x.r)

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === 'r') reroll()
    else if (/^[1-3]$/.test(k)) setMode(+k - 1)
    else if (k === '+' || k === '=') changeCount(count + 1)
    else if (k === '-') changeCount(count - 1)
    else return
    e.preventDefault()
  }

  const css = asCss(rgbs)
  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Palette">
      <LabStage
        label={`${source === 'own' ? 'Your picture' : PICTURES.find((p) => p.id === source)?.name}, ${
          mode === 0 ? 'as it is' : `redrawn in ${swatches.length} colours`
        }`}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createPalette(device, context, format, canvas)
          engine.current = v
          // a new device (a switch back, or a lost one) needs the picture again
          const p = pixels.current
          if (p && source === 'own') v.photo(Uint8ClampedArray.from(p.rgba), p.w, p.h)
          else {
            const rgba = await v.paint(
              source === 'own' ? 'dusk' : source,
              WORK,
              Math.round((WORK * 3) / 4),
            )
            if (!p) {
              takePixels(rgba, WORK, Math.round((WORK * 3) / 4))
              fitNow.current()
            }
          }
          // and the colours: the effect that sends them ran for the device before this one
          v.colours(
            now.current.swatches.map((s) => s.lab),
            now.current.selected ?? -1,
          )
          dirty.current = true
          return {
            frame: () => {
              if (!dirty.current) return
              dirty.current = false
              v.frame({ mode: now.current.mode, split: now.current.mode ? now.current.split : 1 })
            },
            resize: () => {
              dirty.current = true
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const p = pixels.current
          if (!p) return
          const c = e.currentTarget
          const r = c.getBoundingClientRect()
          const k = c.width / r.width
          const f = fitImage([c.width, c.height], [p.w, p.h])
          const at = toImage(f, [p.w, p.h], [(e.clientX - r.left) * k, (e.clientY - r.top) * k])
          if (!at) return
          const o = (at[1] * p.w + at[0]) * 4
          pick(oklab([p.rgba[o] / 255, p.rgba[o + 1] / 255, p.rgba[o + 2] / 255]))
          if (!running) setRunning(true)
        }}
      />

      {live && (
        <div className="lab-controls">
          <label className="studio-pick">
            <span className="muted">Picture</span>
            <select
              value={source}
              onChange={(e) => choose(e.target.value as Source)}
              disabled={busy}
            >
              {PICTURES.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
              <option value="own">Your own picture…</option>
            </select>
          </label>
          <div className="lab-group" role="group" aria-label="How the picture is shown">
            {MODES.map((m, i) => (
              <button
                key={m}
                className="btn btn-ghost"
                aria-pressed={mode === i}
                onClick={() => setMode(i)}
              >
                {m}
              </button>
            ))}
          </div>
          {mode > 0 && (
            <label className="studio-pick">
              <span className="muted">Before | after</span>
              <input
                className="pal-split"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={split}
                onChange={(e) => setSplit(Number(e.target.value))}
              />
            </label>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void photo(f)
            }}
          />
        </div>
      )}
      {live && (
        <div className="lab-controls">
          <div className="lab-group" role="group" aria-label="How many colours">
            <button
              className="btn btn-ghost"
              aria-label="One colour fewer"
              disabled={count <= MIN_COLOURS}
              onClick={() => changeCount(count - 1)}
            >
              −
            </button>
            <span className="lab-score" aria-live="polite">
              {count} colours
            </span>
            <button
              className="btn btn-ghost"
              aria-label="One colour more"
              disabled={count >= MAX_COLOURS}
              onClick={() => changeCount(count + 1)}
            >
              +
            </button>
          </div>
          <button className="btn" onClick={reroll}>
            🎲 Re-roll the unlocked
          </button>
          <button className="btn btn-ghost" onClick={keepThis} disabled={!swatches.length}>
            ⭐ Keep this palette
          </button>
        </div>
      )}
      {live && (
        <ul className="pal-swatches" aria-label="The palette, darkest first">
          {swatches.map((s, i) => {
            const c = rgbs[i]
            const h = hex(c)
            const dark = contrast(c, [0, 0, 0]) < contrast(c, [1, 1, 1])
            return (
              <li
                key={`${h}-${i}`}
                className="pal-swatch"
                data-selected={selected === i || undefined}
              >
                <button
                  className="pal-chip"
                  style={{ background: h, color: dark ? '#fff' : '#111' }}
                  aria-pressed={selected === i}
                  aria-label={`${h}, ${pct(s.share)} of the picture${s.locked ? ', locked' : ''}. ${
                    selected === i ? 'Selected: tap the picture to replace it' : 'Select'
                  }`}
                  onClick={() => setSelected(selected === i ? null : i)}
                >
                  <span className="pal-hex">{h}</span>
                  <span className="pal-share">{pct(s.share)}</span>
                </button>
                <span className="pal-tools">
                  <button
                    className="btn btn-ghost"
                    aria-pressed={s.locked}
                    aria-label={s.locked ? `Unlock ${h}` : `Lock ${h}`}
                    onClick={() => toggleLock(i)}
                  >
                    {s.locked ? '🔒' : '🔓'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    aria-label={`Remove ${h}`}
                    disabled={count <= MIN_COLOURS}
                    onClick={() => remove(i)}
                  >
                    ✕
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <strong>{note} </strong>}
          Tap a swatch to see where it falls in the picture; then tap the picture to replace it with
          the colour there. With none selected, a tap adds that colour. 🔒 keeps a colour while 🎲
          re-rolls the rest. Keys: R re-roll, 1 2 3 views, + and − colours.
        </p>
      )}
      {live && pairs.length > 0 && (
        <details className="lab-fold">
          <summary>Readable as text — {pairs.length} pairs</summary>
          <p className="muted lab-hint">
            WCAG 2 contrast. AA is the usual bar for body text (4.5), AAA the stricter one (7);
            “large” is only for big or bold text (3).
          </p>
          <ul className="pal-pairs">
            {pairs.map((p) => (
              <li key={`${p.i}-${p.j}`} className="pal-pair">
                <span className="pal-sample" style={{ background: hex(p.b), color: hex(p.a) }}>
                  Aa
                </span>
                <span className="pal-sample" style={{ background: hex(p.a), color: hex(p.b) }}>
                  Aa
                </span>
                <span>
                  {hex(p.a)} · {hex(p.b)} — {p.r.toFixed(1)}:1{' '}
                  <strong>{grade(p.r) === 'large' ? 'large text only' : grade(p.r)}</strong>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {live && swatches.length > 0 && (
        <details className="lab-fold">
          <summary>Take it with you</summary>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              onClick={() => copy(asHexList(rgbs), 'the hex codes')}
            >
              📋 Copy hex
            </button>
            <button className="btn btn-ghost" onClick={() => copy(css, 'the CSS')}>
              📋 Copy CSS
            </button>
          </div>
          <label className="pal-out">
            <span className="sr-only">The palette as CSS</span>
            <textarea readOnly rows={Math.min(12, rgbs.length + 2)} value={css} />
          </label>
        </details>
      )}
      {live && kept.length > 0 && (
        <details className="lab-fold">
          <summary>Kept palettes — {kept.length}, in this browser only</summary>
          <ul className="pal-kept">
            {kept.map((p) => (
              <li key={p.at} className="pal-kept-row">
                <button
                  className="pal-strip"
                  aria-label={`Use ${p.colours.join(' ')}`}
                  onClick={() => load(p)}
                >
                  {p.colours.map((c, i) => (
                    <span key={i} style={{ background: c }} />
                  ))}
                </button>
                <button
                  className="btn btn-ghost"
                  aria-label={`Remove the kept palette ${p.colours.join(' ')}`}
                  onClick={() => setKept((was) => was.filter((q) => q.at !== p.at))}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
