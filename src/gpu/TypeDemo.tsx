import { useEffect, useMemo, useRef, useState } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { hashParam, here } from '../lab/links'
import { CanvasStage } from './CanvasStage'
import {
  BASE,
  CHARSET,
  DEFAULT_STYLE,
  GRID_H,
  GRID_W,
  INKS,
  MAX_FONTS,
  PRESETS,
  RANGES,
  STARTER,
  STARTER_MESSAGE,
  TYPE_KEY,
  decode,
  encode,
  glyphOf,
  layout,
  readSaved,
  setPoint,
  type Font,
  type Glyph,
  type Pt,
  type Saved,
  type Style,
} from './typeface'
import { useKept } from './kept'

const SLIDERS: { k: keyof typeof RANGES; label: string; step: number }[] = [
  { k: 'weight', label: 'Weight', step: 0.05 },
  { k: 'slant', label: 'Slant', step: 0.01 },
  { k: 'width', label: 'Width', step: 0.05 },
  { k: 'corners', label: 'Round corners', step: 0.05 },
  { k: 'tracking', label: 'Letter gap', step: 0.1 },
  { k: 'leading', label: 'Line gap', step: 0.1 },
]

/* ---------------------------------------------------------------------------- drawing type */

/** one stroke's path, with its corners rounded by `r` (canvas units) */
function strokePath(ctx: CanvasRenderingContext2D, pts: Pt[], r: number) {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length - 1; i++)
    ctx.arcTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r)
  const last = pts[pts.length - 1]
  ctx.lineTo(last[0], last[1])
}

/** set a message in a font onto a canvas, filling the box at (x, y, w, h) */
function drawType(
  ctx: CanvasRenderingContext2D,
  font: Font,
  message: string,
  box: { x: number; y: number; w: number; h: number },
) {
  const st = font.style
  ctx.fillStyle = INKS[st.paper]
  ctx.fillRect(box.x, box.y, box.w, box.h)
  const pad = 2
  // the largest size at which the message fits the box, wrapping to the box's width
  let s = Math.min(box.w / 20, box.h / (GRID_H + 2))
  let set = layout(message, font, box.w / s - pad * 2)
  for (let i = 0; i < 12 && (set.height + pad * 2) * s > box.h; i++) {
    s *= 0.85
    set = layout(message, font, box.w / s - pad * 2)
  }
  const ox = box.x + (box.w - set.width * s) / 2
  const oy = box.y + (box.h - set.height * s) / 2
  const at = (p: Pt): Pt => [ox + p[0] * s, oy + p[1] * s]
  const paths: Pt[][] = []
  for (const pl of set.placed) {
    const gl = glyphOf(font, pl.c)
    if (!gl) continue
    for (const stroke of gl.strokes) paths.push(stroke.map((p) => at(setPoint(p, pl, st))))
  }
  const w = st.weight * s
  const r = st.corners * s * 0.9
  ctx.lineCap = st.ends === 'round' ? 'round' : 'square'
  ctx.lineJoin = st.ends === 'round' ? 'round' : 'miter'
  ctx.miterLimit = 3
  const pass = (colour: string, width: number, dx = 0, dy = 0) => {
    ctx.strokeStyle = colour
    ctx.lineWidth = Math.max(0.5, width)
    for (const p of paths) {
      strokePath(
        ctx,
        p.map(([x, y]) => [x + dx, y + dy]),
        r,
      )
      ctx.stroke()
    }
  }
  if (st.shadow) pass(st.paper === 0 ? INKS[st.ink2] : 'rgba(0,0,0,0.35)', w, s * 0.35, s * 0.35)
  if (st.outline) {
    // a hollow letter: the stroke, then the paper drawn down its middle; on dark paper it glows
    if (st.paper === 0 || st.paper === 7) {
      ctx.shadowColor = INKS[st.ink]
      ctx.shadowBlur = s * 0.8
    }
    pass(INKS[st.ink], w)
    ctx.shadowBlur = 0
    pass(INKS[st.paper], w - Math.max(2, s * 0.22))
  } else pass(INKS[st.ink], w)
  if (st.inline) pass(INKS[st.ink2], Math.max(1, w * 0.22))
  return s
}

/* ---------------------------------------------------------------------------- the letter editor */

function LetterEditor({
  glyph,
  onChange,
  style,
}: {
  glyph: Glyph
  onChange: (g: Glyph) => void
  style: Style
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [pen, setPen] = useState<Pt[]>([])
  const [cursor, setCursor] = useState<Pt>([0, 0])
  const [erase, setErase] = useState(false)
  const cell = 40
  const pad = 22
  const W = GRID_W * cell + pad * 2
  const H = GRID_H * cell + pad * 2
  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.fillStyle = INKS[style.paper]
    ctx.fillRect(0, 0, W, H)
    const dark = style.paper === 0 || style.paper === 7 || style.paper === 6
    // the baseline and the cap line
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'
    ctx.lineWidth = 1
    for (const y of [0, 6]) {
      ctx.beginPath()
      ctx.moveTo(pad - 10, pad + y * cell)
      ctx.lineTo(W - pad + 10, pad + y * cell)
      ctx.stroke()
    }
    const at = ([x, y]: Pt): Pt => [pad + x * cell, pad + y * cell]
    ctx.lineCap = style.ends === 'round' ? 'round' : 'square'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = INKS[style.ink]
    ctx.lineWidth = style.weight * cell
    for (const st of glyph.strokes) {
      strokePath(ctx, st.map(at), style.corners * cell * 0.9)
      ctx.stroke()
    }
    // the stroke being drawn, thin, with its points
    if (pen.length) {
      ctx.strokeStyle = '#ff3d7f'
      ctx.lineWidth = 3
      strokePath(ctx, pen.map(at), 0)
      ctx.stroke()
    }
    for (let x = 0; x <= GRID_W; x++)
      for (let y = 0; y <= GRID_H; y++) {
        const [px, py] = at([x, y])
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)'
        ctx.beginPath()
        ctx.arc(px, py, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    const [cx, cy] = at(cursor)
    ctx.strokeStyle = '#ffb000'
    ctx.lineWidth = 2
    ctx.strokeRect(cx - 9, cy - 9, 18, 18)
  }, [glyph, pen, cursor, style, W, H])

  const finish = () => {
    if (pen.length >= 2) onChange({ ...glyph, strokes: [...glyph.strokes, pen] })
    setPen([])
  }
  const add = (p: Pt) => {
    const last = pen[pen.length - 1]
    // the same dot twice ends the stroke
    if (last && last[0] === p[0] && last[1] === p[1]) return finish()
    setPen([...pen, p])
  }
  /** the stroke nearest a point, if one passes within a third of a dot */
  const nearest = (p: Pt) => {
    let best = -1
    let bd = 0.35
    glyph.strokes.forEach((st, i) => {
      for (let k = 0; k + 1 < st.length; k++) {
        const [ax, ay] = st[k]
        const [bx, by] = st[k + 1]
        const L = (bx - ax) ** 2 + (by - ay) ** 2 || 1
        const t = Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / L))
        const d = Math.hypot(p[0] - (ax + t * (bx - ax)), p[1] - (ay + t * (by - ay)))
        if (d < bd) {
          bd = d
          best = i
        }
      }
    })
    return best
  }
  const remove = (i: number) =>
    i >= 0 && onChange({ ...glyph, strokes: glyph.strokes.filter((_, k) => k !== i) })

  return (
    <div className="ty-editor">
      <canvas
        ref={ref}
        width={W}
        height={H}
        className="ty-grid"
        role="img"
        aria-label="The letter's grid of dots. Tap dots to draw a stroke; tap the last dot again to end it."
        tabIndex={0}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const fx = ((e.clientX - r.left) / r.width) * W
          const fy = ((e.clientY - r.top) / r.height) * H
          const exact: Pt = [(fx - pad) / cell, (fy - pad) / cell]
          const p: Pt = [Math.round(exact[0]), Math.round(exact[1])].map((v, i) =>
            Math.max(0, Math.min(i ? GRID_H : GRID_W, v)),
          ) as Pt
          setCursor(p)
          if (erase) remove(nearest(exact))
          else add(p)
        }}
        onKeyDown={(e) => {
          const moves: Record<string, Pt> = {
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
          }
          if (moves[e.key]) {
            e.preventDefault()
            e.stopPropagation()
            setCursor(([x, y]) => [
              Math.max(0, Math.min(GRID_W, x + moves[e.key][0])),
              Math.max(0, Math.min(GRID_H, y + moves[e.key][1])),
            ])
          } else if (e.key === ' ') {
            e.preventDefault()
            if (erase) remove(nearest(cursor))
            else add(cursor)
          } else if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault()
            finish()
          } else if (e.key === 'Backspace') {
            e.preventDefault()
            if (pen.length) setPen(pen.slice(0, -1))
            else remove(glyph.strokes.length - 1)
          }
        }}
      />
      <div className="lab-controls">
        <button className="btn btn-ghost" aria-pressed={!erase} onClick={() => setErase(false)}>
          ✏️ Draw
        </button>
        <button
          className="btn btn-ghost"
          aria-pressed={erase}
          onClick={() => {
            finish()
            setErase(true)
          }}
        >
          🧽 Erase a stroke
        </button>
        <button className="btn btn-ghost" onClick={finish} disabled={pen.length < 2}>
          End stroke
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => (pen.length ? setPen([]) : remove(glyph.strokes.length - 1))}
          disabled={!pen.length && !glyph.strokes.length}
        >
          ↶ Undo
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            setPen([])
            onChange({ ...glyph, strokes: [] })
          }}
          disabled={!glyph.strokes.length}
        >
          Clear letter
        </button>
        <div className="lab-group" role="group" aria-label="Letter width">
          {([2, 4] as const).map((w) => (
            <button
              key={w}
              className="btn btn-ghost"
              aria-pressed={glyph.w === w}
              onClick={() => onChange({ ...glyph, w })}
            >
              {w === 2 ? 'Narrow' : 'Wide'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------- the foundry */

function startFont(saved: Saved): { font: Font; message: string; fromLink: boolean } {
  const linked = hashParam('font')
  const got = linked ? decode(linked) : null
  if (got) return { ...got, fromLink: true }
  const mine = saved.current ? decode(saved.current) : null
  return mine
    ? { ...mine, fromLink: false }
    : { font: STARTER, message: STARTER_MESSAGE, fromLink: false }
}

export function TypeDemo() {
  const [saved, setSaved] = useKept(TYPE_KEY, readSaved)
  const [start] = useState(() => startFont(saved))
  const [font, setFont] = useState<Font>(start.font)
  const [message, setMessage] = useState(start.message)
  const [fromLink, setFromLink] = useState(start.fromLink)
  const [letter, setLetter] = useState('A')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const now = useRef({ font, message })
  now.current = { font, message }
  const code = useMemo(() => encode(font, message), [font, message])

  useEffect(() => {
    if (!fromLink) setSaved((s) => ({ ...s, current: code }))
  }, [code, fromLink, setSaved])

  const change = (f: (x: Font) => Font) => {
    setFont(f)
    setFromLink(false)
  }
  const setStyle = (p: Partial<Style>) => change((f) => ({ ...f, style: { ...f.style, ...p } }))
  const glyph = font.glyphs[letter] ?? BASE[letter]
  const edited = letter in font.glyphs

  const download = () => {
    const c = document.createElement('canvas')
    c.width = 1600
    c.height = 900
    const ctx = c.getContext('2d')
    if (!ctx) return
    drawType(ctx, font, message || ' ', { x: 0, y: 0, w: c.width, h: c.height })
    c.toBlob((b) => {
      if (!b) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = `${(font.name || 'my-font').replace(/[^\w-]+/g, '-').toLowerCase()}.png`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    }, 'image/png')
  }
  const keep = () => {
    setSaved((s) => ({
      ...s,
      fonts: [code, ...s.fonts.filter((f) => decode(f)?.font.name !== font.name)].slice(
        0,
        MAX_FONTS,
      ),
    }))
  }

  return (
    <div className="lab-keys ty-room">
      {fromLink && (
        <p className="beat-banner">
          🔤 <strong>A font somebody made: “{font.name}”</strong> — type anything below to see it in
          their letters. Change it and it becomes yours to keep.
        </p>
      )}
      <CanvasStage
        className="ty-stage"
        label={`“${message.replace(/\n/g, ' ')}” set in the font ${font.name}.`}
        make={(ctx, canvas) => {
          canvasRef.current = canvas
          let last = ''
          return {
            frame: () => {
              const n = now.current
              const key = `${canvas.width}x${canvas.height}|${encode(n.font, n.message)}`
              if (key === last) return
              last = key
              drawType(ctx, n.font, n.message || ' ', {
                x: 0,
                y: 0,
                w: canvas.width,
                h: canvas.height,
              })
            },
          }
        }}
      />
      <label className="ty-message">
        <span className="sr-only">Your message</span>
        <textarea
          value={message}
          maxLength={120}
          rows={2}
          placeholder="Type something"
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>

      <div className="fw-panel">
        <section aria-label="Style">
          <h3 className="fw-h">Style</h3>
          <div className="lab-controls">
            <span className="fw-label">Start from</span>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                className="btn btn-ghost"
                onClick={() => setStyle({ ...DEFAULT_STYLE, ...p.style })}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="sun-sliders">
            {SLIDERS.map(({ k, label, step }) => (
              <label key={k}>
                <span>
                  {label} {font.style[k].toFixed(2)}
                </span>
                <input
                  type="range"
                  min={RANGES[k][0]}
                  max={RANGES[k][1]}
                  step={step}
                  value={font.style[k]}
                  onChange={(e) => setStyle({ [k]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={font.style.ends === 'square'}
              onClick={() => setStyle({ ends: font.style.ends === 'square' ? 'round' : 'square' })}
            >
              Square ends
            </button>
            {(['outline', 'inline', 'shadow'] as const).map((k) => (
              <button
                key={k}
                className="btn btn-ghost"
                aria-pressed={font.style[k]}
                onClick={() => setStyle({ [k]: !font.style[k] })}
              >
                {k === 'outline' ? 'Outline' : k === 'inline' ? 'Inline stripe' : 'Shadow'}
              </button>
            ))}
          </div>
          {(['ink', 'ink2', 'paper'] as const).map((k) => (
            <div
              key={k}
              className="fw-swatches"
              role="group"
              aria-label={k === 'ink' ? 'Ink' : k === 'ink2' ? 'Stripe and shadow' : 'Paper'}
            >
              <span className="fw-label">
                {k === 'ink' ? 'Ink' : k === 'ink2' ? 'Stripe' : 'Paper'}
              </span>
              {INKS.map((c, i) => (
                <button
                  key={c}
                  className="fw-swatch"
                  style={{ background: c }}
                  aria-label={`${k === 'ink' ? 'Ink' : k === 'ink2' ? 'Stripe' : 'Paper'} colour ${i + 1}`}
                  aria-pressed={font.style[k] === i}
                  onClick={() => setStyle({ [k]: i })}
                />
              ))}
            </div>
          ))}
        </section>

        <section aria-label="Redraw a letter">
          <h3 className="fw-h">Letters</h3>
          <div className="ty-letters" role="group" aria-label="Choose a letter">
            {CHARSET.map((c) => (
              <button
                key={c}
                className={`btn btn-ghost ty-letter${c in font.glyphs ? ' is-edited' : ''}`}
                aria-pressed={letter === c}
                aria-label={`Letter ${c}${c in font.glyphs ? ', redrawn' : ''}`}
                onClick={() => setLetter(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <LetterEditor
            key={letter}
            glyph={glyph}
            style={font.style}
            onChange={(g) => change((f) => ({ ...f, glyphs: { ...f.glyphs, [letter]: g } }))}
          />
          {edited && (
            <button
              className="btn btn-ghost"
              onClick={() =>
                change((f) => {
                  const glyphs = { ...f.glyphs }
                  delete glyphs[letter]
                  return { ...f, glyphs }
                })
              }
            >
              Put {letter} back as it was
            </button>
          )}
        </section>
      </div>

      <div className="lab-controls">
        <label className="fw-name">
          <span className="sr-only">Font name</span>
          <input
            value={font.name}
            maxLength={24}
            placeholder="Font name"
            onChange={(e) => change((f) => ({ ...f, name: e.target.value }))}
          />
        </label>
        <button className="btn btn-ghost" onClick={keep}>
          Keep this font
        </button>
        <button className="btn btn-ghost" onClick={download}>
          ⬇ Save as picture
        </button>
        {saved.fonts.map((f) => {
          const d = decode(f)
          if (!d) return null
          return (
            <span key={f} className="fw-kept">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setFont(d.font)
                  setFromLink(false)
                }}
              >
                {d.font.name}
              </button>
              <button
                className="btn btn-ghost"
                aria-label={`Forget ${d.font.name}`}
                onClick={() => setSaved((s) => ({ ...s, fonts: s.fonts.filter((x) => x !== f) }))}
              >
                ✕
              </button>
            </span>
          )
        })}
      </div>
      <CopyLink
        text={`🔤 A font I made, “${font.name}”:\n${here()}#lab?demo=type&font=${code}`}
        label="🔗 Copy a link to this font and message"
      />
      <p className="muted lab-hint">
        Every letter is a few strokes between dots. Pick a letter and tap dots to draw a stroke —
        tap the last dot again to end it — or erase strokes and draw your own; letters you have
        redrawn are marked. Then style the whole font at once: weight, slant, width, round or square
        ends, rounded corners, an outline, an inline stripe, a shadow and three colours. Lower case
        is typed in capitals. Keys in the letter grid: arrows move, Space adds a dot, Enter ends the
        stroke, Backspace takes one back. The picture saves at 1600 × 900; the link carries the font
        and the message.
      </p>
    </div>
  )
}
