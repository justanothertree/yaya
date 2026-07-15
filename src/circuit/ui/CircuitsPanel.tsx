// "Circuits" — manage the groups you own/belong to (Phase D of data ownership).
// Create a circuit, share its join code, join someone else's, and claim your own
// person. Talks to the security-definer RPCs (create_circuit / join_circuit /
// my_circuits / leave_circuit / claim_person). Members-only; the tab is hidden when
// signed out, so this assumes an authenticated Supabase session.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSupabaseClient } from '../../finance/client'
import { useCircuit } from '../store'
import { showToast } from '../toast'

type CircuitRow = {
  id: string
  name: string
  join_code: string | null
  role: string
  member_count: number
  is_owner: boolean
}

const ADD_PALETTE = ['#7c6af7', '#f46b6b', '#fb923c', '#22c55e', '#38bdf8', '#e879f9', '#facc15']

export function CircuitsPanel() {
  const state = useCircuit()
  const sb = useMemo(() => getSupabaseClient(), [])
  const [rows, setRows] = useState<CircuitRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [uid, setUid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [claimOpen, setClaimOpen] = useState(false)
  const [addFor, setAddFor] = useState<string | null>(null)
  const [addName, setAddName] = useState('')
  const [addColor, setAddColor] = useState(ADD_PALETTE[0])
  const [renameFor, setRenameFor] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDelFor, setConfirmDelFor] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const { data, error } = await sb.rpc('my_circuits')
    if (error) setErr(error.message)
    else setRows((data as CircuitRow[]) ?? [])
  }, [sb])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    void sb.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null))
  }, [sb])

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true)
    setErr(null)
    const { error } = await fn()
    setBusy(false)
    if (error) {
      setErr(error.message)
    } else {
      showToast(ok)
      await refresh()
    }
  }

  const create = () =>
    run(async () => {
      const r = await sb.rpc('create_circuit', { p_name: newName })
      if (!r.error) setNewName('')
      return r
    }, 'Circuit created')

  const join = () =>
    run(async () => {
      const r = await sb.rpc('join_circuit', { p_code: joinCode.trim() })
      if (!r.error) setJoinCode('')
      return r
    }, 'Joined circuit')

  const leave = (id: string) => run(() => sb.rpc('leave_circuit', { p_group: id }), 'Left circuit')

  const del = (id: string) =>
    run(async () => {
      const r = await sb.rpc('delete_circuit', { p_group: id })
      if (!r.error) setConfirmDelFor(null)
      return r
    }, 'Circuit deleted')

  const claim = (personId: string) =>
    run(
      () => sb.rpc('claim_person', { p_person_id: personId }),
      'Claimed — this is now your Circuit',
    )

  // Put yourself into a circuit: creates a person you own, shared into that circuit, so a
  // joined-but-empty circuit (like one a friend invited you to) actually gets your data.
  const addMe = (groupId: string) =>
    run(async () => {
      const r = await sb.rpc('add_self_to_circuit', {
        p_group: groupId,
        p_name: addName,
        p_color: addColor,
      })
      if (!r.error) {
        setAddFor(null)
        setAddName('')
        setAddColor(ADD_PALETTE[0])
      }
      return r
    }, 'Added you to the circuit')

  const rename = (groupId: string) =>
    run(async () => {
      const r = await sb.rpc('rename_circuit', { p_group: groupId, p_name: renameVal })
      if (!r.error) {
        setRenameFor(null)
        setRenameVal('')
      }
      return r
    }, 'Circuit renamed')

  const setPublic = (personId: string, pub: boolean) =>
    run(
      () => sb.rpc('set_person_public', { p_person_id: personId, p_public: pub }),
      pub ? 'Now on the public board' : 'Removed from the public board',
    )

  const copyCode = (code: string) => {
    void navigator.clipboard?.writeText(code).then(
      () => showToast('Join code copied'),
      () => showToast('Copy failed — code: ' + code),
    )
  }

  const input: React.CSSProperties = { padding: '0.45rem 0.6rem', flex: 1, minWidth: 0 }
  const personRow = (color: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
    padding: '0.45rem 0.6rem',
    background: 'var(--b1, rgba(127,127,127,0.06))',
    borderRadius: 8,
    borderLeft: `3px solid ${color}`,
  })

  const myPeople = state.people.filter((p) => uid && p.ownerUserId === uid)
  const claimable = state.people.filter((p) => !p.ownerUserId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem', maxWidth: 620 }}>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        A circuit is your crew. Everyone in it sees each other’s stats, but only you can edit your
        own. Share a join code to invite friends; nothing is public unless you choose it.
      </p>

      {/* your circuits */}
      <section>
        <div className="cz-sec" style={{ marginBottom: '0.5rem' }}>
          Your circuits
        </div>
        {rows === null ? (
          <p className="muted" style={{ margin: 0 }}>
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            You’re not in a circuit yet — create one below or join with a code.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {rows.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                  padding: '0.6rem 0.75rem',
                  background: 'var(--b1, rgba(127,127,127,0.06))',
                  borderRadius: 10,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.6rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong>{c.name}</strong>
                  <span className="muted" style={{ fontSize: '0.76rem' }}>
                    {c.member_count} member{c.member_count === 1 ? '' : 's'} ·{' '}
                    {c.is_owner ? 'owner' : c.role}
                  </span>
                  <div
                    style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto', flexWrap: 'wrap' }}
                  >
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setAddFor((cur) => (cur === c.id ? null : c.id))
                        setAddName('')
                        setAddColor(ADD_PALETTE[0])
                      }}
                      style={{ fontSize: '0.78rem' }}
                      title="Add yourself (your data) to this circuit"
                      aria-expanded={addFor === c.id}
                    >
                      {addFor === c.id ? '✕ Cancel' : '➕ Add me'}
                    </button>
                    {c.is_owner && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          setRenameFor((cur) => (cur === c.id ? null : c.id))
                          setRenameVal(c.name)
                        }}
                        style={{ fontSize: '0.78rem' }}
                        title="Rename this circuit"
                        aria-expanded={renameFor === c.id}
                      >
                        {renameFor === c.id ? '✕ Cancel' : '✏️ Rename'}
                      </button>
                    )}
                    {c.is_owner && c.join_code && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => copyCode(c.join_code!)}
                        style={{ fontSize: '0.78rem' }}
                        title="Copy the join code to invite friends"
                      >
                        🔗 Invite ({c.join_code})
                      </button>
                    )}
                    {!c.is_owner && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => leave(c.id)}
                        disabled={busy}
                        style={{ fontSize: '0.78rem' }}
                      >
                        Leave
                      </button>
                    )}
                    {c.is_owner && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => setConfirmDelFor((cur) => (cur === c.id ? null : c.id))}
                        style={{
                          fontSize: '0.78rem',
                          color: '#f46b6b',
                          borderColor: 'rgba(244,107,107,0.4)',
                        }}
                        title="Delete this circuit"
                        aria-expanded={confirmDelFor === c.id}
                      >
                        {confirmDelFor === c.id ? '✕ Cancel' : '🗑 Delete'}
                      </button>
                    )}
                  </div>
                </div>
                {confirmDelFor === c.id && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                      fontSize: '0.82rem',
                    }}
                  >
                    <span className="muted">
                      Delete <strong>{c.name}</strong> for everyone? Its shared movies, watchlist,
                      and members are removed — this can’t be undone.
                    </span>
                    <button
                      className="btn"
                      onClick={() => del(c.id)}
                      disabled={busy}
                      style={{ background: '#e5484d', color: '#fff', borderColor: 'transparent' }}
                    >
                      Yes, delete
                    </button>
                  </div>
                )}
                {renameFor === c.id && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      placeholder="New circuit name"
                      style={{ ...input, flex: '1 1 160px' }}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && renameVal.trim() && !busy) rename(c.id)
                      }}
                    />
                    <button
                      className="btn"
                      onClick={() => rename(c.id)}
                      disabled={busy || !renameVal.trim()}
                      style={{
                        background: 'var(--accent,#7c6af7)',
                        color: '#fff',
                        borderColor: 'transparent',
                      }}
                    >
                      Save
                    </button>
                  </div>
                )}
                {addFor === c.id && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <input
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      placeholder="Your name in this circuit"
                      style={{ ...input, flex: '1 1 160px' }}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && addName.trim() && !busy) addMe(c.id)
                      }}
                    />
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                      {ADD_PALETTE.map((col) => (
                        <button
                          key={col}
                          onClick={() => setAddColor(col)}
                          aria-label={`Pick colour ${col}`}
                          style={{
                            width: 22,
                            height: 22,
                            minWidth: 'auto',
                            padding: 0,
                            borderRadius: '50%',
                            background: col,
                            border:
                              addColor === col
                                ? '2px solid var(--fg,#fff)'
                                : '2px solid transparent',
                            boxShadow: addColor === col ? '0 0 0 1px rgba(0,0,0,0.35)' : 'none',
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        />
                      ))}
                    </div>
                    <button
                      className="btn"
                      onClick={() => addMe(c.id)}
                      disabled={busy || !addName.trim()}
                      style={{
                        background: 'var(--accent,#7c6af7)',
                        color: '#fff',
                        borderColor: 'transparent',
                      }}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* create + join */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <div>
          <div className="cz-sec" style={{ marginBottom: '0.4rem' }}>
            Start a circuit
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Circuit name (e.g. The Crew)"
              style={input}
            />
            <button
              className="btn"
              onClick={create}
              disabled={busy || !newName.trim()}
              style={{
                background: 'var(--accent,#7c6af7)',
                color: '#fff',
                borderColor: 'transparent',
              }}
            >
              Create
            </button>
          </div>
        </div>
        <div>
          <div className="cz-sec" style={{ marginBottom: '0.4rem' }}>
            Join with a code
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Paste a join code"
              style={input}
            />
            <button className="btn" onClick={join} disabled={busy || !joinCode.trim()}>
              Join
            </button>
          </div>
        </div>
      </section>

      {/* your own Circuit(s): just yours, with the public-board opt-in */}
      {myPeople.length > 0 && (
        <section>
          <div className="cz-sec" style={{ marginBottom: '0.4rem' }}>
            Your Circuit{myPeople.length > 1 ? 's' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {myPeople.map((p) => (
              <div key={p.id} style={personRow(p.color)}>
                <strong style={{ color: p.color }}>{p.name}</strong>
                <span className="muted" style={{ fontSize: '0.76rem' }}>
                  ✓ yours
                </span>
                <button
                  className="btn btn-ghost"
                  onClick={() => setPublic(p.id, !p.isPublic)}
                  disabled={busy}
                  style={{ fontSize: '0.74rem', marginLeft: 'auto' }}
                  title="Whether your Circuit shows on the signed-out public board"
                >
                  {p.isPublic ? '🌎 Public — make private' : 'Make public'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* claiming is tucked away — only unclaimed people, only if you open it */}
      {claimable.length > 0 && (
        <section>
          <button
            className="btn btn-ghost"
            onClick={() => setClaimOpen((o) => !o)}
            style={{ fontSize: '0.8rem' }}
            aria-expanded={claimOpen}
          >
            {claimOpen ? '▾' : '▸'} Claim your Circuit
            {myPeople.length === 0 && (
              <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.74rem' }}>
                ({claimable.length} unclaimed)
              </span>
            )}
          </button>
          {claimOpen && (
            <div
              style={{
                marginTop: '0.55rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
              }}
            >
              <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
                If one of these unclaimed people is you, claim it to own your logs. Otherwise leave
                it — they’ll claim it when they sign in.
              </p>
              {claimable.map((p) => (
                <div key={p.id} style={personRow(p.color)}>
                  <strong style={{ color: p.color }}>{p.name}</strong>
                  <button
                    className="btn btn-ghost"
                    onClick={() => claim(p.id)}
                    disabled={busy}
                    style={{ fontSize: '0.78rem', marginLeft: 'auto' }}
                    title="Claim this Circuit as yours"
                  >
                    This is me
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {err && (
        <p style={{ color: '#ff5566', margin: 0, fontSize: '0.82rem' }} role="alert">
          {err}
        </p>
      )}
    </div>
  )
}
