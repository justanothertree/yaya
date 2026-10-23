import { useCallback, useEffect, useState } from 'react'
import {
  PICTURES_EACH,
  PICTURE_BYTES_ALL,
  dropPicture,
  myPictures,
  type Kept,
  type Used,
} from './cloud'
import { sayBytes } from './shrink'
import { AddPicture } from './AddPicture'

/**
 * Pictures: choose one, decide how hard to squeeze it, keep it.
 *
 * ⚠️ THE DIAL IS THE ROOM. Everything else here is a list and a button; the thing worth building
 * is the moment where a picture gets smaller in front of you and says by how much. Compression on
 * a free tier is usually a tax charged out of sight — this makes it a control, which is the same
 * argument the paint room and the instrument are built on.
 *
 * ⚠️ AND IT RE-ENCODES ON A DEBOUNCE, because each notch of that slider is a real `toBlob` on a
 * full-size canvas. Dragging it is forty encodes if nothing waits; a quarter of a second after the
 * thumb stops is one, and the number lands about as fast as a person can read it.
 */
export function Pictures({ authed = false }: { authed?: boolean } = {}) {
  const [kept, setKept] = useState<Kept[] | null>(null)
  const [used, setUsed] = useState<Used | null>(null)
  /* which picture is open full size, if any */
  const [open, setOpen] = useState<Kept | null>(null)
  const [busy, setBusy] = useState(false)
  const [say, setSay] = useState<string | null>(null)

  const moan = (why: string) => {
    setSay(why)
    window.setTimeout(() => setSay(null), 6000)
  }

  const load = useCallback(async () => {
    if (!authed) return
    const got = await myPictures()
    setKept(got.pictures)
    setUsed(got.used)
  }, [authed])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * ⚠️ `finally`, BECAUSE A THROW SKIPS THE LINE THAT UNGREYS THE BUTTON. This was a bare
   * `setBusy(true)` … `await` … `setBusy(false)`, and the await could reject — a cross-origin
   * `fetch` does exactly that. One rejection left the room with Keep it disabled permanently and
   * no message, which is worse than an error: an error says something went wrong, and a greyed
   * button says nothing at all while looking like a considered state.
   */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const drop = async (p: Kept) => {
    if (busy) return
    /* ⚠️ `confirm` is auto-dismissed in the Browser pane — see CLAUDE.md — so this is deliberately
       not behind one. Deleting a picture you can see the thumbnail of is a small, obvious act; the
       dangerous version would be deleting several at once, which this cannot do. */
    /* the same guard as `keep` above, for the same reason */
    setBusy(true)
    let bad: { why: string } | null
    try {
      bad = await dropPicture(p.id)
    } catch (e) {
      bad = { why: e instanceof Error ? e.message : 'that did not go' }
    } finally {
      setBusy(false)
    }
    if (bad) return moan(bad.why)
    await load()
  }

  if (!authed) {
    return (
      <div className="pics">
        <h2 className="section-title">Pictures</h2>
        <p className="muted">
          Pictures you keep, squeezed small before they leave the browser. Sign in to use it.
        </p>
      </div>
    )
  }

  return (
    <div className="pics">
      <h2 className="section-title">Pictures</h2>

      <AddPicture onKept={load} />

      {/**
       * ⚠️ THE ROOM KEEPS ITS OWN. Lifting the picker out took this line with it, and `drop` is
       * still here and can still fail — so for a moment a delete that the account refused did
       * nothing and said nothing, which is the one failure shape this file has already been
       * bitten by twice. The picker has a `say` of its own for its own errors; this one is for
       * the room's.
       */}
      {say ? (
        <p className="pics-say" role="status">
          {say}
        </p>
      ) : null}

      {kept === null ? (
        <p className="muted" aria-busy>
          Loading…
        </p>
      ) : kept.length === 0 ? (
        <p className="muted">Nothing kept yet. Choose a picture and it appears here.</p>
      ) : (
        <>
          <ul className="pics-grid">
            {kept.map((p) => (
              <li key={p.id} className="pics-one">
                {/* ⚠️ the THUMBNAIL, never the full picture. A grid of twenty full-size images is
                    the single biggest thing anybody gets wrong here — roughly ten times the
                    bytes, for pictures drawn two inches wide. */}
                {/**
                 * ⚠️ A BUTTON, BECAUSE THE PICTURE HAD NO WAY OF BEING SEEN. The grid draws a
                 * 155x140 thumbnail with `object-fit: cover`, so a portrait photograph — which
                 * is most photographs — was shown as a cropped landscape strip and there was
                 * nothing to press. Measured in the room: `thumbIsInteractive: NO`.
                 */}
                <button
                  className="pics-open"
                  onClick={() => setOpen(p)}
                  aria-label={p.alt ? `Look at ${p.alt}` : 'Look at this picture'}
                >
                  <img
                    className="pics-thumb"
                    src={p.thumbUrl}
                    alt={p.alt ?? ''}
                    width={p.w}
                    height={p.h}
                    loading="lazy"
                  />
                </button>
                <span className="pics-facts">
                  {/* ⚠️ THE SIZE AND THE SHAPE TOGETHER. Bytes alone cannot be judged — "922 KB"
                      says nothing about whether the squeeze worked without the dimensions beside
                      it, and the same photograph at two quality settings is 19 KB and 922 KB at
                      the identical 1024x1280. The pair is the thing that reads. */}
                  <span className="muted">
                    {sayBytes(p.bytes)} · {p.w}×{p.h}
                  </span>
                  <button
                    className="btn btn-ghost chron-x"
                    onClick={() => void drop(p)}
                    disabled={busy}
                    aria-label={p.alt ? `Delete ${p.alt}` : 'Delete this picture'}
                    title="Delete"
                  >
                    ✕
                  </button>
                </span>
                {/* ⚠️ the description is drawn, not only an alt attribute — a picture nobody can
                    describe to themselves is one they will not find again, and a tooltip does not
                    exist on a phone */}
                {p.alt ? <span className="pics-said">{p.alt}</span> : null}
              </li>
            ))}
          </ul>
          {/**
           * ⚠️ THE SERVER'S FIGURE, NOT THE LIST'S. This added up the `bytes` of the pictures on
           * screen, which is a different number from the one the ceiling is applied to: the list
           * holds only READY pictures and only their full-size bytes, while `picture_claim` counts
           * every row — unready claims from failed uploads included — and their thumbnails too.
           * Measured on the owner's account: the room said 942 KB where the ceiling had 5,724,752
           * spoken for, across five phantoms. A figure shown against a limit has to be the figure
           * the limit uses, or a refusal arrives at a number the screen calls fine.
           */}
          <p className="muted pics-used">
            {used ? used.count : kept.length} of {PICTURES_EACH} · {sayBytes(used ? used.bytes : 0)}{' '}
            of {sayBytes(PICTURE_BYTES_ALL)}
            {used && used.count > used.ready ? (
              <span className="muted">
                {' '}
                · {used.count - used.ready} half-finished{' '}
                {used.count - used.ready === 1 ? 'upload is' : 'uploads are'} still holding room,
                and clear within the hour
              </span>
            ) : null}
          </p>
        </>
      )}

      {/**
       * ⚠️ THE WHOLE PICTURE, WHICH THE ROOM COULD NOT SHOW AT ALL. `contain` rather than
       * `cover` here, the opposite of the grid: a thumbnail is a label and may be cropped to
       * stay tidy, but the thing you opened is the thing you want to see all of.
       *
       * ⚠️ IT IS THE FULL-SIZE URL, so this is also the only place the squeeze can be JUDGED —
       * the grid shows a 320px thumbnail, which looks fine at any quality.
       */}
      {open ? (
        <div
          className="pics-look"
          role="dialog"
          aria-modal="true"
          aria-label={open.alt ?? 'a picture'}
          onClick={() => setOpen(null)}
        >
          <img src={open.url} alt={open.alt ?? ''} />
          <p className="pics-look-say">
            {sayBytes(open.bytes)} · {open.w}×{open.h}
            {open.alt ? ` · ${open.alt}` : ''}
          </p>
          {/* ⚠️ a real button as well as the backdrop: tapping away is a convention people who
              know it use, and a thing nobody else can discover */}
          <button className="btn pics-shut" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  )
}
