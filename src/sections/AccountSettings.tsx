import { useEffect, useMemo, useState } from 'react'
import {
  getSessionUser,
  onAuthStateChange,
  peekPersistedUserId,
  signOut,
  updateUserEmail,
  updateUserPassword,
} from '../finance/auth'
import { previewMember, PREVIEW_ME, PREVIEW_GROUPS } from '../dev/previewMember'
import { hasFinanceSupabaseEnv } from '../finance/env'
import { getSupabaseClient } from '../finance/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { site } from '../config/site'
import { VisibilityPicker } from '../components/VisibilityPicker'
import type { VisibilityTier } from '../circuit/types'
import { showToast } from '../circuit/toast'

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

/**
 * Your handle, and a way to change it.
 *
 * ⚠️ IT USED TO SAY "set at sign-up", which was true and was not a design decision. Renaming was
 * IMPOSSIBLE: profiles.username is a foreign key to player_registry(player_name) and it was ON
 * UPDATE NO ACTION, so updating the registry broke the reference and updating profiles first had
 * nothing to point at. The label was the shape of a database constraint showing through the UI.
 * See docs/2026-09-09-tin-is-ramtin.sql, which made the key cascade.
 *
 * ⚠️ THE SERVER DOES THE VALIDATING. The checks here exist to answer instantly, not to decide —
 * player_registry takes no client writes at all, and rename_my_handle re-checks length, charset,
 * ownership and uniqueness before touching anything. A handle is unique across everybody, so the
 * only honest arbiter is the unique index; anything this file believes is a guess about a value
 * somebody else may be taking at the same moment.
 */
function HandleRow({
  sb,
  username,
  onRenamed,
}: {
  sb: SupabaseClient
  username: string
  onRenamed: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(username)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const open = () => {
    setDraft(username)
    setErr(null)
    setEditing(true)
  }

  /* the same rules the function enforces, so the common mistakes answer without a round trip */
  const trimmed = draft.trim()
  const localProblem =
    trimmed.length < 2 || trimmed.length > 16
      ? 'A handle is 2 to 16 characters.'
      : !/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(trimmed)
        ? 'Use letters, numbers, spaces, - and _, starting with a letter or number.'
        : null

  async function submit() {
    if (localProblem || trimmed === username) return setEditing(false)
    setBusy(true)
    setErr(null)
    try {
      const { data, error } = await sb.rpc('rename_my_handle', { p_new: trimmed })
      if (error) throw error
      onRenamed(typeof data === 'string' && data ? data : trimmed)
      setEditing(false)
    } catch (e: unknown) {
      const msg = normalizeError(e)
      /* ⚠️ the one error worth translating: before the migration runs, PostgREST reports the
         function as missing, and "Could not find the function" tells nobody anything. */
      setErr(
        /rename_my_handle|schema cache|does not exist/i.test(msg)
          ? 'Renaming is not switched on yet — the database migration has not been run.'
          : msg,
      )
    } finally {
      setBusy(false)
    }
  }

  if (!editing)
    return (
      <span className="muted" style={{ fontSize: '0.82rem' }}>
        @{username}{' '}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={open}
          style={{ padding: '1px 8px', fontSize: '0.75rem' }}
        >
          Change
        </button>
      </span>
    )

  return (
    <span
      style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        maxLength={16}
        aria-label="Your handle"
        /* ⚠️ NOT a submit inside the profile form — this sits inside that <form>, so Enter here
           would otherwise save the whole profile instead of the handle. */
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape') setEditing(false)
        }}
        style={{ width: '11rem', fontSize: '0.85rem' }}
      />
      <button
        type="button"
        className="btn"
        disabled={busy || !!localProblem || trimmed === username}
        onClick={() => void submit()}
        style={{ padding: '2px 10px', fontSize: '0.78rem' }}
      >
        {busy ? '…' : 'Save'}
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setEditing(false)}
        style={{ padding: '2px 10px', fontSize: '0.78rem' }}
      >
        Cancel
      </button>
      {(err || localProblem) && (
        <span className="muted" style={{ fontSize: '0.75rem', color: 'var(--danger, #e5484d)' }}>
          {err ?? localProblem}
        </span>
      )}
    </span>
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

function MemberProfileCard({ canFinance }: { canFinance: boolean }) {
  const sb = useMemo(() => getSupabaseClient(), [])
  /* opened by hand this visit. Not persisted, because once anything is filled in `hasSerious`
     keeps the block open by itself — and an empty section that stays expanded forever because
     you once tapped a button is just the open fields again, slower. */
  const [opened, setOpened] = useState(false)
  const [form, setForm] = useState<MyProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    /* ⚠️ The one card in this file that had no preview branch, so it was the one card that
       could not be looked at without a real session — including the handle editor inside it.
       Same harness and same rule as the others: a stand-in identity, no real auth touched. */
    if (previewMember) {
      setForm({
        username: PREVIEW_ME.username,
        first_name: 'Preview',
        middle_name: null,
        last_name: 'You',
        email: PREVIEW_ME.email,
        phone: null,
        birthday: null,
        address: null,
        venmo: null,
        cashapp: null,
        zelle: null,
      })
      return
    }
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
  /* anything already on file keeps its field on screen, whoever you are — see the note below */
  const hasSerious = (
    ['phone', 'birthday', 'address', 'venmo', 'cashapp', 'zelle'] as (keyof MyProfile)[]
  ).some((k) => (form[k] ?? '') !== '')

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
          <HandleRow
            sb={sb}
            username={form.username}
            onRenamed={(name) => setForm((f) => (f ? { ...f, username: name } : f))}
          />
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
      </div>

      {/* ⚠️ ONLY FOR THE ACCOUNTS THE INVESTMENTS SIDE ACTUALLY INVOLVES.
          These fields exist so a fund can identify a real person and settle up with them —
          phone, date of birth, home address, payment handles. They were shown to everybody, so
          nine people were asked for their address and their Venmo in order to vote on films.
          Exactly one ever filled them in, which is the measurement rather than the guess.

          The gate is the finance feature itself (admin, or a family invite — see my_features),
          not a new rule invented here: the fields belong to that system, so they appear for the
          people in it.

          ⚠️ `hasSerious` is the escape hatch and is not optional. Anyone who already filled
          these in before the gate existed must still be able to see and clear them — hiding
          somebody's home address from them while keeping it on file is worse than asking. */}
      {/* ⚠️ HIDDEN IS NOT REMOVED. A friend may well want to share this — settling up, or taking
          you up on the investments side — so the way in stays one tap away and says what it is
          for. What is gone is the ambush: six open boxes asking for a home address from someone
          who came to vote on films. Opting in is a decision; a form is not. */}
      {!(canFinance || hasSerious || opened) && (
        <button
          type="button"
          className="btn"
          onClick={() => setOpened(true)}
          /* ⚠️ justifySelf, not alignSelf: the card is a grid, so a stretched item fills the
             row and a quiet opt-in ends up looking like the primary action on the page */
          style={{ marginTop: '1rem', opacity: 0.75, justifySelf: 'start' }}
        >
          ＋ Add contact &amp; payment details
        </button>
      )}

      {(canFinance || hasSerious || opened) && (
        <>
          <div className="muted" style={sectionLabel}>
            {canFinance ? 'Investments details' : 'Contact & payment details'}
          </div>
          <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.78rem' }}>
            {/* ⚠️ "nobody else sees these" would be a lie, and it is the exact lie you must not
                tell on a box asking for somebody's home address. profiles_select is
                `user_id = auth.uid() OR is_admin()` — checked, not assumed.
                ⚠️ NAMED, not "whoever runs the site". One person runs this and everyone here
                was invited by him; the coy version reads as a company hedging about which
                department holds your address. It comes from site.name so it cannot drift. */}
            {canFinance
              ? `For the investments side — how a payout reaches you. Only you and ${site.name} can see them.`
              : `Optional, and nothing on the site asks for them. Fill them in if you have been asked to share them directly. Only you and ${site.name} can see them.`}
          </p>
          <div
            style={{
              display: 'grid',
              gap: '0.6rem',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
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
            <Field label="Venmo" value={val('venmo')} onChange={(v) => set('venmo', v)} />
            <Field label="Cash App" value={val('cashapp')} onChange={(v) => set('cashapp', v)} />
            <Field label="Zelle" value={val('zelle')} onChange={(v) => set('zelle', v)} />
          </div>
        </>
      )}

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
        style={{
          background: 'var(--accent,#7c6af7)',
          color: 'var(--btn-text)',
          borderColor: 'transparent',
        }}
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
  /** how you appear inside THIS circuit; null = use your ordinary name */
  nickname: string | null
}

/**
 * Display names. Your profile name is the default; each field below overrides it for one
 * context, and clearing a field falls back again. The chain is resolved server-side by
 * display_name() / snake_display_name(), so every surface agrees.
 */

/**
 * Claim an old leaderboard handle. Scores from before you had an account sit under whatever
 * name was typed at the time, owned by nobody — this attaches them
 * to you. First claim wins, and it can't take a handle someone else already owns.
 */
/**
 * Who may learn that a Snake handle is you. The tier lives on the handle rather than on
 * each score, because score_history has no user_id at all — the link runs through
 * player_registry. Someone with several handles gets one decision for all of them, since
 * "these are me" is one fact.
 */
function SnakeVisibility() {
  const [tier, setTier] = useState<VisibilityTier | null>(null)
  const [handles, setHandles] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (previewMember) {
      setHandles(['preview', 'preview phone'])
      setTier('friends')
      return
    }
    let live = true
    void getSupabaseClient()
      .rpc('my_snake_handles')
      .then(({ data }) => {
        if (!live || !data) return
        const rows = data as { player_name: string; visibility: VisibilityTier }[]
        setHandles(rows.map((r) => r.player_name))
        setTier(rows[0]?.visibility ?? 'friends')
      })
    return () => {
      live = false
    }
  }, [])

  // nothing claimed yet means nothing to decide about
  if (!tier || handles.length === 0) return null

  const change = async (t: VisibilityTier) => {
    if (previewMember) {
      setTier(t)
      return
    }
    setBusy(true)
    const { error } = await getSupabaseClient().rpc('set_my_snake_visibility', { p_tier: t })
    if (!error) {
      setTier(t)
      showToast('Snake name visibility updated')
    }
    setBusy(false)
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <VisibilityPicker
        value={tier}
        onChange={(t) => void change(t)}
        kind="snake"
        disabled={busy}
        label={`Who can tell ${handles.length > 1 ? 'these handles are' : 'this handle is'} you?`}
      />
      <p className="muted" style={{ margin: 0, fontSize: '0.75rem' }}>
        {handles.length > 1 ? 'Your handles: ' : 'Your handle: '}
        {handles.join(', ')}
      </p>
    </div>
  )
}

function ClaimSnakeName() {
  const sb = useMemo(() => getSupabaseClient(), [])
  const [handle, setHandle] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function claim() {
    const h = handle.trim()
    if (!h) return
    setBusy(true)
    setMsg(null)
    const { error } = await sb.rpc('claim_snake_name', { p_name: h })
    setBusy(false)
    if (error) setMsg(error.message)
    else {
      setMsg(`“${h}” is yours — its scores now count as you.`)
      setHandle('')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Claim an old handle</span>
      <span className="muted" style={{ fontSize: '0.78rem' }}>
        Played Snake before you had an account? Claim that name to keep those scores.
      </span>
      <span style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void claim()}
          placeholder="The name you played under"
          maxLength={24}
          aria-label="Leaderboard handle to claim"
          style={{ flex: 1, minWidth: 160 }}
        />
        <button
          className="btn cz-tap"
          type="button"
          onClick={() => void claim()}
          disabled={busy || !handle.trim()}
        >
          {busy ? '…' : 'Claim'}
        </button>
      </span>
      {msg && (
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          {msg}
        </span>
      )}
    </div>
  )
}

function NicknamesCard() {
  const sb = useMemo(() => getSupabaseClient(), [])
  const [nickname, setNickname] = useState('')
  const [circuitNickname, setCircuitNickname] = useState('')
  const [snakeNickname, setSnakeNickname] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void sb
      .from('profiles')
      .select('nickname,circuit_nickname,snake_nickname')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        const d = data as {
          nickname: string | null
          circuit_nickname: string | null
          snake_nickname: string | null
        }
        setNickname(d.nickname ?? '')
        setCircuitNickname(d.circuit_nickname ?? '')
        setSnakeNickname(d.snake_nickname ?? '')
      })
  }, [sb])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setState('saving')
    setErr(null)
    const { error } = await sb.rpc('set_my_nicknames', {
      p_nickname: nickname,
      p_circuit_nickname: circuitNickname,
      p_snake_nickname: snakeNickname,
    })
    if (error) {
      setErr(error.message)
      setState('error')
    } else {
      setState('saved')
      window.setTimeout(() => setState('idle'), 1800)
    }
  }

  const field = (label: string, hint: string, value: string, onChange: (v: string) => void) => (
    <label style={{ display: 'grid', gap: 3 }}>
      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{label}</span>
      <span className="muted" style={{ fontSize: '0.78rem' }}>
        {hint}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={24}
        placeholder="Leave blank to use your name"
      />
    </label>
  )

  return (
    <form className="card" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>What people call you</h3>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        Your name is the default everywhere. Override it per place — clear a field to go back.
      </p>
      {/* ⚠️ A POINTER, NOT A SECOND FIELD. Everything in this card is a free-text override that
          can be blank and can collide; the handle is the one globally unique name, and editing
          it lives with the identity it belongs to. But "what am I called" is the question that
          brings somebody here, so leaving them to guess is how it ends up reported as missing. */}
      <p className="muted" style={{ margin: 0, fontSize: '0.8rem', opacity: 0.75 }}>
        Looking for your @handle? It is the unique one, up under <strong>Your info</strong>.
      </p>
      {field('Nickname', 'Used anywhere you have no more specific name.', nickname, setNickname)}
      {field(
        'In the Circuit',
        'How you appear on the board, feed and charts.',
        circuitNickname,
        setCircuitNickname,
      )}
      {field('On the Snake leaderboard', 'Your arcade handle.', snakeNickname, setSnakeNickname)}
      <SnakeVisibility />
      <ClaimSnakeName />
      {err && (
        <p className="muted" style={{ margin: 0, color: 'var(--accent-2)', fontSize: '0.85rem' }}>
          {err}
        </p>
      )}
      <div>
        <button className="btn" type="submit" disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save names'}
        </button>
      </div>
    </form>
  )
}

/** How you appear inside one circuit. Blank falls back to your ordinary name. */
function CircuitNickname({
  groupId,
  initial,
  onSaved,
}: {
  groupId: string
  initial: string
  onSaved: (v: string) => void
}) {
  const sb = useMemo(() => getSupabaseClient(), [])
  const [value, setValue] = useState(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const dirty = value.trim() !== initial.trim()

  async function save() {
    if (!dirty) return
    setState('saving')
    const { error } = await sb.rpc('set_my_circuit_nickname', {
      p_group: groupId,
      p_nickname: value,
    })
    if (error) {
      setState('idle')
      return
    }
    onSaved(value.trim())
    setState('saved')
    window.setTimeout(() => setState('idle'), 1500)
  }

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}
      title="Your name inside this circuit"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void save()}
        maxLength={24}
        placeholder="Name here"
        aria-label="Your nickname in this circuit"
        style={{ width: 130, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
      />
      {dirty ? (
        <button className="btn cz-tap" onClick={() => void save()} disabled={state === 'saving'}>
          {state === 'saving' ? '…' : 'Save'}
        </button>
      ) : (
        state === 'saved' && (
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            ✓
          </span>
        )
      )}
    </span>
  )
}

function CircuitsCard() {
  const sb = useMemo(() => getSupabaseClient(), [])
  const [rows, setRows] = useState<CircuitRow[] | null>(null)

  useEffect(() => {
    if (previewMember) {
      // stand-in circuits so the per-circuit name editor can be inspected (see previewMember)
      setRows(
        PREVIEW_GROUPS.map((g, i) => ({
          id: g.id,
          name: g.name,
          role: 'member',
          member_count: 4 - i,
          is_owner: i === 0,
          nickname: i === 0 ? 'CrewCaptain' : null,
        })),
      )
      return
    }
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
              <CircuitNickname
                groupId={c.id}
                initial={c.nickname ?? ''}
                onSaved={(v) =>
                  setRows(
                    (prev) =>
                      prev?.map((r) => (r.id === c.id ? { ...r, nickname: v || null } : r)) ?? prev,
                  )
                }
              />
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
export function AccountSettings({ canFinance = false }: { canFinance?: boolean } = {}) {
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
        // DEV harness: render the signed-in account UI with a stand-in identity so these
        // cards can be inspected without a session (see previewMember). No real auth touched.
        if (previewMember) {
          setCurrentEmail(PREVIEW_ME.email)
          setNewEmail(PREVIEW_ME.email)
          setLoading(false)
          return
        }
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
          <MemberProfileCard canFinance={canFinance} />

          <NicknamesCard />
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
