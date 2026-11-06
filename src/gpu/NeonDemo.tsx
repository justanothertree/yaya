import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  COLOURS,
  COLOUR_IDS,
  MAX_LETTERS,
  STYLES,
  brightness,
  faultyLetter,
  letterRed,
  type NeonColour,
  type Style,
} from './neon'
import { createNeon, type NeonSign } from './neonEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** Draw the word into a field-sized mask, each letter in its own red, centred and fitted. */
function maskOf(word: string, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  const font = (px: number) => `800 ${px}px system-ui, -apple-system, 'Segoe UI', sans-serif`
  let px = Math.round(h * 0.42)
  g.font = font(px)
  const wide = g.measureText(word).width
  if (wide > w * 0.86) {
    px = Math.floor((px * w * 0.86) / wide)
    g.font = font(px)
  }
  g.textBaseline = 'middle'
  let x = (w - g.measureText(word).width) / 2
  ;[...word].forEach((ch, i) => {
    g.fillStyle = `rgb(${letterRed(i)},0,0)`
    g.fillText(ch, x, h / 2)
    x += g.measureText(ch).width
  })
  return g.getImageData(0, 0, w, h).data
}

/** Type a word and it becomes a neon sign: letters stutter on, one buzzes, a tap knocks it. */
export function NeonDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [word, setWord] = useState('NEON')
  const [style, setStyle] = useState<Style>('tube')
  const [palette, setPalette] = useState<NeonColour>('pink')
  const now = useRef({ word, style, palette })
  now.current = { word, style, palette }
  const runningRef = useRef(running)
  runningRef.current = running

  const signRef = useRef<NeonSign | null>(null)
  const clock = useRef(0)
  /** when each letter was lit: a letter newly typed stutters on, the ones before it stay on */
  const litAt = useRef<number[]>([])
  const knockedAt = useRef(-10)
  const redraw = useRef<() => void>(() => {})

  const reseed = () => {
    const s = signRef.current
    if (!s) return
    const [w, h] = s.field
    s.setMask(maskOf(now.current.word, w, h), now.current.style)
    redraw.current()
  }
  const type = (next: string) => {
    const w = next.slice(0, MAX_LETTERS)
    let same = 0
    while (same < w.length && same < word.length && w[same] === word[same]) same++
    litAt.current = [...w].map((_, i) => (i < same ? (litAt.current[i] ?? -10) : clock.current))
    setWord(w)
    if (!runningRef.current) setRunning(true)
  }
  useEffect(reseed, [word, style])
  useEffect(() => redraw.current(), [palette])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'k') knockedAt.current = clock.current
    else if (k === 's') setStyle((s) => (s === 'tube' ? 'solid' : 'tube'))
    else if (/^[1-4]$/.test(k)) setPalette(COLOUR_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Neon">
      <LabStage
        label="A neon sign spelling out whatever is typed, glowing on a brick wall"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const sign = await createNeon(device, context, format, canvas)
          signRef.current = sign
          const bright = new Float32Array(MAX_LETTERS)
          const draw = () => {
            const n = now.current
            const t = clock.current
            const faulty = faultyLetter(n.word)
            for (let i = 0; i < MAX_LETTERS; i++)
              bright[i] = brightness(i, t, litAt.current[i] ?? -10, knockedAt.current, faulty)
            sign.draw(t, n.palette, bright, Math.max(1, n.word.length))
          }
          redraw.current = () => {
            if (!runningRef.current) draw()
          }
          reseed()
          return {
            frame: (dt) => {
              clock.current += dt
              draw()
            },
            resize: () => {
              sign.resize()
              reseed()
            },
            destroy: () => {
              sign.destroy()
              signRef.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={() => {
          /* a knock on the sign: everything stutters for a moment */
          knockedAt.current = clock.current
          if (!running) setRunning(true)
        }}
      />

      {live && (
        <div className="lab-controls">
          <label className="lab-text">
            <span className="sr-only">The sign says</span>
            <input
              value={word}
              maxLength={MAX_LETTERS}
              onChange={(e) => type(e.target.value)}
              placeholder="Type a word"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          </label>
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <div className="lab-group" role="group" aria-label="Style">
            {(Object.keys(STYLES) as Style[]).map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={style === s}
                onClick={() => setStyle(s)}
              >
                {STYLES[s]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Colour">
            {COLOUR_IDS.map((c) => (
              <button
                key={c}
                className="btn btn-ghost"
                aria-pressed={palette === c}
                onClick={() => setPalette(c)}
              >
                {COLOURS[c]}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Type, and each new letter stutters on as real neon does; one letter is always a little
          faulty. Tap the sign to knock it. The glow is a distance field worked out on the GPU by
          jump flooding — every pixel learns its nearest tube, and whose, in nine passes.
          {!touchOnly() &&
            ' Keys, with the sign focused: K knocks, S tube or solid, 1–4 colours, Space pauses.'}
        </p>
      )}
    </div>
  )
}
