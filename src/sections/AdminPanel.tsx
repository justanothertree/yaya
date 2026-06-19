import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

type Invite = {
  id: string
  token: string
  class: 'family' | 'friend'
  label: string | null
  used_at: string | null
  created_at: string
  accepted_username: string | null
}

type Member = {
  user_id: string
  username: string | null
  display_name: string | null
  email: string | null
  role: string
  created_at: string | null
  suspended: boolean
}

type MemberDetail = {
  user_id: string
  username: string | null
  first_name: string | null
  last_name: string | null
  relation: string | null
  email: string | null
  phone: string | null
  role: string
  created_at: string | null
  suspended: boolean
}

const SITE_URL = 'https://evancook.dev'
const inviteLink = (token: string) => `${SITE_URL}/#invite?token=${token}`

export function AdminPanel() {
  const sb = getSupabaseClient()
  const [tab, setTab] = useState<'invites' | 'members'>('invites')
  const [invites, setInvites] = useState<Invite[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newClass, setNewClass] = useState<'family' | 'friend'>('friend')
  const [newLabel, setNewLabel] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [detail, setDetail] = useState<MemberDetail | null>(null)
  const [form, setForm] = useState<{
    first_name: string
    email: string
    role: 'family' | 'friend'
  }>({ first_name: '', email: '', role: 'friend' })
  const [savingMember, setSavingMember] = useState(false)
  const [features, setFeatures] = useState<Record<string, boolean>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deletingMember, setDeletingMember] = useState(false)

  async function loadAll() {
    const [invRes, memRes] = await Promise.all([sb.rpc('list_invites'), sb.rpc('list_members')])
    if (invRes.error) throw invRes.error
    if (memRes.error) throw memRes.error
    setInvites((invRes.data as Invite[]) ?? [])
    setMembers((memRes.data as Member[]) ?? [])
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    loadAll()
      .catch((e: unknown) => setError(String((e as { message?: string })?.message ?? e)))
      .finally(() => setLoading(false))
  }, [])

  async function createInvite() {
    setCreating(true)
    setError(null)
    try {
      const { data, error } = await sb.rpc('create_invite', {
        p_class: newClass,
        p_label: newLabel.trim() || null,
      })
      if (error) throw error
      const link = inviteLink(data as string)
      await navigator.clipboard.writeText(link)
      setCopied('new')
      setTimeout(() => setCopied(null), 2500)
      setNewLabel('')
      const { data: inv, error: ie } = await sb.rpc('list_invites')
      if (!ie) setInvites((inv as Invite[]) ?? [])
    } catch (e: unknown) {
      setError(String((e as { message?: string })?.message ?? e))
    } finally {
      setCreating(false)
    }
  }

  async function deleteInvite(id: string) {
    const { error } = await sb.rpc('delete_invite', { p_id: id })
    if (error) {
      setError(error.message)
      return
    }
    setInvites((prev) => prev.filter((i) => i.id !== id))
  }

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(inviteLink(token))
    setCopied(token)
    setTimeout(() => setCopied(null), 2500)
  }

  async function openEdit(userId: string) {
    setConfirmDelete(false)
    if (editing === userId) {
      setEditing(null)
      setDetail(null)
      return
    }
    setEditing(userId)
    setDetail(null)
    setError(null)
    const { data, error } = await sb.rpc('admin_get_member', { p_user_id: userId })
    if (error) {
      setError(error.message)
      return
    }
    const d = (data as MemberDetail[])?.[0]
    if (d) {
      setDetail(d)
      setForm({
        first_name: d.first_name ?? '',
        email: d.email ?? '',
        role: d.role === 'family' ? 'family' : 'friend',
      })
    }
    const { data: feat } = await sb.rpc('admin_member_features', { p_user_id: userId })
    setFeatures(
      Object.fromEntries(
        ((feat as { feature: string; enabled: boolean }[]) ?? []).map((f) => [
          f.feature,
          f.enabled,
        ]),
      ),
    )
  }

  async function toggleFeature(userId: string, feature: string, enabled: boolean) {
    setFeatures((prev) => ({ ...prev, [feature]: enabled })) // optimistic
    const { error } = await sb.rpc('admin_set_feature', {
      p_user_id: userId,
      p_feature: feature,
      p_enabled: enabled,
    })
    if (error) {
      setError(error.message)
      setFeatures((prev) => ({ ...prev, [feature]: !enabled })) // revert
    }
  }

  async function setSuspended(userId: string, suspended: boolean) {
    setError(null)
    const { error } = await sb.rpc('admin_set_suspended', {
      p_user_id: userId,
      p_suspended: suspended,
    })
    if (error) {
      setError(error.message)
      return
    }
    setDetail((d) => (d && d.user_id === userId ? { ...d, suspended } : d))
    await loadAll()
  }

  async function deleteMember(userId: string) {
    setDeletingMember(true)
    setError(null)
    try {
      const { error } = await sb.rpc('admin_delete_member', { p_user_id: userId })
      if (error) throw error
      setConfirmDelete(false)
      setEditing(null)
      setDetail(null)
      await loadAll()
    } catch (e: unknown) {
      setError(String((e as { message?: string })?.message ?? e))
    } finally {
      setDeletingMember(false)
    }
  }

  async function saveMember(userId: string) {
    setSavingMember(true)
    setError(null)
    try {
      const { error } = await sb.rpc('admin_update_member', {
        p_user_id: userId,
        p_first_name: form.first_name.trim() || null,
        p_email: form.email.trim() || null,
        p_role: form.role,
      })
      if (error) throw error
      await loadAll()
      setEditing(null)
      setDetail(null)
    } catch (e: unknown) {
      setError(String((e as { message?: string })?.message ?? e))
    } finally {
      setSavingMember(false)
    }
  }

  const pending = invites.filter((i) => !i.used_at)
  const used = invites.filter((i) => i.used_at)
  const tabBtn = (t: typeof tab, label: string) => (
    <button
      className="btn"
      onClick={() => setTab(t)}
      style={
        tab === t
          ? { background: 'var(--accent,#7c6af7)', color: '#fff', borderColor: 'transparent' }
          : {}
      }
    >
      {label}
    </button>
  )

  if (loading) return <p className="muted">Loading admin panel…</p>

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Admin</h2>

      {error && (
        <p style={{ color: '#f46b6b', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {tabBtn('invites', `Invites (${pending.length} pending)`)}
        {tabBtn('members', `Members (${members.length})`)}
      </div>

      {tab === 'invites' && (
        <div>
          {/* Create invite */}
          <div
            className="card"
            style={{
              marginBottom: '1.25rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              alignItems: 'flex-end',
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                Class
              </span>
              <select
                value={newClass}
                onChange={(e) => setNewClass(e.target.value as 'family' | 'friend')}
                style={{ padding: '0.4rem 0.6rem' }}
              >
                <option value="friend">Friend</option>
                <option value="family">Family</option>
              </select>
            </label>
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 150 }}
            >
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                Who's this for? (label)
              </span>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Josh, Cam's wife"
                style={{ padding: '0.4rem 0.6rem' }}
              />
            </label>
            <button
              className="btn"
              onClick={() => void createInvite()}
              disabled={creating}
              style={{
                background: 'var(--accent,#7c6af7)',
                color: '#fff',
                borderColor: 'transparent',
              }}
            >
              {creating ? 'Creating…' : copied === 'new' ? '✓ Copied!' : 'Create & copy link'}
            </button>
          </div>

          {/* Pending invites */}
          {pending.length > 0 && (
            <>
              <div
                className="muted"
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  marginBottom: '0.4rem',
                  letterSpacing: '0.05em',
                }}
              >
                PENDING ({pending.length})
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.4rem',
                  marginBottom: '1.25rem',
                }}
              >
                {pending.map((inv) => (
                  <div
                    key={inv.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.4rem 0.65rem',
                      background: 'var(--b1,rgba(127,127,127,0.07))',
                      borderRadius: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.7rem',
                        opacity: 0.45,
                        width: '3.5rem',
                        textTransform: 'uppercase',
                        flexShrink: 0,
                      }}
                    >
                      {inv.class}
                    </span>
                    <span style={{ flex: 1, fontSize: '0.9rem' }}>
                      {inv.label ?? <span className="muted">unlabeled</span>}
                    </span>
                    <span className="muted" style={{ fontSize: '0.72rem', flexShrink: 0 }}>
                      {new Date(inv.created_at).toLocaleDateString()}
                    </span>
                    <button
                      className="btn"
                      style={{ fontSize: '0.78rem', padding: '0.2rem 0.55rem', flexShrink: 0 }}
                      onClick={() => void copyLink(inv.token)}
                    >
                      {copied === inv.token ? '✓ Copied!' : 'Copy link'}
                    </button>
                    <button
                      className="btn"
                      style={{
                        fontSize: '0.78rem',
                        padding: '0.2rem 0.45rem',
                        opacity: 0.55,
                        flexShrink: 0,
                      }}
                      onClick={() => void deleteInvite(inv.id)}
                      title="Delete invite"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Accepted invites */}
          {used.length > 0 && (
            <>
              <div
                className="muted"
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  marginBottom: '0.4rem',
                  letterSpacing: '0.05em',
                }}
              >
                ACCEPTED ({used.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {used.map((inv) => (
                  <div
                    key={inv.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.4rem 0.65rem',
                      background: 'var(--b1,rgba(127,127,127,0.07))',
                      borderRadius: 8,
                      opacity: 0.7,
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.7rem',
                        opacity: 0.45,
                        width: '3.5rem',
                        textTransform: 'uppercase',
                        flexShrink: 0,
                      }}
                    >
                      {inv.class}
                    </span>
                    <span style={{ flex: 1, fontSize: '0.9rem' }}>
                      {inv.label ?? <span className="muted">unlabeled</span>}
                    </span>
                    <span style={{ fontSize: '0.82rem', color: '#22cc78', flexShrink: 0 }}>
                      @{inv.accepted_username ?? '?'}
                    </span>
                    <span className="muted" style={{ fontSize: '0.72rem', flexShrink: 0 }}>
                      {inv.used_at ? new Date(inv.used_at).toLocaleDateString() : ''}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {invites.length === 0 && (
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              No invites yet. Create one above and text the link to a friend.
            </p>
          )}
        </div>
      )}

      {tab === 'members' && (
        <div>
          {(['family', 'friend', 'admin'] as const).map((cls) => {
            const group = members.filter((m) => m.role === cls)
            if (!group.length) return null
            return (
              <div key={cls} style={{ marginBottom: '1.25rem' }}>
                <div
                  className="muted"
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: '0.4rem',
                  }}
                >
                  {cls} ({group.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {group.map((m) => (
                    <div key={m.user_id} style={{ display: 'flex', flexDirection: 'column' }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.6rem',
                          padding: '0.4rem 0.65rem',
                          background: 'var(--b1,rgba(127,127,127,0.07))',
                          borderRadius: 8,
                        }}
                      >
                        <span
                          style={{
                            width: '8rem',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}
                        >
                          {m.username ? (
                            `@${m.username}`
                          ) : (
                            <span className="muted">no username</span>
                          )}
                        </span>
                        <span style={{ flex: 1, fontSize: '0.85rem' }}>
                          {m.display_name ?? <span className="muted">—</span>}
                        </span>
                        <span className="muted" style={{ fontSize: '0.75rem' }}>
                          {m.email ?? ''}
                        </span>
                        {m.suspended && (
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              color: '#f46b6b',
                              background: 'rgba(244,107,107,0.14)',
                              border: '1px solid rgba(244,107,107,0.4)',
                              borderRadius: 10,
                              padding: '1px 7px',
                              flexShrink: 0,
                            }}
                          >
                            ⏸ paused
                          </span>
                        )}
                        <span className="muted" style={{ fontSize: '0.72rem', flexShrink: 0 }}>
                          {m.created_at ? new Date(m.created_at).toLocaleDateString() : ''}
                        </span>
                        {cls !== 'admin' && (
                          <button
                            className="btn"
                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', flexShrink: 0 }}
                            onClick={() => void openEdit(m.user_id)}
                          >
                            {editing === m.user_id ? 'Close' : 'Edit'}
                          </button>
                        )}
                      </div>

                      {editing === m.user_id && (
                        <div className="card" style={{ margin: '0.4rem 0 0.2rem' }}>
                          {!detail ? (
                            <p className="muted" style={{ margin: 0 }}>
                              Loading…
                            </p>
                          ) : (
                            <div
                              style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}
                            >
                              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <label
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 3,
                                    flex: 1,
                                    minWidth: 150,
                                  }}
                                >
                                  <span className="muted" style={{ fontSize: '0.74rem' }}>
                                    Display name
                                  </span>
                                  <input
                                    value={form.first_name}
                                    onChange={(e) =>
                                      setForm((f) => ({ ...f, first_name: e.target.value }))
                                    }
                                    style={{ padding: '0.4rem 0.6rem' }}
                                  />
                                </label>
                                <label
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 3,
                                    flex: 1,
                                    minWidth: 150,
                                  }}
                                >
                                  <span className="muted" style={{ fontSize: '0.74rem' }}>
                                    Contact email
                                  </span>
                                  <input
                                    value={form.email}
                                    onChange={(e) =>
                                      setForm((f) => ({ ...f, email: e.target.value }))
                                    }
                                    placeholder="optional"
                                    style={{ padding: '0.4rem 0.6rem' }}
                                  />
                                </label>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                  <span className="muted" style={{ fontSize: '0.74rem' }}>
                                    Class
                                  </span>
                                  <select
                                    value={form.role}
                                    onChange={(e) =>
                                      setForm((f) => ({
                                        ...f,
                                        role: e.target.value as 'family' | 'friend',
                                      }))
                                    }
                                    style={{ padding: '0.4rem 0.6rem' }}
                                  >
                                    <option value="friend">Friend</option>
                                    <option value="family">Family</option>
                                  </select>
                                </label>
                              </div>

                              {/* per-account feature flags — saved immediately */}
                              <div
                                style={{
                                  borderTop: '1px solid var(--border, rgba(127,127,127,0.18))',
                                  paddingTop: '0.6rem',
                                }}
                              >
                                <div
                                  className="muted"
                                  style={{
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.05em',
                                    marginBottom: '0.4rem',
                                  }}
                                >
                                  Features
                                </div>
                                <label
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.45rem',
                                    fontSize: '0.85rem',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={!!features.finance}
                                    onChange={(e) =>
                                      void toggleFeature(m.user_id, 'finance', e.target.checked)
                                    }
                                  />
                                  💰 Finance / Investments
                                  <span className="muted" style={{ fontSize: '0.72rem' }}>
                                    (saves immediately)
                                  </span>
                                </label>
                              </div>

                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.6rem',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <button
                                  className="btn"
                                  onClick={() => void saveMember(m.user_id)}
                                  disabled={savingMember}
                                  style={{
                                    background: 'var(--accent,#7c6af7)',
                                    color: '#fff',
                                    borderColor: 'transparent',
                                  }}
                                >
                                  {savingMember ? 'Saving…' : 'Save changes'}
                                </button>
                                <button
                                  className="btn btn-ghost"
                                  onClick={() => void setSuspended(m.user_id, !detail.suspended)}
                                  title={
                                    detail.suspended
                                      ? 'Restore this account’s access'
                                      : 'Pause this account’s access (reversible)'
                                  }
                                  style={
                                    detail.suspended
                                      ? undefined
                                      : { color: '#f46b6b', borderColor: 'rgba(244,107,107,0.5)' }
                                  }
                                >
                                  {detail.suspended ? '▶ Restore access' : '⏸ Suspend access'}
                                </button>
                                <span className="muted" style={{ fontSize: '0.74rem' }}>
                                  @{detail.username ?? '—'}
                                  {detail.relation ? ` · ${detail.relation}` : ''}
                                  {detail.phone ? ` · ${detail.phone}` : ''}
                                  {detail.created_at
                                    ? ` · joined ${new Date(detail.created_at).toLocaleDateString()}`
                                    : ''}
                                </span>

                                {/* permanent delete — two-step confirm */}
                                <span
                                  style={{
                                    marginLeft: 'auto',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                  }}
                                >
                                  {confirmDelete ? (
                                    <>
                                      <span style={{ fontSize: '0.78rem', color: '#f46b6b' }}>
                                        Delete @{detail.username ?? 'account'} permanently?
                                      </span>
                                      <button
                                        className="btn"
                                        onClick={() => void deleteMember(m.user_id)}
                                        disabled={deletingMember}
                                        style={{
                                          background: '#e5484d',
                                          color: '#fff',
                                          borderColor: 'transparent',
                                          fontSize: '0.78rem',
                                          padding: '0.25rem 0.6rem',
                                        }}
                                      >
                                        {deletingMember ? 'Deleting…' : 'Yes, delete'}
                                      </button>
                                      <button
                                        className="btn btn-ghost"
                                        onClick={() => setConfirmDelete(false)}
                                        style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                                      >
                                        Cancel
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      className="btn btn-ghost"
                                      onClick={() => setConfirmDelete(true)}
                                      title="Permanently delete this account"
                                      style={{
                                        color: '#f46b6b',
                                        borderColor: 'rgba(244,107,107,0.5)',
                                        fontSize: '0.78rem',
                                        padding: '0.25rem 0.6rem',
                                      }}
                                    >
                                      🗑 Delete
                                    </button>
                                  )}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {members.length === 0 && (
            <p className="muted">No members yet. Send invite links to get people set up.</p>
          )}
        </div>
      )}
    </div>
  )
}
