// Who a pool is for — making one, renaming it, and choosing the people.
//
// ⚠️ THIS EXISTS BECAUSE THE ANSWER USED TO BE "MAKE A CIRCUIT". A pool was gated on circuit
// membership, so sharing a shortlist with two friends meant first creating a fitness board —
// people, goals, exercise grids — and getting them to join it. The audience mechanism was
// inherited from the feature next door rather than chosen for this one. What you actually want
// to say is "these three", and these three are already your friends.
//
// ⚠️ ONLY THE OWNER CHANGES ANY OF IT, enforced in the policies as well as here. Everyone in a
// pool can add options and vote — that is the point of sharing it — but who can see it is not a
// thing a guest gets to widen. A member's version of this sheet shows the roster and one button:
// leave.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { circuitStore } from '../store'
import { getSupabaseClientOrNull } from '../../finance/client'
import { Modal } from './Modal'
import type { Pool, PoolAudience } from '../types'

type Candidate = { user_id: string; name: string; is_friend: boolean }

const AUDIENCE_LABEL: Record<PoolAudience, string> = {
  just_me: 'Just me',
  friends: 'All my friends',
  selected: 'Only these people',
}
const AUDIENCE_HINT: Record<PoolAudience, string> = {
  just_me: 'A shortlist nobody else can see. You can open it up later.',
  /* ⚠️ says the quiet part. Your friends are not necessarily each other's friends, and a pool
     shows everyone in it who else is in it — better to know that before ticking, not after. */
  friends: 'Anyone you have added as a friend can add and vote — and can see each other here.',
  selected: 'Only the people you tick below.',
}

export function PoolSheet({
  pool,
  meId,
  onClose,
  onCreated,
}: {
  /** null = making a new one */
  pool: Pool | null
  meId: string | null
  onClose: () => void
  onCreated?: (id: string) => void
}) {
  const creating = pool === null
  /* see the same note in Watchlist: signed out there are no accounts, so a null owner on a
     sandbox pool is you. The server never stores a null owner. */
  const isOwner = creating || (meId ? pool.ownerUserId === meId : !pool.ownerUserId)

  const [name, setName] = useState(pool?.name ?? '')
  const [audience, setAudience] = useState<PoolAudience>(pool?.audience ?? 'friends')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /* ⚠️ Two presses, and the second one says what goes with it. Deleting a pool cascades to
     every option in it and every vote on those options, which is not a thing to hang off one
     mis-tap next to "Save". */
  const [confirmDel, setConfirmDel] = useState(false)

  const sb = useMemo(() => getSupabaseClientOrNull(), [])

  /* who you may put in a pool: the people this account can already see and message. Mirrors
     pool_can_invite() in the policies — the client must not offer what the server will refuse. */
  const loadCandidates = useCallback(async () => {
    if (!sb) return
    const { data } = await sb.rpc('list_member_directory')
    setCandidates(
      ((data as { user_id: string; name: string; is_friend: boolean }[] | null) ?? []).map((p) => ({
        user_id: p.user_id,
        name: p.name,
        is_friend: !!p.is_friend,
      })),
    )
  }, [sb])

  const loadMembers = useCallback(async () => {
    if (!sb || !pool) return
    const [people, resolved] = await Promise.all([
      sb.from('pool_people').select('user_id').eq('pool_id', pool.id),
      sb.rpc('pool_names', { p_pool: pool.id }),
    ])
    setChosen(new Set(((people.data as { user_id: string }[] | null) ?? []).map((r) => r.user_id)))
    const map: Record<string, string> = {}
    for (const r of (resolved.data as { user_id: string; name: string }[] | null) ?? [])
      map[r.user_id] = r.name
    setNames(map)
  }, [sb, pool])

  useEffect(() => {
    void loadCandidates()
    void loadMembers()
  }, [loadCandidates, loadMembers])

  /** Tick somebody on or off. Writes straight through for an existing pool; held for a new one. */
  async function toggle(userId: string) {
    const next = new Set(chosen)
    const removing = next.has(userId)
    if (removing) next.delete(userId)
    else next.add(userId)
    setChosen(next)
    if (creating || !pool || !sb) return
    setErr(null)
    const res = removing
      ? await sb.from('pool_people').delete().eq('pool_id', pool.id).eq('user_id', userId)
      : await sb.from('pool_people').insert({ pool_id: pool.id, user_id: userId })
    /* ⚠️ Put the tick back if the server said no. An optimistic checkbox that stays ticked
       after a refusal is the same lie as a save that quietly failed — you would only find out
       when they never turned up. */
    if (res.error) {
      setChosen(chosen)
      setErr(res.error.message)
    }
  }

  async function save() {
    const clean = name.trim() || 'Pool'
    setBusy(true)
    setErr(null)
    try {
      if (creating) {
        const id = crypto.randomUUID?.() ?? String(Date.now())
        await circuitStore.savePool({ id, name: clean, audience, ownerUserId: meId })
        if (sb && audience === 'selected' && chosen.size) {
          const { error } = await sb
            .from('pool_people')
            .insert([...chosen].map((user_id) => ({ pool_id: id, user_id })))
          if (error) throw error
        }
        onCreated?.(id)
      } else {
        await circuitStore.savePool({ ...pool, name: clean, audience })
      }
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function destroy() {
    if (!pool) return
    setBusy(true)
    setErr(null)
    try {
      await circuitStore.deletePool(pool.id)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete')
    } finally {
      setBusy(false)
    }
  }

  /** Take yourself out. The one change a guest is allowed to make. */
  async function leave() {
    if (!sb || !pool || !meId) return
    setBusy(true)
    const { error } = await sb
      .from('pool_people')
      .delete()
      .eq('pool_id', pool.id)
      .eq('user_id', meId)
    setBusy(false)
    if (error) setErr(error.message)
    else onClose()
  }

  const friends = candidates.filter((c) => c.is_friend)
  const others = candidates.filter((c) => !c.is_friend)
  const roster = [...chosen]

  return (
    <Modal
      title={creating ? 'New pool' : isOwner ? 'Pool settings' : (pool?.name ?? 'Pool')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {isOwner ? 'Cancel' : 'Close'}
          </button>
          {isOwner ? (
            <button
              className="btn"
              onClick={save}
              disabled={busy}
              style={{
                background: 'var(--accent,#7c6af7)',
                color: 'var(--btn-text)',
                borderColor: 'transparent',
              }}
            >
              {creating ? 'Make it' : 'Save'}
            </button>
          ) : (
            <button className="btn" onClick={leave} disabled={busy}>
              Leave this pool
            </button>
          )}
        </>
      }
    >
      {isOwner ? (
        <>
          <label style={{ display: 'grid', gap: 4, marginBottom: '0.8rem' }}>
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              What is it for?
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Friday film, lunch, board games…"
              autoFocus
            />
          </label>

          <div style={{ display: 'grid', gap: '0.35rem', marginBottom: '0.6rem' }}>
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              Who can see it
            </span>
            {(['just_me', 'friends', 'selected'] as PoolAudience[]).map((a) => (
              <button
                key={a}
                className={'cz-aud' + (audience === a ? ' is-on' : '')}
                onClick={() => setAudience(a)}
                aria-pressed={audience === a}
              >
                <strong>{AUDIENCE_LABEL[a]}</strong>
                <span className="muted">{AUDIENCE_HINT[a]}</span>
              </button>
            ))}
          </div>

          {audience === 'selected' && (
            <div className="cz-pick-people">
              {candidates.length === 0 && (
                <p className="muted" style={{ margin: 0, fontSize: '0.82rem' }}>
                  Nobody to add yet — add a friend on the People page first.
                </p>
              )}
              {[
                { label: 'Friends', list: friends },
                { label: 'People you share a circuit with', list: others },
              ].map(
                (grp) =>
                  grp.list.length > 0 && (
                    <div key={grp.label}>
                      <p
                        className="muted"
                        style={{ margin: '0.3rem 0 0.2rem', fontSize: '0.74rem' }}
                      >
                        {grp.label}
                      </p>
                      {grp.list.map((c) => (
                        <label key={c.user_id} className="cz-pick-row">
                          <input
                            type="checkbox"
                            checked={chosen.has(c.user_id)}
                            onChange={() => void toggle(c.user_id)}
                          />
                          <span>{c.name}</span>
                        </label>
                      ))}
                    </div>
                  ),
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            {pool?.audience === 'friends'
              ? 'Shared with the friends of whoever made it.'
              : 'Shared with the people picked by whoever made it.'}
          </p>
          {roster.length > 0 && (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              {roster.map((id) => names[id] ?? 'Someone').join(', ')}
            </p>
          )}
        </>
      )}

      {!creating && isOwner && (
        <p style={{ margin: '0.9rem 0 0' }}>
          {confirmDel ? (
            <>
              <button className="btn cz-danger" onClick={destroy} disabled={busy}>
                Delete “{pool.name}” and everything in it
              </button>{' '}
              <button className="btn" onClick={() => setConfirmDel(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button
              className="btn"
              onClick={() => setConfirmDel(true)}
              style={{ opacity: 0.6 }}
              disabled={busy}
            >
              Delete this pool
            </button>
          )}
        </p>
      )}

      {err && (
        <p style={{ color: '#fa4242', fontSize: '0.82rem', marginBottom: 0 }} role="alert">
          {err}
        </p>
      )}
    </Modal>
  )
}
