import { useState, type FormEvent, type CSSProperties } from 'react'

export function ContactForm() {
  const [status, setStatus] = useState<'idle'|'sending'|'sent'|'error'>('idle')

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('sending')
    const data = new FormData(e.currentTarget)
    try {
      const endpoint = 'https://formspree.io/f/xeorpelp'
      const res = await fetch(endpoint, { method: 'POST', body: data, headers: { 'Accept': 'application/json' } })
      if (res.ok) setStatus('sent'); else setStatus('error')
      e.currentTarget.reset()
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="card">
      <h2 className="section-title">Contact</h2>
      <p className="muted">This form posts to Formspree. Replace the endpoint in <code>ContactForm.tsx</code>.</p>
      <form onSubmit={onSubmit} style={{display:'grid', gap:'0.75rem', maxWidth: 520}}>
        <input name="name" placeholder="Your name" required style={fieldStyle} />
        <input name="email" type="email" placeholder="Your email" required style={fieldStyle} />
        <textarea name="message" placeholder="Your message" rows={5} required style={fieldStyle} />
        <button className="btn" disabled={status==='sending'}>
          {status==='sending' ? 'Sending…' : 'Send'}
        </button>
        {status==='sent' && <div style={{color:'#22c55e'}}>Thanks! I will get back to you.</div>}
        {status==='error' && <div style={{color:'#ef4444'}}>Something went wrong. Try again later.</div>}
      </form>
    </section>
  )
}

const fieldStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  padding: '0.7rem 0.8rem',
  color: 'var(--text)'
}
