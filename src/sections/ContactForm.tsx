import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react'
import { site } from '../config/site'

export function ContactForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const formRef = useRef<HTMLFormElement>(null)
  // When focusing fields on mobile, ensure the field is visible above keyboard
  useEffect(() => {
    const handler = (e: FocusEvent) => {
      const el = e.target as HTMLElement
      if (!formRef.current || !el || !(el instanceof HTMLElement)) return
      // Delay to wait for keyboard animation
      setTimeout(() => {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 120)
    }
    const node = formRef.current
    node?.addEventListener('focusin', handler)
    return () => node?.removeEventListener('focusin', handler)
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('sending')
    const data = new FormData(e.currentTarget)
    try {
      const endpoint = 'https://formspree.io/f/xeorpelp'
      const res = await fetch(endpoint, {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' },
        redirect: 'follow',
      })
      /**
       * ⚠️ This used to treat ANY completed request as success, and the catch below treated a
       * thrown network error as success too — so the form could not fail. The comment explaining
       * it said "no generic error message to avoid false negatives", which trades a POSSIBLE
       * false negative for a GUARANTEED silent true one: if Formspree is down or over its free
       * monthly quota, the sender is told the message arrived and it did not. On a page whose
       * job is letting people reach Evan, that is the expensive direction to be wrong in.
       *
       * `res.ok` is meaningful here because of the `Accept: application/json` header — that is
       * Formspree's documented AJAX mode, which answers with CORS headers and a real status
       * rather than an opaque redirect. If false failures ever DO appear, that assumption is
       * what to revisit.
       */
      if (!res.ok) {
        setStatus('error')
        return
      }
      setStatus('sent')
      e.currentTarget.reset()
      // Blur to close mobile keyboard after sending
      if (document.activeElement && 'blur' in document.activeElement) {
        try {
          ;(document.activeElement as HTMLElement).blur()
        } catch {
          /* noop */
        }
      }
    } catch (err) {
      // A throw here means the request never completed — no server saw it. Reporting that as
      // sent is how a message disappears with nobody any the wiser. The form is deliberately
      // NOT reset, so what they typed is still there to send again.
      console.warn('Contact form submit failed:', err)
      setStatus('error')
    }
  }

  // Re-enable the form after the user edits any field post-send to prevent spamming identical content
  useEffect(() => {
    const node = formRef.current
    if (!node) return
    const onAnyInput = () => {
      if (status === 'sent') setStatus('idle')
    }
    node.addEventListener('input', onAnyInput)
    return () => node.removeEventListener('input', onAnyInput)
  }, [status])

  return (
    <section className="card">
      <h2 className="section-title">Contact</h2>
      <p className="muted">
        Questions, ideas, or just to say hi — drop me a line and I’ll get back to you.
      </p>
      <form ref={formRef} onSubmit={onSubmit} style={formStyle}>
        {/* Honeypot field for spam bots; hidden from users */}
        <label style={{ position: 'absolute', left: '-10000px', height: 0, overflow: 'hidden' }}>
          <span>Leave this field empty</span>
          <input name="_gotcha" tabIndex={-1} autoComplete="off" />
        </label>
        <label style={labelStyle}>
          <span>Name</span>
          <input name="name" placeholder="Your name" required style={fieldStyle} inputMode="text" />
        </label>
        <label style={labelStyle}>
          <span>Email</span>
          <input
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            style={fieldStyle}
            inputMode="email"
          />
        </label>
        <label style={labelStyle}>
          <span>Message</span>
          <textarea
            name="message"
            placeholder="Your message"
            rows={5}
            required
            style={fieldStyle}
          />
        </label>
        <button
          className="btn"
          // only 'sending' and 'sent' lock the button; after an error you must be able to retry
          disabled={status === 'sending' || status === 'sent'}
          style={{ minHeight: 44 }}
        >
          {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Sent' : 'Send'}
        </button>
        {status === 'sent' && (
          <div style={{ color: 'var(--accent)' }} aria-live="polite">
            Thanks! I will get back to you.
          </div>
        )}
        {/* Says it did not send, keeps what they typed, and gives another way through — a dead
            end here means the message is simply lost. */}
        {status === 'error' && (
          <div aria-live="polite" style={{ fontSize: '0.88rem' }}>
            That didn&apos;t send — nothing has been lost, your message is still in the form. Try
            again in a moment, or reach me on{' '}
            <a href={site.socials.linkedin} target="_blank" rel="noreferrer">
              LinkedIn
            </a>
            .
          </div>
        )}
      </form>
    </section>
  )
}

const fieldStyle: CSSProperties = {
  background: 'var(--control-bg)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '0.85rem 0.95rem',
  color: 'var(--text)',
  fontSize: '16px',
  width: '100%',
}

const formStyle: CSSProperties = {
  display: 'grid',
  gap: '0.85rem',
  maxWidth: 560,
  width: '100%',
}

const labelStyle: CSSProperties = {
  display: 'grid',
  gap: '0.4rem',
  fontSize: '0.95rem',
}
