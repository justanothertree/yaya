import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDialogContract } from '../ui/dialogContract'

/**
 * A sheet for the instrument's set-once settings: ⚙ Sound, the song's speed and length, and a
 * part's ⋯ — the #311 layout, 14 Nov 2026. From the floor on a phone, a centred card wider up.
 *
 * ⚠️ PORTALLED TO THE BODY, for the reason the settings sheet gives: `position: fixed` inside a
 * transformed ancestor (a canvas window, the zoomed main) measures from that ancestor, and the
 * sheet would hang somewhere in the page instead of resting on the floor.
 *
 * ⚠️ THE KEYS STILL PLAY UNDER IT. The dialog contract listens on window for Escape and Tab and
 * stops nothing else, so the room's own keyboard listener still hears every letter — you can turn
 * the echo up and press Z to hear it, which is how the effects were tuned when they sat inline.
 * Typing into a text box in here does not play, by the room's own rule about text entry.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  useDialogContract(box, onClose)
  return createPortal(
    <div
      className="inst-sheet-back"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={box}
        className="inst-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="inst-sheet-head">
          <h3 id={titleId}>{title}</h3>
          <button className="btn btn-ghost inst-sheet-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
