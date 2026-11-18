import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { LINE_MAX } from './chat'

/** one line as the HUD shows it: who said it, whether it was you, and what */
export type HudLine = { key: string | number; who: string; mine: boolean; text: string }

/* ⚠️ WIDE, IT FLOATS; NARROW, IT SITS IN THE PAGE. The snake games' chat is a fixed panel in the
   corner, which on a phone covers the bottom of a board game's board — the one part of a Lab toy
   you cannot afford to lose. So below the grid's own breakpoint (700px, CLAUDE.md §6) it is in the
   flow under the match bar or the table, and from there up it floats like the snake games' — in
   the right-hand corner, since a wide page's board sits on the left — over the call dock when
   there is one. Portalled when floating: a transformed ancestor (every room's
   .reveal) would otherwise make `fixed` mean "fixed to the room". */
const WIDE = '(min-width: 700px)'
const wideNow = () => window.matchMedia(WIDE).matches
const onWide = (fn: () => void) => {
  const m = window.matchMedia(WIDE)
  m.addEventListener('change', fn)
  return () => m.removeEventListener('change', fn)
}

/**
 * The chat for a match, the same on every multiplayer toy, by turns or live in a call: the lines
 * so far and a box to write in. It is faded until something happens — a line arriving, you typing,
 * the pointer on it — and never fully invisible, as the snake games' is. What travels, who may
 * read it and what is kept is the caller's business (useMatchChat by turns, CallChat live).
 */
export function ChatHud({
  lines,
  onSend,
  label,
  error,
  busy = false,
  empty,
}: {
  lines: HudLine[]
  /** send a line: true once it has gone, so the box is cleared only then */
  onSend: (text: string) => Promise<boolean> | boolean
  label: string
  error?: string | null
  busy?: boolean
  /** what the log says before anybody has said anything */
  empty: string
}) {
  const wide = useSyncExternalStore(onWide, wideNow, () => false)
  const [draft, setDraft] = useState('')
  const [live, setLive] = useState(false)
  const fade = useRef<number | undefined>(undefined)
  const log = useRef<HTMLDivElement | null>(null)
  const stick = useRef(true)
  const wake = useCallback(() => {
    setLive(true)
    window.clearTimeout(fade.current)
    fade.current = window.setTimeout(() => setLive(false), 6000)
  }, [])
  useEffect(() => () => window.clearTimeout(fade.current), [])

  // a new line wakes the panel, and the log follows it down unless you have scrolled up to read
  const count = lines.length
  useEffect(() => {
    if (count) wake()
    const el = log.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [count, wake])

  const send = async () => {
    const text = draft.trim()
    if (!text || busy) return
    if (await onSend(text)) setDraft('')
  }

  const panel = (
    <section
      className={'lab-chat' + (wide ? ' is-floating' : '') + (live ? ' is-live' : '')}
      aria-label={label}
    >
      <div
        className="lab-chat-log"
        ref={log}
        aria-live="polite"
        onScroll={() => {
          const el = log.current
          if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {lines.length === 0 ? (
          <p className="muted lab-chat-empty">{empty}</p>
        ) : (
          lines.map((l) => (
            <p key={l.key} className={'lab-chat-line' + (l.mine ? ' is-mine' : '')}>
              <b>{l.who}:</b> {l.text}
            </p>
          ))
        )}
      </div>
      <form
        className="lab-chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input
          value={draft}
          onFocus={wake}
          onChange={(e) => {
            setDraft(e.target.value)
            wake()
          }}
          onKeyDown={(e) => {
            // a board's own keys stay the board's: nothing typed here reaches the toy
            e.stopPropagation()
            if (e.key === 'Escape') {
              setDraft('')
              e.currentTarget.blur()
            }
          }}
          maxLength={LINE_MAX}
          placeholder="Say something…"
          aria-label={`${label}: your line`}
        />
        <button className="btn btn-ghost" type="submit" disabled={busy || !draft.trim()}>
          Send
        </button>
      </form>
      {error && (
        <p className="lab-warn lab-chat-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
  return wide ? createPortal(panel, document.body) : panel
}
