import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * A photograph at full size, over everything.
 *
 * ⚠️ PORTALLED TO `document.body`, AND `position: fixed` ALONE IS NOT ENOUGH. The Feed's own
 * lightbox was a fixed, full-inset overlay with no portal — correct-looking code that opened
 * off-screen, because `CircuitCanvas` puts the feed inside an element carrying
 * `transform: worldTransform(pan, view)`. A transformed ancestor becomes the containing block for
 * `position: fixed`, so "inset: 0" meant the whole scrolled feed rather than the viewport. Scroll
 * down a long feed, tap a photo, and the viewer opens somewhere above the fold.
 *
 * ⚠️ AND IT WAS UNREACHABLE UNTIL YESTERDAY, which is why nobody had seen it. The only way into
 * that lightbox was `log.img &&` — a column with 0 of 708 rows populated and no writer anywhere,
 * so the branch never rendered and the bug sat dormant. Making `log.picture` resolve turned a
 * latent bug into a live one in the same change, which is the §2 case exactly: look for what a
 * change just made reachable, not only for what it made stale.
 *
 * ⚠️ ESCAPE IS CAPTURED, so opening a photo from inside a Modal and pressing Escape closes the
 * PHOTO and not the dialog behind it. Modal listens on `window` in the bubble phase; this listens
 * on `window` in the CAPTURE phase, which runs first, and stops propagation there. Without that,
 * one Escape would shut the rating editor too and lose whatever was typed in it.
 */
export function PhotoViewer({
  src,
  alt,
  onClose,
}: {
  src: string
  alt?: string | null
  onClose: () => void
}) {
  /* the Modal note's lesson, for the same reason: every caller passes an inline arrow, so an
     effect that depends on `onClose` re-runs on every keystroke of whatever is behind it */
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt?.trim() ? alt : 'Photograph, full size'}
      onClick={() => closeRef.current()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'zoom-out',
        /* above Modal's 1000 — a photo opened from inside a dialog sits over it */
        zIndex: 1600,
        padding: 16,
      }}
    >
      <img
        src={src}
        alt={alt ?? ''}
        style={{ maxWidth: '94vw', maxHeight: '92vh', borderRadius: 10, display: 'block' }}
      />
    </div>,
    document.body,
  )
}
