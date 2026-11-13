import { useMemo, useRef, useState } from 'react'
import { LabStage } from './LabStage'
import { PICTURES, type PictureId } from './jigsaw'
import { fitImage, toImage } from './palette'
import {
  KINDS,
  VISION_KEY,
  apartness,
  contrast,
  deltaE,
  hex,
  parseHex,
  readSaved,
  seen,
  simulation,
  type V3,
} from './vision'
import { createVision, type VisionView } from './visionEngine'
import { useKept } from './kept'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Source = 'chart' | PictureId | 'own'
/** the working size of a picture: plenty for judging colour, small enough to keep in memory */
const WORK = 1024
const PHOTO_LIMIT = 25 * 1024 * 1024

/**
 * The test card: what colour-blind readers report trouble with most — lines and a legend in a common
 * chart palette, a red-and-green status board, a traffic light, a spectrum. Drawn with the 2D canvas
 * on the CPU, so it is the same on every GPU.
 */
function drawChart(): { data: Uint8ClampedArray<ArrayBuffer>; w: number; h: number } | null {
  const w = 960
  const h = 720
  const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
  if (!c) return null
  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, w, h)
  const series = [
    ['#d62728', 'Red'],
    ['#2ca02c', 'Green'],
    ['#ff7f0e', 'Orange'],
    ['#1f77b4', 'Blue'],
    ['#9467bd', 'Purple'],
  ] as const
  c.font = 'bold 26px sans-serif'
  c.fillStyle = '#222'
  c.fillText('A chart, a status board, a light, a spectrum', 30, 44)
  // lines
  c.strokeStyle = '#ccc'
  c.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    c.beginPath()
    c.moveTo(40, 80 + i * 55)
    c.lineTo(600, 80 + i * 55)
    c.stroke()
  }
  series.forEach(([col], k) => {
    c.strokeStyle = col
    c.lineWidth = 5
    c.beginPath()
    for (let x = 0; x <= 20; x++) {
      const y = 190 + 70 * Math.sin(x * 0.45 + k * 1.3) - k * 12
      if (x === 0) c.moveTo(40 + x * 28, y)
      else c.lineTo(40 + x * 28, y)
    }
    c.stroke()
  })
  // legend
  c.font = '22px sans-serif'
  series.forEach(([col, name], k) => {
    c.fillStyle = col
    c.fillRect(640, 82 + k * 42, 28, 28)
    c.fillStyle = '#222'
    c.fillText(name, 680, 104 + k * 42)
  })
  // status board: good / bad by colour alone
  const states = [
    '#2e9e44',
    '#d93025',
    '#2e9e44',
    '#2e9e44',
    '#d93025',
    '#f2a900',
    '#2e9e44',
    '#d93025',
  ]
  states.forEach((col, i) => {
    c.fillStyle = col
    c.beginPath()
    c.arc(70 + i * 70, 380, 26, 0, Math.PI * 2)
    c.fill()
  })
  // a traffic light
  c.fillStyle = '#333'
  c.fillRect(690, 300, 90, 250)
  ;['#e53935', '#fdd835', '#43a047'].forEach((col, i) => {
    c.fillStyle = col
    c.beginPath()
    c.arc(735, 345 + i * 80, 30, 0, Math.PI * 2)
    c.fill()
  })
  // a spectrum
  for (let x = 0; x < 560; x++) {
    c.fillStyle = `hsl(${(x / 560) * 300}, 100%, 50%)`
    c.fillRect(40 + x, 460, 1, 70)
  }
  // a green-on-red label, the classic unreadable one
  c.fillStyle = '#d93025'
  c.fillRect(40, 570, 560, 110)
  c.fillStyle = '#2e9e44'
  c.font = 'bold 44px sans-serif'
  c.fillText('Green text on red', 70, 640)
  const data = c.getImageData(0, 0, w, h).data
  return { data, w, h }
}

export function VisionDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [saved, setSaved] = useKept(VISION_KEY, readSaved)
  const [source, setSource] = useState<Source>('chart')
  const [split, setSplit] = useState(0.5)
  const [next, setNext] = useState<'a' | 'b'>('a')
  const [marks, setMarks] = useState<[[number, number] | null, [number, number] | null]>([
    null,
    null,
  ])
  const [note, setNote] = useState<string | null>(null)
  const engine = useRef<VisionView | null>(null)
  const pixels = useRef<{ data: Uint8Array | Uint8ClampedArray; w: number; h: number } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const { kind, severity } = saved
  const a = parseHex(saved.a) ?? [1, 0, 0]
  const b = parseHex(saved.b) ?? [0, 1, 0]

  const matrix = useMemo(() => simulation(kind, severity), [kind, severity])
  const now = useRef({ matrix, split, marks })
  now.current = { matrix, split, marks }

  const show = async (s: Source) => {
    const v = engine.current
    if (!v) return
    setMarks([null, null])
    if (s === 'chart') {
      const c = drawChart()
      if (!c) return setNote('This browser would not draw the chart.')
      v.photo(c.data, c.w, c.h)
      pixels.current = c
    } else if (s !== 'own') {
      const w = WORK
      const h = Math.round(WORK * 0.75)
      /* ⚠️ A FAILED PAINT LEAVES THE PAGE AS IT WAS, AND SAYS SO. Painting reads the picture back
         from the GPU so a tap can pick its colours, and a lost device fails that read. Unhandled,
         the dropdown named the new picture while the stage and the picking still held the old one —
         so a tap picked the test card's white background and called it the garden's. */
      try {
        pixels.current = { data: await v.paint(s, w, h), w, h }
      } catch {
        setNote('That picture could not be painted just now — try it again.')
        return
      }
    }
    setNote(null)
    setSource(s)
    if (!running) setRunning(true)
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
    pixels.current = { data, w, h }
    setMarks([null, null])
    setSource('own')
    setNote('Your picture stays on this device: it is never uploaded or kept.')
  }

  /** a press on the picture picks the colour under it, as A and then B */
  const pick = (x: number, y: number, stage: [number, number]) => {
    const px = pixels.current
    if (!px) return
    const at = toImage(fitImage(stage, [px.w, px.h]), [px.w, px.h], [x, y])
    if (!at) return
    const o = (at[1] * px.w + at[0]) * 4
    const c: V3 = [px.data[o] / 255, px.data[o + 1] / 255, px.data[o + 2] / 255]
    setSaved((s) => ({ ...s, [next]: hex(c) }))
    setMarks((m) => (next === 'a' ? [at, m[1]] : [m[0], at]))
    setNext((n) => (n === 'a' ? 'b' : 'a'))
  }

  const info = KINDS.find((k) => k.id === kind)!
  const graded = kind === 'protan' || kind === 'deutan' || kind === 'tritan'
  const pairNow = deltaE(seen(a, kind, severity), seen(b, kind, severity))
  const label = `${source === 'chart' ? 'The test card' : source === 'own' ? 'Your picture' : PICTURES.find((p) => p.id === source)?.name}: typical colour vision on the left of the divider, ${info.name}${graded ? ` at ${Math.round(severity * 100)}%` : ''} on the right. The two picked colours, ${saved.a} and ${saved.b}, are ${apartness(pairNow)} to this viewer.`

  return (
    <div className="lab-keys" aria-label="Colour sight">
      <LabStage
        label={label}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createVision(device, context, format, canvas)
          engine.current = v
          const c = drawChart()
          if (c) {
            v.photo(c.data, c.w, c.h)
            pixels.current = c
          }
          return {
            frame: () => {
              const n = now.current
              v.frame({
                matrix: n.matrix,
                split: n.split,
                divider: n.split > 0 && n.split < 1,
                marks: n.marks,
              })
            },
            destroy: () => {
              v.destroy()
              engine.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const k = e.currentTarget.width / Math.max(1, r.width)
          pick((e.clientX - r.left) * k, (e.clientY - r.top) * k, [
            e.currentTarget.width,
            e.currentTarget.height,
          ])
          if (!running) setRunning(true)
        }}
      />

      {live && (
        <>
          <div className="lab-controls">
            <div className="lab-group" role="group" aria-label="Whose eyes">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  className="btn btn-ghost"
                  aria-pressed={kind === k.id}
                  onClick={() => setSaved((s) => ({ ...s, kind: k.id }))}
                >
                  {k.id === 'typical'
                    ? 'Typical'
                    : k.id === 'achromat'
                      ? 'No colour'
                      : k.id[0].toUpperCase() + k.id.slice(1)}
                </button>
              ))}
            </div>
            <label className="studio-pick">
              <span className="sr-only">Picture</span>
              <select
                value={source}
                onChange={(e) => {
                  const s = e.target.value as Source
                  if (s === 'own') fileRef.current?.click()
                  else void show(s)
                }}
              >
                <option value="chart">Test card</option>
                {PICTURES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="own">Your picture…</option>
              </select>
            </label>
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
          <div className="sun-sliders">
            {graded && (
              <label>
                <span>How strong {Math.round(severity * 100)}%</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={severity}
                  onChange={(e) => setSaved((s) => ({ ...s, severity: Number(e.target.value) }))}
                />
              </label>
            )}
            <label>
              <span>Compare: typical on the left of {Math.round(split * 100)}%</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={split}
                onChange={(e) => setSplit(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="vision-pair">
            <div className="lab-controls">
              <label className="vision-pick">
                <input
                  type="color"
                  value={saved.a}
                  onChange={(e) => setSaved((s) => ({ ...s, a: e.target.value }))}
                />
                <span>A {saved.a}</span>
              </label>
              <label className="vision-pick">
                <input
                  type="color"
                  value={saved.b}
                  onChange={(e) => setSaved((s) => ({ ...s, b: e.target.value }))}
                />
                <span>B {saved.b}</span>
              </label>
              <span className="muted">
                Tap the picture to pick {next === 'a' ? 'A' : 'B'} next.
              </span>
            </div>
            <table className="vision-table">
              <caption className="sr-only">
                Colours A and B as each kind of colour vision sees them
              </caption>
              <thead>
                <tr>
                  <th scope="col">Seen with</th>
                  <th scope="col">A and B</th>
                  <th scope="col">Difference</th>
                  <th scope="col">Contrast</th>
                </tr>
              </thead>
              <tbody>
                {KINDS.map((k) => {
                  const s = k.id === kind ? severity : 1
                  const [x, y] = [seen(a, k.id, s), seen(b, k.id, s)]
                  const d = deltaE(x, y)
                  return (
                    <tr key={k.id} aria-current={k.id === kind ? 'true' : undefined}>
                      <th scope="row">{k.id === 'typical' ? 'Typical' : k.name.split(' — ')[0]}</th>
                      <td>
                        <span className="vision-swatch" style={{ background: hex(x) }} />
                        <span className="vision-swatch" style={{ background: hex(y) }} />
                      </td>
                      <td>
                        {apartness(d)} <span className="muted">(ΔE {d.toFixed(0)})</span>
                      </td>
                      <td>{contrast(x, y).toFixed(2)}:1</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {note && <p className="muted lab-hint">{note}</p>}
          <p className="muted lab-hint">
            {info.name}
            {info.cone
              ? `: the ${info.cone}-wavelength cones are ${graded && severity < 1 ? 'weaker' : 'missing'}.`
              : '.'}{' '}
            A simulation, not anybody's eyes: red-green follows Viénot, Brettel &amp; Mollon (1999),
            blue-yellow uses a rougher one-plane version of it, and a partial deficiency is a
            straight mix with typical vision. Another published model (Machado 2009) agrees closely
            on which colours run together but paints them a shade different, so trust the pairs more
            than the exact tints. ΔE is the CIE 1976 difference — about 2 is the smallest anyone
            notices side by side; contrast is WCAG&apos;s, where 4.5:1 is the bar for ordinary text.
          </p>
        </>
      )}
    </div>
  )
}
