import { useEffect, useMemo, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'

type CircleMember = { username: string; name: string; friend: boolean }
type Circle = { id: string; name: string; created_at: string; members: CircleMember[] }
type Friend = { username: string; name: string; status: string; direction: string }

/**
 * Stand-in circles, so this card can be inspected in the workbench.
 *
 * ⚠️ A FUNCTION RATHER THAN A CONST, AND NOT EXPORTED, for the bundle reason written up at length
 * in previewMember.ts: a statement-level call at module scope is a side effect rollup cannot prove
 * pure, so it keeps the whole file, and an `export const` reachable from a lazily-loaded chunk
 * ships whatever it holds regardless of the `import.meta.env.DEV` guard. Built behind a function
 * and kept local, the branch folds and the fixture goes with it.
 *
 * Every name here is invented. This file is committed to a public repo.
 */
function previewCircles(): Circle[] {
  return [
    {
      id: 'pv-circle-near',
      name: 'Nearest',
      created_at: '2026-10-01T00:00:00Z',
      members: [
        { username: 'quill', name: 'Quill', friend: true },
        /* a membership whose friendship has ended: it counts for nothing and is still shown,
           because an owner who cannot see it cannot tidy it away */
        { username: 'tolliver', name: 'Tolliver', friend: false },
      ],
    },
    { id: 'pv-circle-empty', name: 'Workshop', created_at: '2026-10-02T00:00:00Z', members: [] },
  ]
}

function previewFriends(): Friend[] {
  return [
    { username: 'quill', name: 'Quill', status: 'accepted', direction: 'out' },
    { username: 'marlow', name: 'Marlow', status: 'accepted', direction: 'in' },
    { username: 'pending-pat', name: 'Pat', status: 'pending', direction: 'out' },
  ]
}

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
  padding: '0.5rem 0.7rem',
  background: 'var(--b1,rgba(127,127,127,0.06))',
  borderRadius: 8,
}

/** Small enough to read, big enough to hit: the WCAG floor is 24px and the root size is fluid. */
const small: React.CSSProperties = { fontSize: '0.78rem', minHeight: 26, padding: '0.15rem 0.5rem' }

/**
 * Certain friends — the named circles behind the narrowest sharing level.
 *
 * ⚠️ NAMING AND DELETING ARE BOTH INLINE, NOT `prompt()` AND `confirm()`. Those are what the rest
 * of the site reaches for, and in the Browser pane `window.prompt` THROWS outright while
 * `window.confirm` is auto-dismissed and returns false — so a flow built on them cannot be driven
 * or checked here at all, and reads as a crash or a dead button rather than as a limitation. An
 * inline field and a two-step delete are better on a phone anyway: there is no modal to mis-tap,
 * and the confirm step says what it will do.
 */
export function CirclesCard() {
  const sb = useMemo(() => getSupabaseClient(), [])
  const [circles, setCircles] = useState<Circle[] | null>(null)
  const [friends, setFriends] = useState<Friend[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  /**
   * ⚠️ THE ACCEPTED FILTER IS APPLIED TO BOTH PATHS IN ONE PLACE, and the first version applied
   * it only to the real one. `list_friends` returns pending requests too, and the server's
   * `are_friends` counts only `accepted` — so the workbench offered a pending friend the site
   * would never have offered, and adding them would have failed against a rule the UI appeared
   * not to know. A double that is more permissive than the thing it stands in for invents bugs
   * that are not there and hides the shape of the real one.
   */
  const load = async () => {
    const accepted = (list: Friend[]) => list.filter((x) => x.status === 'accepted')
    if (previewMember) {
      setCircles(previewCircles())
      setFriends(accepted(previewFriends()))
      return
    }
    const [c, f] = await Promise.all([
      sb.rpc('my_visibility_circles'),
      sb.rpc('list_friends').then((r) => r),
    ])
    setCircles((c.data as Circle[]) ?? [])
    setFriends(accepted((f.data as Friend[]) ?? []))
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb])

  /**
   * Every write goes through here so one place owns the error text and the reload.
   *
   * PromiseLike rather than Promise: a supabase RPC returns a builder that is thenable but has no
   * `catch` or `finally`, so the narrower type does not accept it.
   */
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    if (previewMember) return
    setBusy(true)
    setErr('')
    const { error } = await fn()
    if (error) setErr(error.message.replace(/^.*\bP0001\b[: ]*/, ''))
    else await load()
    setBusy(false)
  }

  if (circles === null) return null

  const create = async () => {
    const name = draft.trim()
    if (!name) return
    setDraft('')
    setAdding(false)
    await act(() => sb.rpc('visibility_circle_save', { p_id: null, p_name: name }))
  }

  const rename = async (id: string, name: string) => {
    setRenaming(null)
    if (!name.trim()) return
    await act(() => sb.rpc('visibility_circle_save', { p_id: id, p_name: name.trim() }))
  }

  const setMember = (id: string, username: string, isIn: boolean) =>
    act(() =>
      sb.rpc('visibility_circle_set_member', { p_id: id, p_username: username, p_in: isIn }),
    )

  return (
    <article className="card" style={{ display: 'grid', gap: '0.7rem' }}>
      <h3 style={{ margin: 0 }}>Your circles</h3>
      <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
        A circle is a smaller group than all your friends. Name one, put a few friends in it, and
        you can share something with just them.
      </p>

      {err && (
        <p className="muted" role="status" style={{ margin: 0, fontSize: '0.8rem' }}>
          {err}
        </p>
      )}

      {circles.length === 0 && !adding && (
        <p className="muted" style={{ margin: 0 }}>
          You haven’t made a circle yet.
        </p>
      )}

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {circles.map((c) => {
          const inCircle = new Set(c.members.map((m) => m.username))
          const canAdd = friends.filter((f) => !inCircle.has(f.username))
          return (
            <div key={c.id} style={{ ...row, flexDirection: 'column', alignItems: 'stretch' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
              >
                {renaming === c.id ? (
                  <input
                    autoFocus
                    defaultValue={c.name}
                    maxLength={40}
                    aria-label="Circle name"
                    style={{ flex: 1, minWidth: 120 }}
                    onBlur={(e) => void rename(c.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void rename(c.id, e.currentTarget.value)
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <strong style={{ flex: 1, minWidth: 0 }}>{c.name}</strong>
                )}
                <button
                  type="button"
                  className="btn"
                  style={small}
                  disabled={busy}
                  onClick={() => setRenaming(renaming === c.id ? null : c.id)}
                >
                  Rename
                </button>
                {confirming === c.id ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      style={small}
                      disabled={busy}
                      onClick={() =>
                        void act(() => sb.rpc('visibility_circle_delete', { p_id: c.id })).then(
                          () => setConfirming(null),
                        )
                      }
                    >
                      Delete “{c.name}”
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={small}
                      onClick={() => setConfirming(null)}
                    >
                      Keep it
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    style={small}
                    disabled={busy}
                    onClick={() => setConfirming(c.id)}
                  >
                    Delete
                  </button>
                )}
              </div>

              {c.members.length === 0 ? (
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  Nobody in it yet.
                </span>
              ) : (
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {c.members.map((m) => (
                    <span
                      key={m.username}
                      style={{ ...row, padding: '0.2rem 0.5rem', gap: '0.3rem' }}
                    >
                      <span style={{ minWidth: 0 }}>{m.name}</span>
                      {!m.friend && (
                        <span className="muted" style={{ fontSize: '0.72rem' }}>
                          not a friend any more
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn"
                        style={{ ...small, minWidth: 26 }}
                        disabled={busy}
                        aria-label={`Take ${m.name} out of ${c.name}`}
                        onClick={() => void setMember(c.id, m.username, false)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {canAdd.length > 0 && (
                <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: '0.78rem' }}>
                    Add
                  </span>
                  <select
                    value=""
                    disabled={busy}
                    style={{ flex: 1, minWidth: 0 }}
                    onChange={(e) => {
                      if (e.target.value) void setMember(c.id, e.target.value, true)
                    }}
                  >
                    <option value="">a friend…</option>
                    {canAdd.map((f) => (
                      <option key={f.username} value={f.username}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )
        })}
      </div>

      {adding ? (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <input
            autoFocus
            value={draft}
            maxLength={40}
            placeholder="Family, Work, Band…"
            aria-label="New circle name"
            style={{ flex: 1, minWidth: 120 }}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
              if (e.key === 'Escape') {
                setAdding(false)
                setDraft('')
              }
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={busy || !draft.trim()}
            onClick={() => void create()}
          >
            Make it
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setAdding(false)
              setDraft('')
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn"
          style={{ justifySelf: 'start', fontSize: '0.85rem' }}
          disabled={busy || circles.length >= 20}
          onClick={() => setAdding(true)}
        >
          {circles.length >= 20 ? 'That’s the most circles an account can have' : 'New circle'}
        </button>
      )}
    </article>
  )
}
