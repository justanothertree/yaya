import { useEffect, useMemo, useState } from 'react'
import {
  MOTION_WIDTHS,
  STILL_WIDTHS,
  fileNameFor,
  motionOf,
  motionGifOf,
  save,
  sizeLabel,
  sizeOf,
  stillOf,
} from './export'
import type { Drawing } from './strokes'

/**
 * Take the picture away with you.
 *
 * ⚠️ IT IS THE REPLAY BUTTON, AS A FILE. The room already offers "watch it draw itself" and
 * people already press it, so the animation here needs no explaining — it is the thing they have
 * seen, in a format they can send to somebody. Naming it after the feature it comes from is worth
 * more than naming it after the file format.
 *
 * ⚠️ "DOWNLOAD" RATHER THAN A SECOND ARROW. Keep is ⬇ and puts a picture in the gallery on this
 * site; this puts a file on your device, and those are different enough that they must not look
 * like the same button with different words.
 *
 * ⚠️ THE RESULT IS SHOWN, NOT JUST REPORTED. A GIF is a thing with a speed and a size, and
 * "saved 6 KB" tells you neither. Playing it back in the panel is the only honest confirmation —
 * and it is the same file the browser just wrote, held by its own object URL until this closes.
 */
export function SaveArt({ art, onClose }: { art: Drawing; onClose: () => void }) {
  const [kind, setKind] = useState<'still' | 'motion'>('still')
  const [width, setWidth] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [made, setMade] = useState<{ url: string; name: string; bytes: number } | null>(null)
  /** null means "whatever this drawing's own answer is" — see motionOf */
  const [speed, setSpeed] = useState<number | null>(null)

  const motion = useMemo(() => motionOf(art, speed ?? undefined), [art, speed])
  const widths = kind === 'motion' ? MOTION_WIDTHS : STILL_WIDTHS
  const px = width ?? widths[1][1]
  const shape = sizeOf(art, px)

  /* ⚠️ the object URL holds the whole file in memory; the preview owns this one and lets go of it
     when the panel closes or makes another */
  useEffect(() => () => void (made && URL.revokeObjectURL(made.url)), [made])

  /* a drawing with one stroke has nothing to animate, so the choice cannot stay where it was */
  useEffect(() => {
    if (!motion && kind === 'motion') setKind('still')
  }, [motion, kind])

  /* ⚠️ A speed does not survive a change of picture. 40 strokes a second is the default for a
     two-hundred-stroke drawing and nonsense for a four-stroke one, and the panel stays mounted
     when it is pointed at a different picture in the gallery. */
  useEffect(() => setSpeed(null), [art])

  const run = async () => {
    setBusy(kind === 'still' ? 'Drawing it…' : 'Starting…')
    setMade(null)
    try {
      const blob =
        kind === 'still'
          ? await stillOf(art, px)
          : await motionGifOf(art, px, motion?.speed, (a, b) => setBusy(`Frame ${a} of ${b}…`))
      if (!blob) {
        setBusy(null)
        return
      }
      const name = fileNameFor(art, kind === 'still' ? 'png' : 'gif')
      save(blob, name)
      setMade({ url: URL.createObjectURL(blob), name, bytes: blob.size })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="paint-row paint-save">
      <div className="paint-save-head">
        {/* a picture only has a name once it has been kept, and quoting the words "this picture"
            reads as though that were the name */}
        <strong>{art.name ? `Download “${art.name}”` : 'Download this picture'}</strong>
        <button className="btn btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>

      <div className="paint-save-kinds">
        <button
          className={'btn' + (kind === 'still' ? ' is-on' : '')}
          aria-pressed={kind === 'still'}
          onClick={() => {
            setKind('still')
            setWidth(null)
          }}
        >
          🖼 Picture
        </button>
        <button
          className={'btn' + (kind === 'motion' ? ' is-on' : '')}
          aria-pressed={kind === 'motion'}
          disabled={!motion}
          onClick={() => {
            setKind('motion')
            setWidth(null)
          }}
        >
          🎞 Animation
        </button>
      </div>

      <p className="muted paint-save-what">
        {kind === 'still' ? (
          <>
            A PNG of the finished picture, {shape.w}×{shape.h}.
            {!art.bg && ' The paper is transparent, so it will sit on any background.'}
          </>
        ) : motion?.kind === 'frames' ? (
          <>
            A GIF of your animation — {motion.steps} frames, about {motion.seconds} seconds, and it
            loops.
          </>
        ) : (
          <>
            A GIF of it drawing itself, the same as ▶ Replay — {motion?.steps} steps over about{' '}
            {motion?.seconds} seconds, and it loops.
          </>
        )}
        {kind === 'motion' &&
          !art.bg &&
          ' A GIF cannot be transparent, so the paper will be white.'}
      </p>

      {/* ⚠️ Right under the sentence it changes. Dragging it rewrites the "about N seconds"
          above, which is the only readout that means anything — "12 strokes a second" is a number
          you have to imagine, and "about 3.4 seconds" is one you can picture. */}
      {kind === 'motion' && motion && (
        <label className="appearance-slider paint-save-speed">
          <span className="muted">
            {motion.unit === 'frames' ? 'Frames a second' : 'Strokes a second'}
          </span>
          <input
            type="range"
            min={motion.min}
            max={motion.max}
            step={1}
            value={motion.speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
          <span className="appearance-slider-val">{motion.speed}</span>
        </label>
      )}

      <div className="paint-save-sizes">
        {widths.map(([label, w]) => (
          <button
            key={w}
            className={'btn' + (px === w ? ' is-on' : '')}
            aria-pressed={px === w}
            onClick={() => setWidth(w)}
          >
            {label} · {w}px
          </button>
        ))}
      </div>

      {/* ⚠️ ITS OWN LINE. In the row with the sizes it was a fourth chip that happened to do
          something — same shape, same weight, one press apart from three buttons that only choose.
          Pick a size, then save, is an order you can see. */}
      <div className="paint-save-go">
        <button className="btn" onClick={() => void run()} disabled={!!busy}>
          {busy ?? '⤓ Save the file'}
        </button>
      </div>

      {made && (
        <div className="paint-save-made">
          {/* ⚠️ Not decoration. This is the file, played by the browser's own decoder — if it were
              going to arrive broken or upside down, this is where that shows. */}
          <img src={made.url} alt={`${art.name} as it was saved`} />
          <span className="muted">
            Saved <strong>{made.name}</strong> · {sizeLabel(made.bytes)}
          </span>
        </div>
      )}
    </div>
  )
}
