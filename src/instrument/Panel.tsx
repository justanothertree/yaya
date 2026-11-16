import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDialogContract } from '../ui/dialogContract'
import { useMediaQuery } from '../ui/media'

/**
 * Where the menu is a sheet rather than a side panel: a phone, and a tablet too.
 *
 * ⚠️ NOT THE ROOM'S 700px BREAKPOINT, which this first used, and the measurement is why. Above
 * 700 the room lays itself out for a desktop — a part's row carries its volume, its bars, its mute
 * and its ⋯ on one line — and a side panel has to leave it the width that needs. At 820 the panel
 * left the room 372px: a part's bar strip measured 0px wide and its ⋯ sat 34px past the row's own
 * edge, under the panel. Below 1200 the menu is the sheet (a wide card on a tablet), and the room
 * keeps its whole width underneath.
 */
export const PANEL_IS_SHEET = '(max-width: 1199px)'

/**
 * A part's menu, and the song's lyrics: a sheet from the floor on a phone, a panel down the right
 * side wider up — Evan, 15 Nov 2026: "a sheet on phone, a panel on desktop", instead of the notes
 * opening at the bottom of the room.
 *
 * ⚠️ THE PANEL IS NOT MODAL, AND THAT IS THE DIFFERENCE THAT MATTERS. On a desktop the keys, the
 * transport and the other parts stay where they are and stay pressable: you edit a part while it
 * plays, tap the next part to move the panel to it, and play the keyboard to find a note (the
 * roll lights the row you are holding). A modal card would cover the very things you check an edit
 * against. So it has no backdrop, does not trap Tab, and says `aria-modal="false"`.
 *
 * ⚠️ THE SHEET IS MODAL, because on a phone it covers the room anyway — it is the same contract
 * as the room's other sheets (Sheet.tsx): Escape, a trapped Tab, focus back to the opener.
 *
 * ⚠️ ESCAPE CAN BELONG TO WHAT IS INSIDE. The piano roll uses Escape to drop a selection and then
 * to leave its select tool before it closes anything, and it listens on window as this does — so
 * `escape` lets the content keep it: return false and this panel stays open. (Both listeners hear
 * the key; the order they were registered in is not something to build on, so the decision is
 * asked rather than raced.)
 *
 * ⚠️ PORTALLED TO THE BODY, for the reason Sheet gives: `position: fixed` inside a transformed
 * ancestor measures from that ancestor.
 */
export function Panel({
  title,
  detail,
  onClose,
  escape,
  className = '',
  label,
  children,
}: {
  title: ReactNode
  /** a smaller second line under the title */
  detail?: ReactNode
  onClose: () => void
  /** asked on Escape: false means the content has used it, so stay open */
  escape?: () => boolean
  className?: string
  /** an accessible name when the title is not text */
  label?: string
  children: ReactNode
}) {
  const sheet = useMediaQuery(PANEL_IS_SHEET)
  const box = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const close = () => {
    if (escape && !escape()) return
    onClose()
  }
  useDialogContract(box, close, sheet)
  useSidePanel(box, close, !sheet)
  useBeside(!sheet)

  const body = (
    <div
      ref={box}
      className={(sheet ? 'inst-sheet inst-panel-sheet ' : 'inst-panel ') + className}
      role="dialog"
      aria-modal={sheet ? 'true' : 'false'}
      aria-labelledby={label ? undefined : titleId}
      aria-label={label}
      tabIndex={-1}
    >
      <div className="inst-sheet-head inst-panel-head">
        <h3 id={titleId}>
          {title}
          {detail && <small className="muted inst-panel-detail">{detail}</small>}
        </h3>
        <button className="btn btn-ghost inst-sheet-x" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {children}
    </div>
  )
  return createPortal(
    sheet ? (
      <div
        className="inst-sheet-back"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        {body}
      </div>
    ) : (
      body
    ),
    document.body,
  )
}

/**
 * Where the side panel goes, so it covers nothing anybody presses.
 *
 * ⚠️ OVER THE VISUALS, OR BESIDE THE ROOM — measured, not guessed at with a width. On a desktop
 * with the visuals showing, the room is two columns (see .inst-wrap.has-visuals): the keys, the
 * transport and the parts on the left, the visuals sticky on the right. The panel takes exactly
 * that right-hand column, so everything you press stays in view. Measured at 1440 before this: a
 * fixed `54vw` panel started at x=652 while the room's own column ran to x=810, so it sat over the
 * parts' mutes and the top of the keyboard. With the visuals hidden there is one column the width
 * of the page, and the panel takes its share by pushing it over rather than covering it.
 *
 * Both are worked out from the page as it stands and again whenever it changes size, because the
 * column is a `minmax` of rem against a fluid root (CLAUDE.md §6): no constant would agree with it.
 */
function useBeside(enabled: boolean) {
  useLayoutEffect(() => {
    if (!enabled) return
    const root = document.documentElement
    const main = document.querySelector<HTMLElement>('main')
    const fit = () => {
      const vw = root.clientWidth
      const theatre = document.querySelector<HTMLElement>(
        '.inst-wrap.has-visuals:not(.is-incanvas) > .inst-theatre',
      )
      if (main) main.style.paddingRight = ''
      if (theatre) {
        root.style.setProperty(
          '--inst-panel-w',
          `${Math.max(320, vw - theatre.getBoundingClientRect().left + 6)}px`,
        )
        return
      }
      root.style.removeProperty('--inst-panel-w')
      const wrap = document.querySelector<HTMLElement>('.inst-wrap:not(.is-incanvas)')
      const panel = document.querySelector<HTMLElement>('.inst-panel')
      if (!main || !wrap || !panel) return
      /* the room's right edge, as it is with nothing pushing it — then just enough to clear */
      const clear = wrap.getBoundingClientRect().right - panel.getBoundingClientRect().left + 16
      /* ⚠️ ON TOP OF the page's own padding — setting it outright replaced that, and the room
         came up 5px short of clearing the panel at 1440 */
      const own = parseFloat(getComputedStyle(main).paddingRight) || 0
      if (clear > 0) main.style.paddingRight = `${own + clear}px`
    }
    fit()
    window.addEventListener('resize', fit)
    /* the visuals shown or hidden changes which of the two this is */
    const theatre = document.querySelector('.inst-theatre')
    const ro = new ResizeObserver(fit)
    if (theatre) ro.observe(theatre)
    return () => {
      window.removeEventListener('resize', fit)
      ro.disconnect()
      root.style.removeProperty('--inst-panel-w')
      if (main) main.style.paddingRight = ''
    }
  }, [enabled])
}

/**
 * The side panel's half of the dialog contract: focus moves in when it opens, Escape closes it,
 * and focus goes back to whatever opened it — but Tab is NOT trapped, because the page beside it
 * is meant to be used.
 */
function useSidePanel(
  box: React.RefObject<HTMLDivElement | null>,
  onEscape: () => void,
  enabled: boolean,
) {
  const escRef = useRef(onEscape)
  escRef.current = onEscape
  useEffect(() => {
    if (!enabled) return
    const opener = document.activeElement as HTMLElement | null
    const el = box.current
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') escRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const active = document.activeElement
      const loose = !active || active === document.body || !!el?.contains(active)
      if (loose && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [box, enabled])
}
