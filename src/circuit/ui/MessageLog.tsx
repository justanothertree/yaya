import { useEffect, useLayoutEffect, useRef } from 'react'
import { challengeRoomOf, challengeText } from '../../game/challenge'
import { boutCodeOf, boutInviteText } from '../../pets/boutInvite'
import { circuitInviteText, circuitJoinCodeOf } from '../inviteLink'
import type { Msg } from '../chatRooms'

const dayOf = (iso: string) => iso.slice(0, 10)
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * Who a message is from, for deciding whether two in a row are one person talking.
 *
 * ⚠️ BY NAME WHERE THERE IS NO ID, and that is the Lounge: the server withholds the author's id
 * there on purpose, so every lounge message has `null`, and grouping on the id alone would fold
 * a whole room into one speaker. The name is what the room is shown, so it is what a reader would
 * group by too.
 */
const speaker = (m: Msg) => (m.mine ? 'me' : (m.author_user_id ?? 'name:' + m.author_name))

/**
 * A conversation's messages, oldest first, pinned to the newest.
 *
 * ⚠️ IT WAS THREE LINES TALL PER MESSAGE WHATEVER THE MESSAGE SAID: a name, the words, and the
 * time on a line of its own, in a bubble as wide as the thread. "ok" took the same 62px as a
 * paragraph, so a 500px log held seven messages — which is what "a conversation only shows a few
 * messages" was. A bubble is as wide as its words now, the time sits beside the last of them,
 * and a run of messages from one person names them once. Measured on the same 40-message
 * thread before and after; the figures are in the commit that made the change.
 *
 * Shared by the chat page and the call anchor's panel, which is why it owns its own scrolling
 * rather than being handed a ref.
 */
export function MessageLog({
  msgs,
  empty,
  named = true,
}: {
  msgs: Msg[]
  empty?: string
  /**
   * Whether to put a name on the other side's messages. False for a DM: there are two of you,
   * the head of the thread already says who the other one is, and their name over every run
   * is a line spent telling you nothing.
   */
  named?: boolean
}) {
  const logRef = useRef<HTMLDivElement>(null)
  /** true while the reader is at (or near) the bottom — the only time new messages may pull */
  const pinned = useRef(true)
  const room = msgs[0]?.room_id ?? null
  const last = msgs[msgs.length - 1]

  const shown = useRef<string | null>(null)

  /**
   * Follow the newest message — unless the reader has scrolled up to read.
   *
   * ⚠️ The old code scrolled on every arrival, 60ms later on a timer. So reading back through a
   * busy room meant being thrown to the bottom each time anybody spoke. Your OWN message always
   * pulls: you sent it to see it land, and a different conversation always opens at its newest.
   * A layout effect, so the jump happens before the paint rather than a frame after it.
   */
  useLayoutEffect(() => {
    const el = logRef.current
    if (!el) return
    if (shown.current !== room) {
      shown.current = room
      pinned.current = true
    }
    if (pinned.current || last?.mine) el.scrollTop = el.scrollHeight
  }, [last?.id, last?.mine, room, msgs.length])

  /* The log's own box changes under a reader who has not moved: the keyboard opens, a challenge
     panel unfolds above it, a window is dragged shorter. If they were at the bottom they still
     should be — otherwise the newest message slides out from under the composer. */
  useEffect(() => {
    const el = logRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      className="cz-chat-log"
      ref={logRef}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
      }}
    >
      {msgs.length === 0 && (
        <p className="muted" style={{ margin: 'auto', fontSize: '0.85rem' }}>
          {empty ?? 'Nothing here yet — say the first thing.'}
        </p>
      )}
      {msgs.map((m, i) => {
        const prev = i > 0 ? msgs[i - 1] : null
        const newDay = !prev || dayOf(m.created_at) !== dayOf(prev.created_at)
        /* the first of a run: a new day, a new speaker, or a long enough silence to be a new
           thought — ten minutes, after which the time is worth saying again anyway */
        const first =
          newDay ||
          !prev ||
          speaker(prev) !== speaker(m) ||
          Date.parse(m.created_at) - Date.parse(prev.created_at) > 10 * 60000
        const card = challengeRoomOf(m.body)
          ? {
              say: challengeText(m.body),
              href: `#snake?room=${encodeURIComponent(challengeRoomOf(m.body)!)}`,
              label: '🎮 Join the game',
            }
          : boutCodeOf(m.body)
            ? {
                say: boutInviteText(m.body),
                href: `#games?play=fight&bout=${encodeURIComponent(boutCodeOf(m.body)!)}`,
                label: '⚔️ Join the scrap',
              }
            : circuitJoinCodeOf(m.body)
              ? {
                  say: circuitInviteText(m.body),
                  href: `#circuit?join=${encodeURIComponent(circuitJoinCodeOf(m.body)!)}`,
                  label: '🏆 Join the circuit',
                }
              : null
        return (
          <div key={m.id} className={'cz-msg-row' + (first ? ' is-first' : '')}>
            {newDay && <div className="muted cz-msg-day">{dayOf(m.created_at)}</div>}
            <div className={'cz-msg' + (m.mine ? ' is-mine' : '')}>
              {named &&
                !m.mine &&
                first &&
                (m.author_username ? (
                  <a
                    className="cz-msg-author"
                    href={'#profile?u=' + encodeURIComponent(m.author_username)}
                    title={`See ${m.author_name}'s profile`}
                  >
                    {m.author_name}
                  </a>
                ) : (
                  // no username means the server withheld it (the Lounge): a name with
                  // nowhere to go, which is the whole point of the pseudonym
                  <div className="cz-msg-author cz-msg-author-plain">{m.author_name}</div>
                ))}
              {/* A Snake challenge, a scrap invite and a circuit invite are ordinary messages
                  with a link in them — see game/challenge.ts, pets/boutInvite.ts and
                  circuit/inviteLink.ts. One card for all three so they read alike, and each
                  falls back to plain text if its link is malformed. */}
              <div className="cz-msg-line">
                {card ? (
                  <div className="cz-challenge">
                    {card.say && <div className="cz-challenge-say">{card.say}</div>}
                    <a className="btn cz-challenge-join" href={card.href}>
                      {card.label}
                    </a>
                  </div>
                ) : (
                  <span className="cz-msg-body">{m.body}</span>
                )}
                <span className="cz-msg-time">{timeOf(m.created_at)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
