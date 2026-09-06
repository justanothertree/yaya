/**
 * One line telling you this room has a second, shared half.
 *
 * ⚠️ THE ROOMS THAT CAN BE SHARED ONLY SAID SO ONCE YOU WERE ALREADY SHARING. Paint's "draw
 * together" switch and the instrument's "play together" switch are both rendered behind
 * `call.inCall`, so with no call in progress there is nothing on the page — not a greyed-out
 * button, not a sentence — to suggest either room does anything with other people. You would
 * have to already know, which is the definition of a feature nobody finds.
 *
 * ⚠️ It says where to go, not just what exists. "You can draw together" with no next step is a
 * tease; a call starts in a conversation, so the line ends in the link that starts one.
 *
 * ⚠️ Dismissible, and it stays dismissed. This is a signpost, and a signpost you have read twice
 * is clutter — which is how a helpful hint turns into the thing everybody wants removed. One
 * key per room, so putting Paint's away leaves the instrument's alone for whenever you get
 * there.
 */
import { useState } from 'react'

export function AlsoTogether({
  id,
  children,
}: {
  /** where the dismissal is remembered — one per room */
  id: string
  /** the sentence, in this room's own words */
  children: React.ReactNode
}) {
  const key = `also_together_${id}_v1`
  const [gone, setGone] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  if (gone) return null
  return (
    <p className="also-together muted">
      <span>👋 {children}</span>
      <a
        className="also-together-go"
        href="#chat"
        onClick={(e) => {
          e.preventDefault()
          window.location.hash = 'chat'
        }}
      >
        Start a call
      </a>
      <button
        className="also-together-x"
        aria-label="Got it — stop showing this here"
        title="Got it"
        onClick={() => {
          setGone(true)
          try {
            localStorage.setItem(key, '1')
          } catch {
            /* private mode: it holds for this visit */
          }
        }}
      >
        ✕
      </button>
    </p>
  )
}
