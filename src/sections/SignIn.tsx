import { useEffect, useState } from 'react'
import {
  getUser,
  onAuthStateChange,
  sendPasswordReset,
  signInWithPassword,
  signOut,
} from '../finance/auth'
import { hasFinanceSupabaseEnv } from '../finance/env'

export function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  const financeEnabled = hasFinanceSupabaseEnv()

  useEffect(() => {
    if (!financeEnabled) return
    let alive = true

    void getUser()
      .then((u) => {
        if (!alive) return
        setUserEmail(u?.email ?? null)
      })
      .catch(() => {
        if (!alive) return
        setUserEmail(null)
      })

    const { data } = onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null)
    })

    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [financeEnabled])

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!financeEnabled) {
      setError(
        'Supabase is not configured for this build (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).',
      )
      return
    }

    if (!email.trim() || !password) {
      setError('Email and password are required.')
      return
    }

    setLoading(true)
    try {
      await signInWithPassword(email.trim(), password)
      setPassword('')
    } catch (err) {
      setError(String((err as { message?: string } | null)?.message || err))
    } finally {
      setLoading(false)
    }
  }

  /**
   * Forgotten password.
   *
   * ⚠️ The same sentence whatever happens, because the alternative — "no account with that
   * email" — turns this form into a membership check. The people here are one person's friends
   * and family, so "is <name> in this circle?" is exactly the question a stranger should not be
   * able to ask a login box.
   *
   * The link Supabase sends signs them in and lands them on Account, where the change-password
   * form already lives, so there is no second screen to build or maintain.
   */
  const [resetSent, setResetSent] = useState(false)
  async function handleReset() {
    setError(null)
    if (!financeEnabled) return
    if (!email.trim()) {
      setError('Enter your email address first, then press this again.')
      return
    }
    setLoading(true)
    try {
      await sendPasswordReset(email.trim())
      setResetSent(true)
    } catch (err) {
      // Only real faults reach here — rate limits, misconfiguration. Not "who is this".
      setError(String((err as { message?: string } | null)?.message || err))
    } finally {
      setLoading(false)
    }
  }

  async function handleSignOut() {
    setError(null)
    if (!financeEnabled) return
    setLoading(true)
    try {
      await signOut()
    } catch (err) {
      setError(String((err as { message?: string } | null)?.message || err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <header className="card" style={{ display: 'grid', gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Sign in
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Welcome back — sign in to track your Circuit and pick up where you left off.
        </p>
      </header>

      {!financeEnabled ? (
        <article className="card">
          <p className="muted" style={{ margin: 0 }}>
            Supabase is not configured for this build. Set `VITE_SUPABASE_URL` and
            `VITE_SUPABASE_ANON_KEY`.
          </p>
        </article>
      ) : userEmail ? (
        <article className="card" style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0 }}>
            Signed in as <strong>{userEmail}</strong>
          </p>
          <button className="btn" onClick={() => handleSignOut()} disabled={loading}>
            {loading ? 'Signing out…' : 'Sign out'}
          </button>
          {error && (
            <p className="muted" style={{ margin: 0, color: 'var(--accent-2)' }}>
              {error}
            </p>
          )}
        </article>
      ) : (
        <form className="card" onSubmit={handleSignIn} style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span className="muted">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span className="muted">Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </label>
          <button className="btn" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          {resetSent ? (
            <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
              If that address has an account here, a reset link is on its way. It signs you in and
              drops you on your Account page, where you can set a new password. Check spam — and if
              nothing arrives, message Evan and he&apos;ll sort it out.
            </p>
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handleReset()}
              disabled={loading}
              style={{ fontSize: '0.85rem' }}
            >
              Forgot your password?
            </button>
          )}
          {error && (
            <p className="muted" style={{ margin: 0, color: 'var(--accent-2)' }}>
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  )
}
