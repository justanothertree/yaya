import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { useVoiceSession } from './useVoiceSession'

/**
 * Who's in the call — the Discord-style member list.
 *
 * A separate panel from the dock on purpose: the dock is a control strip you glance at, this is
 * something you open to look someone up. Usernames are resolved in one batched call rather than
 * per-peer, and a peer who resolves to nobody (a preview/guest session, or profile lookup failing)
 * just loses the two buttons — the row still shows, because "who's talking" matters even then.
 */

type Resolved = { username: string | null }

export function CallRoster({ onClose }: { onClose: () => void }) {
  const { peers } = useVoiceSession()
  const [names, setNames] = useState<Record<string, Resolved>>({})

  useEffect(() => {
    const ids = peers.map((p) => p.id)
    if (!ids.length) return
    let live = true
    getSupabaseClient()
      .rpc('get_usernames_for_users', { p_user_ids: ids })
      .then(({ data }) => {
        if (!live || !data) return
        const next: Record<string, Resolved> = {}
        for (const row of data as Array<{ user_id: string; username: string }>) {
          next[row.user_id] = { username: row.username }
        }
        setNames(next)
      })
    return () => {
      live = false
    }
    // re-resolve when the ROSTER changes, not on every field of every peer (speaking/share churn)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers.map((p) => p.id).join(',')])

  /** Same flow as the People directory: open (or create) the DM room, then navigate to it. */
  const message = async (username: string) => {
    const { data, error } = await getSupabaseClient().rpc('open_dm', { p_username: username })
    if (!error && data) window.location.hash = '#chat?room=' + data
  }

  const statusWord = (p: (typeof peers)[number]) =>
    p.status === 'connecting'
      ? 'connecting…'
      : p.status === 'reconnecting'
        ? 'reconnecting…'
        : p.status === 'failed'
          ? 'couldn’t connect'
          : p.relayed
            ? 'relayed'
            : null

  return (
    <div className="callroster" role="dialog" aria-label="Who's in the call">
      <div className="callroster-head">
        <strong>In this call</strong>
        <button className="btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <ul className="callroster-list">
        {/* you first, and not clickable to your own profile — the row is about the roster,
            not a redundant link to yourself */}
        <li className="callroster-row">
          <span className={'callroster-dot' + ' is-connected'} aria-hidden />
          <span className="callroster-name">You</span>
        </li>
        {peers.map((p) => {
          const username = names[p.id]?.username
          const status = statusWord(p)
          return (
            <li className="callroster-row" key={p.id}>
              <span
                className={
                  'callroster-dot' +
                  (p.speaking ? ' is-speaking' : p.status === 'connected' ? ' is-connected' : '')
                }
                aria-hidden
              />
              <span className="callroster-name">{p.name}</span>
              {status && <span className="muted callroster-status">{status}</span>}
              {username && (
                <span className="callroster-actions">
                  <a
                    className="btn"
                    href={`#profile?u=${encodeURIComponent(username)}`}
                    title="View profile"
                  >
                    👤
                  </a>
                  <button className="btn" onClick={() => void message(username)} title="Message">
                    💬
                  </button>
                </span>
              )}
            </li>
          )
        })}
        {!peers.length && <li className="muted callroster-empty">Nobody else here yet.</li>}
      </ul>
    </div>
  )
}
