import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { UsagePanel } from '../components/UsagePanel'
import { FundPanel } from '../components/FundPanel'
import { MessagesPanel } from '../components/MessagesPanel'
import { ImportPanel } from '../components/ImportPanel'
import { ReconcilePanel } from '../components/ReconcilePanel'

type Invite = {
  id: string
  token: string
  class: 'family' | 'friend'
  label: string | null
  used_at: string | null
  created_at: string
  accepted_username: string | null
  expires_at: string | null
  /** 'live' | 'expired' | 'used', decided by the server so this panel and the signup page can
   *  never disagree about whether a link still works */
  state: string | null
}

/**
 * How long an invite has left, in words.
 *
 * Days rather than a date: "expires 4 Sep" makes you do arithmetic before deciding whether to
 * send a reminder, and the only question anyone actually has is how much time is left.
 */
function expiryWords(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const days = Math.floor(ms / 86400000)
  if (days >= 1) return `${days}d left`
  const hours = Math.max(1, Math.floor(ms / 3600000))
  return `${hours}h left`
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

/**
 * A Snake handle that has real play behind it — the operator's view of who owns which scores.
 *
 * `registry_name` is the reserved name; `board_names` is what those scores actually RENDER as on
 * the public board. They're usually the same, and when they aren't, the board name is the one a
 * person recognises as theirs — which is exactly the case self-service claiming can't settle on
 * its own, so it lands here.
 */
type SnakeHandle = {
  registry_id: number
  registry_name: string | null
  board_names: string | null
  best_score: number | null
  runs: number
  owner_user_id: string | null
  owner_username: string | null
}

const SITE_URL = 'https://evancook.dev'
const inviteLink = (token: string) => `${SITE_URL}/#invite?token=${token}`

export function AdminPanel() {
  const sb = getSupabaseClient()
  const [tab, setTab] = useState<
    'invites' | 'members' | 'snake' | 'fund' | 'import' | 'reconcile' | 'messages' | 'usage'
  >('invites')
  const [invites, setInvites] = useState<Invite[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [handles, setHandles] = useState<SnakeHandle[]>([])
  const [linking, setLinking] = useState<number | null>(null)
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
  /**
   * What is waiting on him, asked once when the panel opens.
   *
   * Every accuracy problem so far was found because he happened to look at a number and said
   * "that's not right". That works, and it is also the only thing standing between a broken
   * figure and a family member reading it. These three counts are the same checks made
   * unmissable: they sit on the tab that fixes them, so nothing waits on him remembering to go
   * and look.
   *
   * ⚠️ Counts only — the tab itself is the explanation. A badge that tried to summarise WHAT is
   * wrong would be a second copy of rules that live in the database, and it would drift.
   */
  const [attention, setAttention] = useState<{
    integrity: number
    messages: number
    undecided: number
  } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deletingMember, setDeletingMember] = useState(false)

  async function loadAll() {
    const [invRes, memRes, snakeRes, attnRes] = await Promise.all([
      sb.rpc('list_invites'),
      sb.rpc('list_members'),
      sb.rpc('admin_list_snake_handles'),
      sb.rpc('admin_attention'),
    ])
    if (invRes.error) throw invRes.error
    if (memRes.error) throw memRes.error
    setInvites((invRes.data as Invite[]) ?? [])
    setMembers((memRes.data as Member[]) ?? [])
    // Same reasoning as the handles below: a badge is a convenience, and losing the whole panel
    // over one is a worse outcome than an unbadged tab.
    setAttention(
      attnRes.error
        ? null
        : (attnRes.data as { integrity: number; messages: number; undecided: number }),
    )
    // Deliberately NOT fatal, unlike the two above: invites and members are what this panel is
    // for, and letting the newest/least critical query take the whole page down with it would
    // mean one bad RPC costs you member management too. An empty tab is a much better failure.
    setHandles(snakeRes.error ? [] : ((snakeRes.data as SnakeHandle[]) ?? []))
  }

  /**
   * Attach a Snake handle to a member, or detach it (userId null).
   *
   * This is the other half of `claim_snake_name`'s refusal message. Self-service claiming
   * deliberately only accepts a handle that matches one of your OWN names — that's what stops
   * anyone taking someone else's scores — so a handle nobody can prove is theirs (a one-off
   * gamertag, a typo'd name, a handle that renders differently on the board than it's stored)
   * has always needed a human decision. Until now there was no way to make that decision except
   * hand-written SQL against production.
   */
  async function linkHandle(registryId: number, userId: string | null) {
    setLinking(registryId)
    setError(null)
    try {
      const { error } = await sb.rpc('admin_link_snake_handle', {
        p_registry_id: registryId,
        p_user_id: userId,
      })
      if (error) throw error
      await loadAll()
    } catch (e: unknown) {
      setError(String((e as { message?: string })?.message ?? e))
    } finally {
      setLinking(null)
    }
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

  /**
   * Push an invite's clock out. The LINK IS UNCHANGED, which is the whole point — the message you
   * already sent still works, so there is never a second link competing with the first.
   *
   * Re-reads the list rather than patching the row locally: the server decides `state`, and
   * guessing it here is how a panel ends up disagreeing with the signup page about whether a
   * link works.
   */
  async function renewInvite(id: string) {
    const { error } = await sb.rpc('renew_invite', { p_id: id })
    if (error) {
      setError(error.message)
      return
    }
    const { data, error: le } = await sb.rpc('list_invites')
    if (!le) setInvites((data as Invite[]) ?? [])
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

  // ⚠️ Three states, not two. An expired invite is not pending: leaving it in that list is how
  // somebody copies a link that will not work and only finds out when the person tries it.
  const pending = invites.filter((i) => !i.used_at && i.state !== 'expired')
  const expired = invites.filter((i) => !i.used_at && i.state === 'expired')
  const used = invites.filter((i) => i.used_at)
  const tabBtn = (t: typeof tab, label: string) => (
    <button
      className="btn"
      onClick={() => setTab(t)}
      style={
        tab === t
          ? {
              background: 'var(--accent,#7c6af7)',
              color: 'var(--btn-text)',
              borderColor: 'transparent',
            }
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
        {tabBtn(
          'snake',
          `Snake names (${handles.filter((h) => !h.owner_user_id).length} unclaimed)`,
        )}
        {/* The one number the family actually sees, and the only input it needs. */}
        {tabBtn('fund', 'Fund')}
        {/* Broker CSVs, without a terminal or a service-role key on a command line.
            The count is trades since the fund started that nobody has said yes or no to yet —
            left alone they silently count as yours, which is a decision by default. */}
        {tabBtn(
          'import',
          `Import${attention?.undecided ? ` (${attention.undecided} to sort)` : ''}`,
        )}
        {/* Verifying the numbers against the brokers, without needing anyone else.
            ⚠️ The only badge that is a warning rather than a workload: a failing check means a
            figure on the family's screen is currently wrong. */}
        {tabBtn(
          'reconcile',
          attention?.integrity ? `⚠️ Reconcile (${attention.integrity})` : 'Reconcile',
        )}
        {/* The contact form's actual record. The email is a ping; this is what arrived. */}
        {tabBtn(
          'messages',
          `Messages${attention?.messages ? ` (${attention.messages} unread)` : ''}`,
        )}
        {/* Operational, not social — what the paid services are costing, in the one place
            that already requires being the operator to see. */}
        {tabBtn('usage', 'Usage')}
      </div>

      {tab === 'fund' && <FundPanel />}

      {tab === 'import' && <ImportPanel />}

      {tab === 'reconcile' && <ReconcilePanel />}

      {tab === 'messages' && <MessagesPanel />}

      {tab === 'usage' && <UsagePanel />}

      {tab === 'snake' && (
        <div>
          <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
            Every Snake handle with scores behind it. People can claim a handle themselves only when
            it matches one of their own names — that&apos;s what stops anyone taking someone
            else&apos;s scores. Anything else lands here for you to decide.
          </p>
          {(['unclaimed', 'claimed'] as const).map((bucket) => {
            const group = handles.filter((h) =>
              bucket === 'unclaimed' ? !h.owner_user_id : !!h.owner_user_id,
            )
            if (!group.length) return null
            return (
              <div key={bucket} style={{ marginBottom: '1.25rem' }}>
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
                  {bucket} ({group.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {group.map((h) => {
                    // the board name is what a person actually recognises; show it as the
                    // headline and only mention the stored name when they differ
                    const board = h.board_names ?? h.registry_name ?? '—'
                    const differs = !!h.registry_name && h.registry_name !== h.board_names
                    return (
                      <div
                        key={h.registry_id}
                        className="admin-member-row"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.6rem',
                          flexWrap: 'wrap',
                          padding: '0.4rem 0.65rem',
                          background: 'var(--b1,rgba(127,127,127,0.07))',
                          borderRadius: 8,
                        }}
                      >
                        <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{board}</span>
                        {differs && (
                          <span className="muted" style={{ fontSize: '0.75rem' }}>
                            stored as “{h.registry_name}”
                          </span>
                        )}
                        <span className="muted" style={{ fontSize: '0.75rem' }}>
                          best {h.best_score ?? '—'} · {h.runs} run{h.runs === 1 ? '' : 's'}
                        </span>
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
                          {h.owner_user_id ? (
                            <>
                              <span style={{ fontSize: '0.8rem' }}>
                                @{h.owner_username ?? h.owner_user_id.slice(0, 8)}
                              </span>
                              <button
                                className="btn"
                                disabled={linking === h.registry_id}
                                onClick={() => void linkHandle(h.registry_id, null)}
                                title="Detach this handle from that account"
                              >
                                {linking === h.registry_id ? '…' : 'Unlink'}
                              </button>
                            </>
                          ) : (
                            <select
                              value=""
                              disabled={linking === h.registry_id}
                              onChange={(e) =>
                                e.target.value && void linkHandle(h.registry_id, e.target.value)
                              }
                              aria-label={`Link ${board} to a member`}
                              style={{ padding: '0.25rem 0.4rem', fontSize: '0.8rem' }}
                            >
                              <option value="">Link to…</option>
                              {members.map((m) => (
                                <option key={m.user_id} value={m.user_id}>
                                  {m.username ? `@${m.username}` : (m.display_name ?? m.user_id)}
                                </option>
                              ))}
                            </select>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {!handles.length && (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              No Snake handles with scores yet.
            </p>
          )}
        </div>
      )}

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
                placeholder="a name or note for you"
                style={{ padding: '0.4rem 0.6rem' }}
              />
            </label>
            <button
              className="btn"
              onClick={() => void createInvite()}
              disabled={creating}
              style={{
                background: 'var(--accent,#7c6af7)',
                color: 'var(--btn-text)',
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
                    <span
                      className="muted"
                      style={{ fontSize: '0.72rem', flexShrink: 0 }}
                      title={
                        inv.expires_at
                          ? `Expires ${new Date(inv.expires_at).toLocaleString()}`
                          : undefined
                      }
                    >
                      {inv.expires_at
                        ? expiryWords(inv.expires_at)
                        : new Date(inv.created_at).toLocaleDateString()}
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
                      style={{ fontSize: '0.78rem', padding: '0.2rem 0.55rem', flexShrink: 0 }}
                      onClick={() => void renewInvite(inv.id)}
                      title="Give this invite another 30 days — the link stays the same"
                    >
                      ↻ 30d
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

          {/* Expired: dead links, kept visible only so they can be cleared out. Separated from
              pending so nobody copies one by mistake. */}
          {expired.length > 0 && (
            <>
              <div
                className="muted"
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  marginBottom: '0.4rem',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                Expired
              </div>
              <div style={{ display: 'grid', gap: '0.35rem', marginBottom: '0.9rem' }}>
                {expired.map((inv) => (
                  <div
                    key={inv.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.4rem 0.65rem',
                      background: 'var(--b1,rgba(127,127,127,0.07))',
                      borderRadius: 8,
                      opacity: 0.6,
                    }}
                  >
                    <span style={{ flex: 1, fontSize: '0.9rem' }}>
                      {inv.label ?? <span className="muted">unlabeled</span>}
                    </span>
                    <span className="muted" style={{ fontSize: '0.72rem', flexShrink: 0 }}>
                      expired
                    </span>
                    {/* The case this button exists for: they were slow, the link lapsed, and the
                        message with it is still sitting in their thread. */}
                    <button
                      className="btn"
                      style={{ fontSize: '0.78rem', padding: '0.2rem 0.55rem', flexShrink: 0 }}
                      onClick={() => void renewInvite(inv.id)}
                      title="Bring this invite back for another 30 days — same link"
                    >
                      ↻ Revive
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
                ACCEPTED INVITES ({used.length})
              </div>
              <p className="muted" style={{ margin: '0 0 0.4rem', fontSize: '0.74rem' }}>
                Just invite-link signups — anyone who joined a circuit with a code is in the{' '}
                <button
                  onClick={() => setTab('members')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--accent,#7c6af7)',
                    cursor: 'pointer',
                    font: 'inherit',
                    textDecoration: 'underline',
                  }}
                >
                  Members
                </button>{' '}
                tab.
              </p>
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
                        className="admin-member-row"
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
                          className="admin-member-user"
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
                                    color: 'var(--btn-text)',
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
