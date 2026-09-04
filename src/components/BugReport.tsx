import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

/**
 * Telling me something is broken, from wherever it broke.
 *
 * ⚠️ THE POINT IS THAT IT COSTS NOTHING TO REPORT. A bug you have to remember until you are next
 * near a keyboard is a bug that gets reported as "something went weird on one of the pages", if
 * it gets reported at all. So this opens from the menu on every page, keeps what you typed if you
 * close it by accident, and fills in the part nobody can be expected to write down — which page,
 * how big the window was, which browser.
 *
 * ⚠️ EVERYTHING IT WILL SEND IS SHOWN BEFORE IT SENDS IT. Collecting the browser and the page
 * quietly would be the normal thing to do and is exactly the wrong thing on a site whose whole
 * premise is that you can see what it does with your data. It is a short list, it is on screen,
 * and nothing else goes with it.
 */
export function BugReport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  /* what was happening, gathered when the dialog opens rather than when it sends: by the time you
     have finished typing you may have resized the window or navigated away */
  const [ctx, setCtx] = useState({ route: '', size: '', browser: '' })
  useEffect(() => {
    if (!open) return
    setDone(false)
    setErr(null)
    setCtx({
      route: location.hash.replace(/^#/, '') || 'home',
      size: `${window.innerWidth}×${window.innerHeight}`,
      /* ⚠️ the engine, not the full user-agent string: the full one is a fingerprint and the
         part that ever helps is which browser it was */
      browser: /Firefox\//.test(navigator.userAgent)
        ? 'Firefox'
        : /Edg\//.test(navigator.userAgent)
          ? 'Edge'
          : /Chrome\//.test(navigator.userAgent)
            ? 'Chrome'
            : /Safari\//.test(navigator.userAgent)
              ? 'Safari'
              : 'other',
    })
  }, [open])

  if (!open) return null

  const send = async () => {
    const body = text.trim()
    if (body.length < 4 || sending) return
    setSending(true)
    setErr(null)
    const { error } = await getSupabaseClient()
      .from('bug_report')
      .insert({
        body: body.slice(0, 2000),
        route: ctx.route.slice(0, 80),
        viewport: ctx.size.slice(0, 20),
        browser: ctx.browser,
      })
    setSending(false)
    if (error) {
      setErr(error.message.slice(0, 160))
      return
    }
    setDone(true)
    setText('')
  }

  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div
        className="card bug-card"
        role="dialog"
        aria-modal="true"
        aria-label="Report a bug"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>Something broken?</h3>
        {done ? (
          <>
            <p className="muted">Got it — thank you. It landed with the page you were on.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              What happened? What did you expect instead?
            </p>
            <textarea
              className="bug-text"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 2000))}
              rows={5}
              autoFocus
              placeholder="The note editor put the note a row above where I clicked…"
            />
            <p className="muted bug-ctx">
              Sent with this: page <strong>{ctx.route}</strong>, window <strong>{ctx.size}</strong>,{' '}
              <strong>{ctx.browser}</strong>. Nothing else.
            </p>
            {err && <p className="bug-err">{err}</p>}
            <div className="row" style={{ justifyContent: 'flex-end', gap: '0.4rem' }}>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={send}
                disabled={text.trim().length < 4 || sending}
              >
                {sending ? 'Sending…' : 'Send it'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
