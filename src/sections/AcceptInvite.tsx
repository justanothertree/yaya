import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

function getTokenFromHash(): string | null {
  const qs = window.location.hash.split('?')[1] ?? ''
  return new URLSearchParams(qs).get('token')
}

type InviteInfo = { label: string | null; is_used: boolean }

export function AcceptInvite() {
  const sb = getSupabaseClient()
  const token = getTokenFromHash()

  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [needsConfirm, setNeedsConfirm] = useState(false)

  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const { data, error: e } = await sb.rpc('get_invite_by_token', { p_token: token })
        if (e) throw e
        const row = Array.isArray(data) ? data[0] : data
        setInvite((row as InviteInfo) ?? null)
      } catch (e: unknown) {
        setError(String((e as { message?: string })?.message ?? e))
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      setError('Username must be 3–20 characters: letters, numbers, or underscores only.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const { data: signUpData, error: signUpErr } = await sb.auth.signUp({
        email,
        password,
        options: { data: { full_name: displayName } },
      })
      if (signUpErr) throw signUpErr

      if (signUpData.session) {
        // Email confirmation disabled — signed in immediately
        const { error: rpcErr } = await sb.rpc('complete_member_signup', {
          p_token: token,
          p_username: username,
          p_display_name: displayName,
          p_contact_email: email,
        })
        if (rpcErr) throw rpcErr
        setDone(true)
      } else {
        // Email confirmation is on — user must confirm before profile can be saved
        setNeedsConfirm(true)
      }
    } catch (e: unknown) {
      setError(String((e as { message?: string })?.message ?? e))
    } finally {
      setSubmitting(false)
    }
  }

  if (!token)
    return (
      <div>
        <h2 style={{ marginTop: 0 }}>Invalid invite</h2>
        <p className="muted">
          No invite token in this link. Ask your host to send you a fresh invite link.
        </p>
      </div>
    )

  if (loading) return <p className="muted">Checking invite…</p>

  if (!invite)
    return (
      <div>
        <h2 style={{ marginTop: 0 }}>Invite not found</h2>
        <p className="muted">
          This invite link is invalid or expired. Ask your host for a new one.
        </p>
      </div>
    )

  if (invite.is_used)
    return (
      <div>
        <h2 style={{ marginTop: 0 }}>Already claimed</h2>
        <p className="muted">
          This invite has already been used.{' '}
          <a
            href="#signin"
            onClick={() => {
              window.location.hash = 'signin'
            }}
          >
            Sign in
          </a>{' '}
          or ask your host for a new link.
        </p>
      </div>
    )

  if (needsConfirm)
    return (
      <div style={{ maxWidth: 460 }}>
        <h2 style={{ marginTop: 0 }}>Check your email</h2>
        <p>
          We sent a confirmation link to <strong>{email}</strong>. Click it to verify your address,
          then come back here to sign in.
        </p>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          After confirming, your username and profile will be saved on first sign-in.
        </p>
        <a
          href="#signin"
          onClick={() => {
            window.location.hash = 'signin'
          }}
          className="btn"
        >
          Go to sign in
        </a>
      </div>
    )

  if (done)
    return (
      <div style={{ maxWidth: 460 }}>
        <h2 style={{ marginTop: 0 }}>
          {invite.label ? `Welcome, ${invite.label}!` : "You're in!"}
        </h2>
        <p>Your account is set up and you're signed in.</p>
        <a
          href="#circuit"
          onClick={() => {
            window.location.hash = 'circuit'
          }}
          className="btn"
          style={{ background: 'var(--accent,#7c6af7)', color: '#fff', borderColor: 'transparent' }}
        >
          Go to The Circuit
        </a>
      </div>
    )

  return (
    <div style={{ maxWidth: 460 }}>
      <h2 style={{ marginTop: 0 }}>
        {invite.label ? `Hey ${invite.label}!` : 'Create your account'}
      </h2>
      <p className="muted" style={{ marginBottom: '1.25rem', fontSize: '0.88rem' }}>
        You've been invited to join. Pick a username and fill in your info — takes 30 seconds.
      </p>

      {error && (
        <p style={{ color: '#f46b6b', marginBottom: '0.75rem', fontSize: '0.9rem' }}>{error}</p>
      )}

      <form onSubmit={(e) => void submit(e)} style={{ display: 'grid', gap: '0.8rem' }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            Username{' '}
            <span style={{ opacity: 0.5 }}>
              (public · 3–20 chars · letters, numbers, underscores)
            </span>
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            placeholder="pick a username"
            autoComplete="username"
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            Your name <span style={{ opacity: 0.5 }}>(what we call you)</span>
          </span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            placeholder="your first name"
            autoComplete="given-name"
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            Email <span style={{ opacity: 0.5 }}>(for account recovery — not shared publicly)</span>
          </span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            Password
          </span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            type="password"
            autoComplete="new-password"
            placeholder="at least 8 characters"
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            Confirm password
          </span>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            type="password"
            autoComplete="new-password"
            placeholder="repeat password"
          />
        </label>

        <button
          className="btn"
          type="submit"
          disabled={submitting || !username || !displayName || !email || !password || !confirm}
          style={{
            background: 'var(--accent,#7c6af7)',
            color: '#fff',
            borderColor: 'transparent',
            marginTop: '0.25rem',
          }}
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </div>
  )
}
