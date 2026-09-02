import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react'
import { site } from '../config/site'
import { getSupabaseClient } from '../finance/client'

/** Must stay in step with the length() guard in submit_contact_message. */
const MESSAGE_MAX = 5000

export function ContactForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  /** how much has been written, so the counter can appear only when it is close to mattering */
  const [typed, setTyped] = useState(0)
  /** what the form service said went wrong, when it said anything */
  const [why, setWhy] = useState('')
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
    setWhy('')
    const data = new FormData(e.currentTarget)
    const form = e.currentTarget
    /**
     * ⚠️ THE MESSAGE LANDS IN OUR OWN DATABASE FIRST, AND THAT IS WHAT DECIDES WHAT WE SAY.
     *
     * It used to go only to Formspree, so "did this reach Evan?" was entirely a question about
     * somebody else's free tier — 50 submissions a month, spam filtering, and an outage nobody
     * here would ever hear about. That is a poor thing to hang a stranger's first impression on,
     * and it is why some test messages arrived and others didn't.
     *
     * Now: store it, then ping the inbox. If the ping fails the message is already safe, so the
     * sender is told it arrived — because it did. If the STORE fails, that is a real failure and
     * gets said plainly.
     */
    try {
      const { error } = await getSupabaseClient().rpc('submit_contact_message', {
        p_name: String(data.get('name') ?? ''),
        p_email: String(data.get('email') ?? ''),
        p_body: String(data.get('message') ?? ''),
      })
      if (error) {
        setWhy(error.message)
        setStatus('error')
        return
      }
    } catch (err) {
      console.warn('Contact store failed:', err)
      setWhy('The request never reached the site — check your connection.')
      setStatus('error')
      return
    }

    setStatus('sent')
    form.reset()
    // Blur to close mobile keyboard after sending
    if (document.activeElement && 'blur' in document.activeElement) {
      try {
        ;(document.activeElement as HTMLElement).blur()
      } catch {
        /* noop */
      }
    }

    /**
     * The email ping, best-effort and deliberately AFTER the answer.
     *
     * Nothing below this line may change what the sender was told: the message is stored, so it
     * arrived whatever Formspree thinks. Kept because an email is how Evan actually finds out
     * quickly; the Admin inbox is the record.
     */
    try {
      const endpoint = 'https://formspree.io/f/xeorpelp'
      const res = await fetch(endpoint, {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' },
        redirect: 'follow',
      })
      if (!res.ok) console.warn('Contact notification not sent:', res.status)
    } catch (err) {
      // The notification, not the message. Nothing to tell the sender about.
      console.warn('Contact notification failed:', err)
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
        {/**
         * ⚠️ The caps match submit_contact_message exactly — 200, 320 and 5000. The server refuses
         * anything longer with "that is longer than this form accepts", which does not say WHICH
         * field or by how much, and you would only find out after writing the whole thing. Setting
         * them here makes that refusal unreachable rather than merely survivable.
         */}
        <label style={labelStyle}>
          <span>Name</span>
          <input
            name="name"
            placeholder="Your name"
            required
            maxLength={200}
            style={fieldStyle}
            inputMode="text"
          />
        </label>
        <label style={labelStyle}>
          <span>Email</span>
          <input
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            maxLength={320}
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
            maxLength={MESSAGE_MAX}
            style={fieldStyle}
            onChange={(e) => setTyped(e.target.value.length)}
          />
          {/* only near the end: a counter on an empty box is clutter, and 5000 characters is far
              more than anyone writing a note here will use */}
          {typed > MESSAGE_MAX - 500 && (
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              {MESSAGE_MAX - typed} characters left
            </span>
          )}
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
            That didn&apos;t send — nothing has been lost, your message is still in the form.
            {why && (
              <>
                {' '}
                <span className="muted">({why})</span>
              </>
            )}{' '}
            Try again in a moment, or reach me on{' '}
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
