import { useEffect, useMemo, useState } from 'react'
import {
  getSessionUser,
  onAuthStateChange,
  peekPersistedUserId,
  signOut,
  updateUserEmail,
  updateUserPassword,
} from '../finance/auth'
import { hasFinanceSupabaseEnv } from '../finance/env'
import { getSupabaseClient } from '../finance/client'

function normalizeError(err: unknown): string {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  const msg = (err as { message?: unknown } | null)?.message
  return typeof msg === 'string' && msg ? msg : String(err)
}

// Small labeled input so the profile form stays readable.
function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  autoComplete?: string
  disabled?: boolean
}) {
  return (
    <label style={{ display: 'grid', gap: 5, minWidth: 0 }}>
      <span className="muted" style={{ fontSize: '0.82rem' }}>
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        disabled={disabled}
      />
    </label>
  )
}

// ── Profile: all your info ─────────────────────────────────────────────────
type MyProfile = {
  username: string | null
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  birthday: string | null
  address: string | null
  venmo: string | null
  cashapp: string | null
  zelle: string | null
}

function MemberProfileCard() {
  const sb = useMemo(() => getSupabaseClient(), [])
  const [form, setForm] = useState<MyProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await sb.rpc('get_my_profile')
        const row = Array.isArray(data) ? data[0] : data
        if (row) setForm(row as MyProfile)
      } catch {
        // no profile = not a member yet; hide the card
      }
    })()
  }, [sb])

  if (!form) return null

  const set = (k: keyof MyProfile, v: string) => setForm((f) => (f ? { ...f, [k]: v } : f))
  const val = (k: keyof MyProfile) => form[k] ?? ''

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const { error } = await sb.rpc('update_my_profile', {
        p_first_name: form.first_name,
        p_middle_name: form.middle_name,
        p_last_name: form.last_name,
        p_contact_email: form.email,
        p_phone: form.phone,
        p_birthday: form.birthday,
        p_address: form.address,
        p_venmo: form.venmo,
        p_cashapp: form.cashapp,
        p_zelle: form.zelle,
      })
      if (error) throw error
      setNotice('Saved.')
    } catch (e: unknown) {
      setError(normalizeError(e))
    } finally {
      setSaving(false)
    }
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    margin: '0.3rem 0 -0.2rem',
  }

  return (
    <form
      className="card"
      onSubmit={(e) => void save(e)}
      style={{ display: 'grid', gap: '0.85rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Your info</h3>
        {form.username && (
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            @{form.username} <span style={{ opacity: 0.6 }}>· set at sign-up</span>
          </span>
        )}
      </div>

      <div className="muted" style={sectionLabel}>
        Name
      </div>
      <div
        style={{
          display: 'grid',
          gap: '0.6rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}
      >
        <Field label="First" value={val('first_name')} onChange={(v) => set('first_name', v)} />
        <Field label="Middle" value={val('middle_name')} onChange={(v) => set('middle_name', v)} />
        <Field label="Last" value={val('last_name')} onChange={(v) => set('last_name', v)} />
      </div>

      <div className="muted" style={sectionLabel}>
        Contact
      </div>
      <div
        style={{
          display: 'grid',
          gap: '0.6rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <Field
          label="Contact email"
          value={val('email')}
          onChange={(v) => set('email', v)}
          type="email"
          placeholder="kept private"
          autoComplete="email"
        />
        <Field
          label="Phone"
          value={val('phone')}
          onChange={(v) => set('phone', v)}
          type="tel"
          autoComplete="tel"
        />
        <Field
          label="Birthday"
          value={val('birthday')}
          onChange={(v) => set('birthday', v)}
          type="date"
        />
        <Field label="Address" value={val('address')} onChange={(v) => set('address', v)} />
      </div>

      <div className="muted" style={sectionLabel}>
        Payment handles
      </div>
      <div
        style={{
          display: 'grid',
          gap: '0.6rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}
      >
        <Field label="Venmo" value={val('venmo')} onChange={(v) => set('venmo', v)} />
        <Field label="Cash App" value={val('cashapp')} onChange={(v) => set('cashapp', v)} />
        <Field label="Zelle" value={val('zelle')} onChange={(v) => set('zelle', v)} />
      </div>

      {notice && (
        <p className="muted" style={{ margin: 0 }}>
          {notice}
        </p>
      )}
      {error && <p style={{ margin: 0, color: 'var(--accent-2)', fontSize: '0.85rem' }}>{error}</p>}
      <button
        className="btn"
        type="submit"
        disabled={saving}
        style={{ background: 'var(--accent,#7c6af7)', color: '#fff', borderColor: 'transparent' }}
      >
        {saving ? 'Saving…' : 'Save your info'}
      </button>
    </form>
  )
}

// ── Friends: the circuits you belong to ────────────────────────────────────
type CircuitRow = {
  id: string
  name: string
  role: string
  member_count: number
  is_owner: boolean
}

function CircuitsCard() {
  const sb = useMemo(() => getSupabaseClient(), [])
  const [rows, setRows] = useState<CircuitRow[] | null>(null)

  useEffect(() => {
    void sb.rpc('my_circuits').then(({ data }) => setRows((data as CircuitRow[]) ?? []))
  }, [sb])

  if (rows === null) return null

  return (
    <article className="card" style={{ display: 'grid', gap: '0.7rem' }}>
      <h3 style={{ margin: 0 }}>Your circuits &amp; friends</h3>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        The crews you share with — everyone in a circuit sees each other’s stats. Manage members and
        invites in The Circuit.
      </p>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          You’re not in a circuit yet.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          {rows.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                flexWrap: 'wrap',
                padding: '0.5rem 0.7rem',
                background: 'var(--b1,rgba(127,127,127,0.06))',
                borderRadius: 8,
              }}
            >
              <strong>{c.name}</strong>
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                {c.member_count} member{c.member_count === 1 ? '' : 's'} ·{' '}
                {c.is_owner ? 'owner' : c.role}
              </span>
            </div>
          ))}
        </div>
      )}
      <a href="#circuit" className="btn" style={{ justifySelf: 'start', fontSize: '0.85rem' }}>
        Manage in The Circuit →
      </a>
    </article>
  )
}

// ── Account & security: login email + password ─────────────────────────────
export function AccountSettings() {
  const financeEnabled = hasFinanceSupabaseEnv()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [currentEmail, setCurrentEmail] = useState<string>('')
  const [newEmail, setNewEmail] = useState<string>('')
  const [newPassword, setNewPassword] = useState<string>('')
  const [confirmPassword, setConfirmPassword] = useState<string>('')

  const emailChanged = useMemo(
    () => newEmail.trim().length > 0 && newEmail.trim() !== currentEmail,
    [newEmail, currentEmail],
  )
  const canSubmitPassword = useMemo(
    () => Boolean(newPassword || confirmPassword),
    [newPassword, confirmPassword],
  )

  useEffect(() => {
    if (!financeEnabled) {
      setLoading(false)
      return
    }
    let alive = true
    async function load() {
      setLoading(true)
      setError(null)
      try {
        // local session read — the old network requireUser() could lag or transiently
        // fail during a token refresh, flashing "Sign in required" at a signed-in user
        const user = await getSessionUser()
        if (!alive) return
        if (!user) {
          // a persisted token means a refresh is still in flight — stay on the loading
          // card and let the auth listener below resolve it, instead of flashing the
          // sign-in-required message at a signed-in user
          if (!peekPersistedUserId()) {
            setError('Not signed in')
            setLoading(false)
          }
          return
        }
        setCurrentEmail(user.email ?? '')
        setNewEmail(user.email ?? '')
        setLoading(false)
      } catch (err) {
        if (alive) {
          setError(normalizeError(err))
          setLoading(false)
        }
      }
    }
    void load()
    const { data } = onAuthStateChange((event, session) => {
      if (!alive) return
      if (session?.user) {
        setError(null)
        setLoading(false)
        setCurrentEmail(session.user.email ?? '')
        setNewEmail((cur) => cur || (session.user.email ?? ''))
      } else if (event === 'SIGNED_OUT') {
        setCurrentEmail('')
        setError('Not signed in')
        setLoading(false)
      }
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [financeEnabled])

  async function handleSaveEmail(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const email = newEmail.trim()
    if (!email.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }
    setSaving(true)
    try {
      await updateUserEmail(email)
      setNotice('Email update requested. If confirmation is required, check your inbox.')
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
    if (!newPassword || !confirmPassword) {
      setError('Enter your new password twice.')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setSaving(true)
    try {
      await updateUserPassword(newPassword)
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
    setSaving(true)
    try {
      await signOut()
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
            Account
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            Accounts aren’t available in this build.
          </p>
        </header>
      </section>
    )
  }

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <header className="card" style={{ display: 'grid', gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Account
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Your profile, sign-in, and circuits — all in one place.
        </p>
      </header>

      {loading ? (
        <article className="card" aria-busy>
          Loading account…
        </article>
      ) : error && !currentEmail ? (
        <article className="card" style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0 }}>
            <strong>Sign in required.</strong>
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Use the Sign in page, then return here.
          </p>
        </article>
      ) : (
        <>
          <MemberProfileCard />

          <CircuitsCard />

          {/* Account & security */}
          <form className="card" onSubmit={handleSaveEmail} style={{ display: 'grid', gap: 10 }}>
            <h3 style={{ margin: 0 }}>Sign-in email</h3>
            <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
              The email you log in with (separate from your contact email above).
            </p>
            <Field
              label="Login email"
              value={newEmail}
              onChange={setNewEmail}
              type="email"
              autoComplete="email"
              disabled={saving}
            />
            <button className="btn" type="submit" disabled={saving || !emailChanged}>
              {saving ? 'Saving…' : 'Update login email'}
            </button>
          </form>

          <form className="card" onSubmit={handleSavePassword} style={{ display: 'grid', gap: 10 }}>
            <h3 style={{ margin: 0 }}>Password</h3>
            <Field
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={saving}
            />
            <Field
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              disabled={saving}
            />
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

          <article
            className="card"
            style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}
          >
            <span style={{ fontSize: '0.9rem' }}>
              Signed in as <strong>{currentEmail || 'Unknown'}</strong>
            </span>
            <button
              className="btn"
              onClick={() => void handleSignOut()}
              disabled={saving}
              style={{ marginLeft: 'auto' }}
            >
              {saving ? 'Working…' : 'Sign out'}
            </button>
          </article>
        </>
      )}
    </section>
  )
}
