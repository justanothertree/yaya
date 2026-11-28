/**
 * A read that failed, said as one: "Couldn't load your nicknames. Retry".
 *
 * ⚠️ NEVER AN EMPTY STATE. supabase-js answers a failure with `data: null` instead of throwing,
 * and the 27 Nov 2026 audit (docs/2026-11-27-supabase-failure-audit.md) found that reading that
 * null as "nothing there" is not only a wrong screen: an editor that loads blank from an error
 * will SAVE the blank. A friends list wiped down to one, a rating's review erased, a member's
 * nicknames gone — each one a blip followed by an ordinary press of Save. So a surface that
 * renders this must also refuse to save until a read has succeeded; the words are the half
 * people see, the disabled Save is the half that protects them.
 */
export function CouldNotLoad({
  what,
  onRetry,
  retrying = false,
}: {
  /** what failed to load, as it would follow "Couldn't load": "your nicknames" */
  what: string
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <p className="muted could-not-load" role="alert">
      Couldn’t load {what}.{' '}
      <button type="button" className="btn btn-ghost" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </p>
  )
}
