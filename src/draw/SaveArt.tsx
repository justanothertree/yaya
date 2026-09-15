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
import { frameCount, type Drawing } from './strokes'

/**
 * Take the picture away with you.
 *
 * ⚠️ THREE THINGS, NAMED AFTER WHAT THEY ARE. The two moving ones used to share a button
 * called "Animation" and the drawing decided which you got — so on a flat picture that button
 * made a replay, and the frames export was unreachable and looked absent. It was reported as
 * missing. The right answer for a given drawing is still obvious, but which one you are getting
 * has to be legible before you press it, and the one you cannot have has to say why rather than
 * vanish — a button that is not there teaches nothing.
 *
 * ⚠️ ▶ REPLAY IS NAMED AFTER THE ROOM'S OWN BUTTON. People already press "watch it draw
 * itself" and know what it does; naming the file after the feature beats naming it after GIF.
 *
 * ⚠️ "DOWNLOAD" RATHER THAN A SECOND ARROW. Keep is ⬇ and puts a picture in the gallery on this
 * site; this puts a file on your device, and those are different enough that they must not look
 * like the same button with different words.
 *
 * ⚠️ THE RESULT IS SHOWN, NOT JUST REPORTED. A GIF is a thing with a speed and a size, and
 * "saved 6 KB" tells you neither. Playing it back in the panel is the only honest confirmation —
 * and it is the same file the browser just wrote, held by its own object URL until this closes.
 */
type Kind = 'still' | 'timelapse' | 'frames'

/* a six-frame animation at its own speed comes out at exactly 1.0, which read as "1 seconds" */
const secs = (n: number) => (n === 1 ? '1 second' : `${n} seconds`)

export function SaveArt({ art, onClose }: { art: Drawing; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('still')
  const [width, setWidth] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [made, setMade] = useState<{ url: string; name: string; bytes: number } | null>(null)
  /** null means "whatever this drawing's own answer is" — see motionOf */
  const [speed, setSpeed] = useState<number | null>(null)

  const replay = useMemo(() => motionOf(art, 'timelapse', speed ?? undefined), [art, speed])
  const anim = useMemo(() => motionOf(art, 'frames', speed ?? undefined), [art, speed])
  const motion = kind === 'timelapse' ? replay : kind === 'frames' ? anim : null
  /* only to explain a disabled button — motionOf already decides what is possible */
  const frames = useMemo(() => frameCount(art), [art])
  const widths = kind === 'still' ? STILL_WIDTHS : MOTION_WIDTHS
  const px = width ?? widths[1][1]
  const shape = sizeOf(art, px)

  /* ⚠️ the object URL holds the whole file in memory; the preview owns this one and lets go of it
     when the panel closes or makes another */
  useEffect(() => () => void (made && URL.revokeObjectURL(made.url)), [made])

  /* pointed at a different picture that cannot do what was selected — the choice cannot stay */
  useEffect(() => {
    if (kind !== 'still' && !motion) setKind('still')
  }, [motion, kind])

  /**
   * ⚠️ BOTH RESET WHEN THE KIND CHANGES, for different reasons. The widths are two different
   * lists — 2400 is a still size and would make a GIF nobody could send. And the speeds are two
   * different UNITS on two different ranges: 12 is a reasonable strokes-a-second and 12 frames a
   * second is a different request entirely, on a dial that stops at 24 rather than 60.
   */
  const pick = (next: Kind) => {
    if ((next === 'still') !== (kind === 'still')) setWidth(null)
    if (next !== kind) setSpeed(null)
    setKind(next)
  }

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
          : await motionGifOf(
              art,
              px,
              kind === 'frames' ? 'frames' : 'timelapse',
              motion?.speed,
              (a, b) => setBusy(`Frame ${a} of ${b}…`),
            )
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

      {/**
       * ⚠️ THE ONE YOU CANNOT HAVE STAYS ON SCREEN AND SAYS WHY. Hiding it would make the
       * panel tidier and would be the reason the frames export went unnoticed in the first place:
       * a control that is absent teaches nothing, while one that is greyed out and explains
       * itself tells you both that the feature exists and what to do to reach it.
       */}
      <div className="paint-save-kinds">
        <button
          className={'btn' + (kind === 'still' ? ' is-on' : '')}
          aria-pressed={kind === 'still'}
          onClick={() => pick('still')}
        >
          🖼 Picture
        </button>
        <button
          className={'btn' + (kind === 'timelapse' ? ' is-on' : '')}
          aria-pressed={kind === 'timelapse'}
          disabled={!replay}
          title={
            replay
              ? 'Watch it draw itself, stroke by stroke'
              : frames > 1
                ? 'This one has frames — 🎞 Animation plays them'
                : 'One stroke, so there is nothing to watch being drawn'
          }
          onClick={() => pick('timelapse')}
        >
          ▶ Replay
        </button>
        <button
          className={'btn' + (kind === 'frames' ? ' is-on' : '')}
          aria-pressed={kind === 'frames'}
          disabled={!anim}
          title={
            anim
              ? 'Play through the frames you drew'
              : 'This picture has no frames. Draw some with ⧉ Frames in the paint room, then come back.'
          }
          onClick={() => pick('frames')}
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
        ) : kind === 'frames' && anim ? (
          <>
            A GIF that plays through your {anim.steps} frames — about {secs(anim.seconds)}, and it
            loops.
          </>
        ) : replay ? (
          <>
            A GIF of it drawing itself, the same as ▶ Replay — {replay.steps} steps over about{' '}
            {secs(replay.seconds)}, and it loops.
          </>
        ) : null}
        {kind !== 'still' && !art.bg && ' A GIF cannot be transparent, so the paper will be white.'}
      </p>

      {/* ⚠️ Right under the sentence it changes. Dragging it rewrites the "about N seconds"
          above, which is the only readout that means anything — "12 strokes a second" is a number
          you have to imagine, and "about 3.4 seconds" is one you can picture. */}
      {kind !== 'still' && motion && (
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
