import { useState } from 'react'

/**
 * The box you type a message into, and Send.
 *
 * Its own component because there are two of it now — under a conversation in Chat and in the
 * call anchor's panel — and each keeps its own draft: half a sentence typed on the anchor is not
 * something that should appear under a different thread.
 *
 * `onSend` resolves to what went wrong, or null. The draft is cleared only on null, so a refused
 * message is still in the box to fix or try again rather than gone.
 */
export function Composer({
  placeholder,
  onSend,
  autoFocus = false,
}: {
  placeholder: string
  onSend: (text: string) => Promise<string | null>
  /** take the focus on mounting: the call's panel, when it was opened from somewhere far from it */
  autoFocus?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setErr(null)
    const problem = await onSend(text)
    setSending(false)
    if (problem) setErr(problem)
    else setDraft('')
  }

  return (
    <>
      {err && (
        <p className="muted cz-chat-err" role="alert">
          {err}
        </p>
      )}
      <form className="cz-chat-form" onSubmit={(e) => void submit(e)}>
        <input
          autoFocus={autoFocus}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          maxLength={2000}
        />
        <button className="btn" disabled={!draft.trim() || sending} type="submit">
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </>
  )
}
