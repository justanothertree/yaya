import { useEffect, useMemo, useState } from 'react'
import {
  onAuthStateChange,
  requireUser,
  signOut,
  updateUserEmail,
  updateUserPassword,
  updateUserProfile,
} from '../finance/auth'
import { hasFinanceSupabaseEnv } from '../finance/env'

function normalizeError(err: unknown): string {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  const msg = (err as { message?: unknown } | null)?.message
  return typeof msg === 'string' && msg ? msg : String(err)
}

export function AccountSettings() {
  const financeEnabled = hasFinanceSupabaseEnv()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [currentEmail, setCurrentEmail] = useState<string>('')
  const [currentName, setCurrentName] = useState<string>('')

  const [newEmail, setNewEmail] = useState<string>('')
  const [newName, setNewName] = useState<string>('')

  const [newPassword, setNewPassword] = useState<string>('')
  const [confirmPassword, setConfirmPassword] = useState<string>('')

  const canSubmitProfile = useMemo(() => {
    const trimmedEmail = newEmail.trim()
    const emailChanged = trimmedEmail.length > 0 && trimmedEmail !== currentEmail
    const nameChanged = newName.trim() !== (currentName || '')
    return Boolean(emailChanged || nameChanged)
  }, [newEmail, currentEmail, newName, currentName])

  const canSubmitPassword = useMemo(() => {
    return Boolean(newPassword || confirmPassword)
  }, [newPassword, confirmPassword])

  useEffect(() => {
    if (!financeEnabled) {
      setLoading(false)
      setError(
        'Supabase is not configured for this build (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).',
      )
      return
    }

    let alive = true

    async function load() {
      setLoading(true)
      setError(null)
      setNotice(null)
      try {
        const user = await requireUser()
        if (!alive) return
        const email = user.email ?? ''
        const fullName =
          (typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : '') ||
          (typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : '') ||
          ''

        setCurrentEmail(email)
        setCurrentName(fullName)
        setNewEmail(email)
        setNewName(fullName)
      } catch (err) {
        if (!alive) return
        setError(normalizeError(err))
      } finally {
        if (alive) setLoading(false)
      }
    }

    void load()

    const { data } = onAuthStateChange((_event, session) => {
      if (!alive) return
      const email = session?.user?.email ?? ''
      const fullName =
        (typeof session?.user?.user_metadata?.full_name === 'string'
          ? session.user.user_metadata.full_name
          : '') ||
        (typeof session?.user?.user_metadata?.name === 'string'
          ? session.user.user_metadata.name
          : '') ||
        ''

      setCurrentEmail(email)
      setCurrentName(fullName)
    })

    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [financeEnabled])

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (!financeEnabled) {
      setError('Supabase is not configured for this build.')
      return
    }

    try {
      await requireUser()
    } catch (err) {
      setError(normalizeError(err))
      return
    }

    const email = newEmail.trim()
    const name = newName.trim()

    if (!email) {
      setError('Email is required.')
      return
    }
    if (!email.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }

    setSaving(true)
    try {
      if (email !== currentEmail) {
        await updateUserEmail(email)
        setNotice('Email update requested. If confirmation is required, check your inbox.')
      }

      if (name !== (currentName || '')) {
        await updateUserProfile({ full_name: name })
        setNotice((prev) => prev || 'Profile updated.')
      }
    } catch (err) {
      setError(normalizeError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePassword(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (!financeEnabled) {
      setError('Supabase is not configured for this build.')
      return
    }

    try {
      await requireUser()
    } catch (err) {
      setError(normalizeError(err))
      return
    }

    const pwd = newPassword
    const confirm = confirmPassword

    if (!pwd || !confirm) {
      setError('Enter your new password twice.')
      return
    }

    if (pwd.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (pwd !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setSaving(true)
    try {
      await updateUserPassword(pwd)
      setNewPassword('')
      setConfirmPassword('')
      setNotice('Password updated.')
    } catch (err) {
      setError(normalizeError(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleSignOut() {
    setError(null)
    setNotice(null)

    if (!financeEnabled) return

    setSaving(true)
    try {
      await signOut()
      setNotice('Signed out.')
    } catch (err) {
      setError(normalizeError(err))
    } finally {
      setSaving(false)
    }
  }

  if (!financeEnabled) {
    return (
      <section className="grid" style={{ gap: '1rem' }}>
        <header className="card" style={{ display: 'grid', gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            Account settings
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            Supabase is not configured for this build.
          </p>
        </header>
      </section>
    )
  }

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <header className="card" style={{ display: 'grid', gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Account settings
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Update your email, password, and profile info.
        </p>
      </header>

      {loading ? (
        <article className="card" aria-busy>
          Loading account…
        </article>
      ) : error ? (
        <article className="card" style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0 }}>
            <strong>Sign in required.</strong>
          </p>
          <p className="muted" style={{ margin: 0, color: 'var(--accent-2)' }}>
            {error}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Use the Sign in page, then return here.
          </p>
        </article>
      ) : (
        <>
          <article className="card" style={{ display: 'grid', gap: 10 }}>
            <p style={{ margin: 0 }}>
              Signed in as <strong>{currentEmail || 'Unknown'}</strong>
            </p>
            <button className="btn" onClick={() => handleSignOut()} disabled={saving}>
              {saving ? 'Working…' : 'Sign out'}
            </button>
          </article>

          <form className="card" onSubmit={handleSaveProfile} style={{ display: 'grid', gap: 10 }}>
            <h3 style={{ margin: 0 }}>Email & profile</h3>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="muted">Email</span>
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                type="email"
                autoComplete="email"
                required
                disabled={saving}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="muted">Full name (optional)</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                type="text"
                autoComplete="name"
                placeholder=""
                disabled={saving}
              />
            </label>
            <button className="btn" type="submit" disabled={saving || !canSubmitProfile}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>

          <form className="card" onSubmit={handleSavePassword} style={{ display: 'grid', gap: 10 }}>
            <h3 style={{ margin: 0 }}>Password</h3>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="muted">New password</span>
              <input
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                disabled={saving}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span className="muted">Confirm new password</span>
              <input
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder="••••••••"
                disabled={saving}
              />
            </label>
            <button className="btn" type="submit" disabled={saving || !canSubmitPassword}>
              {saving ? 'Saving…' : 'Update password'}
            </button>
          </form>

          {(notice || error) && (
            <article className="card" style={{ display: 'grid', gap: 8 }}>
              {notice && (
                <p className="muted" style={{ margin: 0 }}>
                  {notice}
                </p>
              )}
              {error && (
                <p className="muted" style={{ margin: 0, color: 'var(--accent-2)' }}>
                  {error}
                </p>
              )}
            </article>
          )}
        </>
      )}
    </section>
  )
}
