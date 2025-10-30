import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from 'react'

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
      })
      const ct = res.headers.get('content-type') || ''
      let ok = res.ok
      // Treat 2xx and 3xx as success (Formspree can redirect on success)
      if (!ok && res.status >= 200 && res.status < 400) ok = true
      // If JSON present, prefer the explicit ok/success flags
      if (ct.includes('application/json')) {
        try {
          const json = await res.json()
          if (json && (json.ok === true || json.success === true)) ok = true
        } catch {
          // ignore JSON parse errors and fall back
        }
      }
      if (ok) {
        setStatus('sent')
        e.currentTarget.reset()
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="card">
      <h2 className="section-title">Contact</h2>
      <p className="muted">
        This form posts to Formspree. Replace the endpoint in <code>ContactForm.tsx</code>.
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
        <button className="btn" disabled={status === 'sending'} style={{ minHeight: 44 }}>
          {status === 'sending' ? 'Sending…' : 'Send'}
        </button>
        {status === 'sent' && (
          <div style={{ color: '#22c55e' }}>Thanks! I will get back to you.</div>
        )}
        {status === 'error' && (
          <div style={{ color: '#ef4444' }}>Something went wrong. Try again later.</div>
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
