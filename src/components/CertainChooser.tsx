import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'
import { useFriendRoster, type Circle } from './friendRoster'

/** case-insensitive, because the server matches on `lower(username)` */
const has = (list: string[], u: string) => list.some((x) => x.toLowerCase() === u.toLowerCase())

/**
 * WHO, EXACTLY — the list behind the "Certain friends" level.
 *
 * ⚠️ IT EDITS A LIST OF USERNAMES AND SAVES NOTHING. Two surfaces need this and they persist
 * differently: a profile block has no id the client ever sees (every save deletes the page and
 * re-inserts it, minting fresh uuids), so its list travels inside the save payload; a chronicle
 * activity, a circuit person and the activity stream all have stable ids and go through
 * `visibility_certain_set`. A component that owned the saving would have to know which, so it
 * owns neither and the caller decides.
 *
 * ⚠️ A CIRCLE IS A SHORTCUT, NOT A LIVE GROUP — Evan's decision, and the copy says so out loud
 * because the opposite is the natural assumption. Pressing a circle copies its people into this
 * list and the two stop being related: editing the circle next week does not change who can see
 * anything already set. The alternative sounds tidier and is a mechanism by which somebody's
 * audience changes while they are not looking.
 *
 * ⚠️ AND AN EMPTY LIST MEANS ONLY ME, said in those words. It is the one state where a privacy
 * control looks half-finished and is in fact at its strictest, so leaving it unsaid invites
 * somebody to assume the level has not taken effect yet.
 */
export function CertainChooser({
  value,
  onChange,
  disabled = false,
  label = 'Who, exactly?',
}: {
  /** usernames currently on the list */
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  label?: string
}) {
  const roster = useFriendRoster()

  const toggle = (u: string) =>
    onChange(
      has(value, u) ? value.filter((x) => x.toLowerCase() !== u.toLowerCase()) : [...value, u],
    )

  const fill = (c: Circle) => {
    const next = [...value]
    for (const m of c.members) if (!has(next, m.username)) next.push(m.username)
    onChange(next)
  }

  if (!roster) return <p className="vis-hint muted">Loading your friends…</p>

  if (roster.friends.length === 0)
    return (
      <p className="vis-hint muted">
        {/* ⚠️ The honest empty state. "Certain friends" with no friends to choose is not a broken
            control, and it is not Only me by accident either — it is Only me until there is
            somebody to pick, which is worth saying rather than rendering an empty row. */}
        You haven’t added any friends yet, so this is the same as <strong>Only me</strong> for now.
      </p>
    )

  return (
    <div className="certain-chooser">
      <div className="vis-label">{label}</div>
      <div className="certain-names" role="group" aria-label={label}>
        {roster.friends.map((f) => {
          const on = has(value, f.username)
          return (
            <button
              key={f.username}
              type="button"
              className={'vis-opt' + (on ? ' is-on' : '')}
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(f.username)}
              /* the username as well as the name, because two friends can share a first name and
                 the list is stored by username */
              title={on ? `Remove ${f.name} (@${f.username})` : `Add ${f.name} (@${f.username})`}
            >
              {on ? '✓ ' : ''}
              {f.name}
            </button>
          )
        })}
      </div>

      {roster.circles.length > 0 && (
        <div className="certain-circles">
          <span className="muted">Fill from a circle</span>
          {roster.circles.map((c) => (
            <button
              key={c.id}
              type="button"
              className="btn certain-circle-btn"
              disabled={disabled || c.members.length === 0}
              onClick={() => fill(c)}
              title={
                c.members.length === 0
                  ? `${c.name} has nobody in it yet`
                  : `Add everyone in ${c.name} to this list`
              }
            >
              {c.name}
              {c.members.length > 0 ? ` (${c.members.length})` : ''}
            </button>
          ))}
        </div>
      )}

      <p className="vis-hint muted">
        {value.length === 0 ? (
          <>
            <strong>Nobody chosen</strong> — that means only you, the same as Only me.
          </>
        ) : (
          <>
            {value.length} {value.length === 1 ? 'person' : 'people'}. A circle just fills this in;
            changing the circle later won’t change who can see this.
          </>
        )}
      </p>
    </div>
  )
}

/**
 * The same chooser, for an item that HAS an id — and so saves itself.
 *
 * ⚠️ TWO PERSISTENCE SHAPES, BECAUSE THE ITEMS GENUINELY DIFFER. A profile block has no id the
 * client ever holds, so its list rides along in the page save; a circuit person, a chronicle
 * activity, a chronicle goal and the activity stream each have a stable id and go through
 * `visibility_certain_set`. The chooser above knows about neither — this wrapper is the second
 * half for the second case, and `VisibilityPicker` takes either.
 *
 * ⚠️ IT RECONCILES AGAINST THE COUNT THE SERVER RETURNS, which is the point of that return value.
 * `visibility_certain_set` keeps only accepted friends and silently drops the rest — the right
 * rule, since the picker can be filled from a circle holding somebody who has drifted — so a
 * reply shorter than what was sent means somebody was left off, and saying nothing would leave a
 * ✓ on screen beside a person who cannot see the thing.
 */
export function CertainForItem({
  kind,
  id,
  disabled = false,
  label,
}: {
  /** one of `owns_item`'s kinds: profile_block, chronicle_activity, chronicle_goal,
      circuit_person, player_registry, profile_activity */
  kind: string
  id: string
  disabled?: boolean
  label?: string
}) {
  const [names, setNames] = useState<string[] | null>(previewMember ? [] : null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data } = await getSupabaseClient().rpc('visibility_certain_get', {
      p_kind: kind,
      p_id: id,
    })
    const rows = (data as { username: string }[] | null) ?? []
    setNames(rows.map((r) => r.username))
  }

  useEffect(() => {
    if (previewMember) return
    let alive = true
    void getSupabaseClient()
      .rpc('visibility_certain_get', { p_kind: kind, p_id: id })
      .then(({ data }) => {
        if (!alive) return
        const rows = (data as { username: string }[] | null) ?? []
        setNames(rows.map((r) => r.username))
      })
    return () => {
      alive = false
    }
  }, [kind, id])

  if (names === null) return <p className="vis-hint muted">Loading who you’ve chosen…</p>

  const save = async (next: string[]) => {
    /* shown immediately, then reconciled: a privacy toggle that waits for a round trip before
       moving feels broken, and the reconcile below is what keeps the optimism honest */
    setNames(next)
    setErr('')
    if (previewMember) return
    setBusy(true)
    const { data, error } = await getSupabaseClient().rpc('visibility_certain_set', {
      p_kind: kind,
      p_id: id,
      p_usernames: next,
    })
    if (error) {
      setErr(error.message.replace(/^.*\bP0001\b[: ]*/, ''))
      await load()
    } else if (typeof data === 'number' && data !== next.length) {
      setErr('Some of those aren’t friends any more, so they were left off.')
      await load()
    }
    setBusy(false)
  }

  return (
    <>
      <CertainChooser
        value={names}
        onChange={(next) => void save(next)}
        disabled={disabled || busy}
        {...(label ? { label } : {})}
      />
      {err && (
        <p className="vis-hint" role="status" style={{ color: 'var(--danger, #e06c75)' }}>
          {err}
        </p>
      )}
    </>
  )
}
