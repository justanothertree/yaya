import { useEffect, useState } from 'react'
import { getUser, onAuthStateChange, signInWithPassword, signOut } from '../finance/auth'
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
          Sign in to access Investments. Session is used for Supabase RLS (`auth.uid()`).
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
