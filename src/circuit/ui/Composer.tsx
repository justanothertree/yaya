import { useState } from 'react'
import { useKeptDraft } from '../../drafts/useKeptDraft'

/**
 * The box you type a message into, and Send.
 *
 * Its own component because there are two of it now — under a conversation in Chat and in the
 * call anchor's panel — and each keeps its own draft: half a sentence typed on the anchor is not
 * something that should appear under a different thread.
 *
 * `onSend` resolves to what went wrong, or null. The draft is cleared only on null, so a refused
 * message is still in the box to fix or try again rather than gone.
 *
 * ⚠️ AND IT OUTLIVES A RELOAD when it is given `keep`: what is typed and not yet sent is kept on
 * this device for the person signed in, put back into the box on the way in, and gone once it is
 * sent — the protection Paint got after a minion was lost to a pull-to-refresh (useKeptDraft).
 * One per conversation. The call's box keeps none: it sends to whichever room or call you are in at
 * the moment, so one key would bring one call's words back in the next, to other people (found in
 * review), and a key per call is not something it can know.
 */
/** the box's own limit, and the bound on a kept draft read back */
const MAX_MESSAGE = 2000

export function Composer({
  placeholder,
  onSend,
  autoFocus = false,
  keep,
  canSend = true,
}: {
  placeholder: string
  onSend: (text: string) => Promise<string | null>
  /** take the focus on mounting: the call's panel, when it was opened from somewhere far from it */
  autoFocus?: boolean
  /** where its unsent words are kept across a reload — one key per conversation; absent keeps none */
  keep?: string
  /** false holds Send (and Enter) while typing stays open — the Lounge, until your name there is known */
  canSend?: boolean
}) {
  const [draft, setDraft] = useState('')
  const kept = useKeptDraft({
    kind: 'chat',
    scope: keep,
    value: draft,
    isEmpty: (v) => !v.trim(),
    parse: (raw) => (typeof raw === 'string' ? raw.slice(0, MAX_MESSAGE) : null),
    restore: setDraft,
    on: !!keep,
  })
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending || !canSend) return
    setSending(true)
    setErr(null)
    const problem = await onSend(text)
    setSending(false)
    if (problem) setErr(problem)
    else {
      setDraft('')
      /* ⚠️ AND ITS KEPT COPY, NOW — not by the emptied box, which never renders if the box was
         closed while the message was in flight. Its unmount had already written the words down,
         so without this they came back into the box after they were sent (found in review). */
      kept.markSaved()
    }
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
          maxLength={MAX_MESSAGE}
        />
        <button className="btn" disabled={!draft.trim() || sending || !canSend} type="submit">
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </>
  )
}
