// The left-hand side of Chat: your friends, each one a conversation, with the group rooms under
// them and the rest of the directory under that.
//
// ⚠️ THIS WAS TWO PAGES. People listed everybody and offered a 💬 Message button that navigated to
// Chat; Chat listed conversations by room name and could not tell you who was online, who had
// asked to be friends, or how to talk to a friend you had never messaged. Each page was the
// other's missing half, and the trip between them was the feature. A friend IS a conversation —
// so the row for one opens the thread, and the thread's head is where you call or challenge them.
//
// Grouped rather than flat, because the groups are what you act on: requests waiting on you come
// first (they are the only rows with a decision attached), then your friends, then the rooms that
// are not one person, then everyone else.
import { useEffect, useState } from 'react'
import { cursorMark } from '../../ui/cursorSkin'
import type { Seen } from '../../hooks/usePresence'
import {
  myStatus,
  onStatusChange,
  setMyStatus,
  STATUS_OPTIONS,
  type MyStatus,
} from '../../hooks/presenceStatus'
import { avatarStyle } from '../../profile/look'
import type { PeopleState, Person } from '../usePeople'
import { roomIcon, seenWord, type Overview } from '../chatRooms'

/** compact "when" for a conversation row: 4:07 PM today, weekday this week, else a date */
function whenLabel(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const days = (now.getTime() - d.getTime()) / 86400000
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}

/**
 * Your own status, on the list that shows everybody else's.
 *
 * ⚠️ IT LIVED IN THE ACCOUNT MENU, behind the initial, between "Reduce motion" and "Call
 * sound" — so the directory showed a green dot beside every person on it except the one reading
 * it, and the control for that dot was three taps away in a panel about preferences. Availability
 * is not a preference like text size; it is a thing you change because of what you are doing
 * right now, and you change it while looking at who else is around.
 *
 * ⚠️ Invisible is offered plainly rather than hidden as an advanced option. Somebody who wants
 * to be here without being seen should not have to hunt for it, and SeenStatus deliberately has
 * no such value — nobody can tell the difference between invisible and offline.
 */
function MyPresence() {
  const [mine, setMine] = useState<MyStatus>(() => myStatus())
  useEffect(() => onStatusChange(() => setMine(myStatus())), [])
  return (
    <div className="ppl-me" role="group" aria-label="Your status">
      <span className="muted" style={{ fontSize: '0.78rem' }}>
        You&apos;re
      </span>
      {STATUS_OPTIONS.map(([id, dot, label]) => (
        <button
          key={id}
          className={'ppl-me-btn' + (mine === id ? ' is-on' : '')}
          aria-pressed={mine === id}
          onClick={() => setMyStatus(id)}
          title={
            id === 'invisible'
              ? 'Nothing is broadcast at all — not hidden, not sent'
              : `Show as ${label.toLowerCase()}`
          }
        >
          <span aria-hidden>{dot}</span> {label}
        </button>
      ))}
    </div>
  )
}

/**
 * The badge on somebody's avatar: that they are here, and which pointer they are here with.
 *
 * ⚠️ THEIR ACTUAL CURSOR, NOT A STAND-IN FOR IT. The skins are SVG bodies, so this is the very
 * shape on the end of their hand in their accent colour — which is the whole reason to show it
 * rather than another dot. Somebody wearing the system pointer has nothing to show and keeps the
 * plain dot, so a list is a mix of the two by design.
 *
 * ⚠️ AND AWAY STAYS TELLABLE BY SHAPE. The plain dot goes hollow for away, deliberately, because
 * a difference that is only a hue is invisible to a good share of people — a pointer cannot do
 * that trick, its shape is already saying who. So away gets a ring around it AND is faded, two
 * differences rather than one, on top of the word beside the name that says it outright.
 *
 * ⚠️ AN <img>, NOT INLINE MARKUP. The colour inside that SVG came off a socket from another
 * member's browser. cursorMark refuses anything that is not a hex, and an SVG loaded through an
 * img cannot run script even if it had not — two locks, because the repo is public and a patched
 * client is an afternoon's work.
 */
function Beacon({ seen }: { seen: Seen }) {
  const mark = cursorMark(seen.skin, seen.tint)
  return (
    <span
      className={'cz-person-online' + (mark ? ' has-mark' : '')}
      data-status={seen.status}
      title={seen.status === 'away' ? 'Away' : 'Online now'}
    >
      {mark && <img src={mark} alt="" width={20} height={20} draggable={false} />}
    </span>
  )
}

/**
 * Somebody's initial in their own colour — the same one their profile opens in, so the list
 * reads as a row of people rather than identical initials — with the presence badge on it.
 *
 * A missing `seen` covers offline AND invisible with one answer, deliberately: if those two
 * rendered differently, invisible would be detectable and therefore pointless. See usePresence.
 */
export function PersonAvatar({ person, seen }: { person: Person; seen?: Seen }) {
  return (
    <span className="cz-person-av" aria-hidden style={avatarStyle(person.username)}>
      {(person.name[0] ?? '★').toUpperCase()}
      {seen && <Beacon seen={seen} />}
    </span>
  )
}

export function ChatList({
  ppl,
  rooms,
  openId,
  voiceIn,
  onOpenRoom,
  onOpenPerson,
  opening,
  lounge,
}: {
  ppl: PeopleState
  rooms: Overview[]
  /** the conversation open in the thread pane, if any */
  openId: string | null
  /** who is in each room's call — see useVoicePresence */
  voiceIn: Record<string, string[]>
  onOpenRoom: (r: Overview) => void
  /** open the conversation with a friend, creating it if the two of you have never talked */
  onOpenPerson: (p: Person) => void
  /** the username whose conversation is being opened right now */
  opening: string | null
  /** The Lounge's invitation, when it is not yet one of your rooms */
  lounge: { offer: boolean; busy: boolean; join: () => void }
}) {
  const { groups, online, q, busy } = ppl
  const seenOf = (p: Person) => (p.user_id ? online[p.user_id] : undefined)

  /* every DM that belongs to somebody in the directory, by their id */
  const dmOf = new Map<string, Overview>()
  for (const r of rooms) if (r.kind === 'dm' && r.peer_user_id) dmOf.set(r.peer_user_id, r)
  const roomFor = (p: Person) => (p.user_id ? dmOf.get(p.user_id) : undefined)

  /**
   * ⚠️ WHOEVER IS WAITING ON YOU COMES FIRST, then whoever you spoke to last — and only WITHIN
   * the friends group. A person does not jump to another section because a message arrived: a
   * list whose shape changes as people write to you is one you cannot learn. They rise among
   * your friends and carry a count.
   */
  const friends = [...groups.friends].sort((a, b) => {
    const ra = roomFor(a)
    const rb = roomFor(b)
    return (
      (rb?.unread ?? 0) - (ra?.unread ?? 0) ||
      (rb?.last_at ?? '').localeCompare(ra?.last_at ?? '') ||
      a.name.localeCompare(b.name)
    )
  })
  const friendIds = new Set(ppl.people.filter((p) => p.rel === 'friend').map((p) => p.user_id))

  /* The rooms that are not one of the friend rows above: every group, and a DM with somebody who
     is not (or is no longer) a friend — which still has its history and must stay reachable. */
  const needle = q.trim().replace(/^@/, '').toLowerCase()
  const otherRooms = rooms.filter(
    (r) =>
      !(r.kind === 'dm' && r.peer_user_id && friendIds.has(r.peer_user_id)) &&
      (!needle || r.name.toLowerCase().includes(needle)),
  )

  const voiceChip = (roomId: string | undefined) =>
    /* Someone's in there right now — shown before the unread count, because a live call is a
       reason to act and an unread message is a reason to read. */
    roomId && (voiceIn[roomId]?.length ?? 0) > 0 ? (
      <span
        className="cz-conv-voice"
        title={`In the call: ${voiceIn[roomId].join(', ')}`}
        aria-label={`${voiceIn[roomId].length} in the call`}
      >
        🎙 {voiceIn[roomId].length}
      </span>
    ) : null

  const friendRow = (p: Person) => {
    const r = roomFor(p)
    const seen = seenOf(p)
    return (
      <button
        key={p.username}
        className={'cz-conv cz-conv-person' + (r && openId === r.id ? ' is-open' : '')}
        onClick={() => onOpenPerson(p)}
        disabled={opening === p.username}
        aria-busy={opening === p.username}
      >
        <PersonAvatar person={p} seen={seen} />
        <span className="cz-conv-main">
          <span className="cz-conv-top">
            <span className="cz-conv-name">{p.name}</span>
            <span className="cz-conv-when muted">{whenLabel(r?.last_at ?? null)}</span>
          </span>
          <span className="cz-conv-last muted">
            {/* presence in words first: it is the one thing on this line that is about NOW */}
            {seen && <span className="cz-conv-seen">{seenWord(seen)} · </span>}
            {r?.last_body ?? (seen ? `@${p.username}` : `@${p.username} · say hi`)}
          </span>
        </span>
        {voiceChip(r?.id)}
        {(r?.unread ?? 0) > 0 && (
          <span className="cz-conv-badge" aria-label={`${r?.unread} unread`}>
            {r?.unread}
          </span>
        )}
      </button>
    )
  }

  const roomRow = (r: Overview) => (
    <button
      key={r.id}
      className={'cz-conv' + (openId === r.id ? ' is-open' : '')}
      onClick={() => onOpenRoom(r)}
    >
      <span className="cz-conv-ic" aria-hidden>
        {roomIcon(r.kind)}
      </span>
      <span className="cz-conv-main">
        <span className="cz-conv-top">
          <span className="cz-conv-name">{r.name}</span>
          <span className="cz-conv-when muted">{whenLabel(r.last_at)}</span>
        </span>
        <span className="cz-conv-last muted">
          {r.last_body ? (
            <>
              {r.kind !== 'dm' && r.last_author ? `${r.last_author}: ` : ''}
              {r.last_body}
            </>
          ) : (
            'No messages yet'
          )}
        </span>
      </span>
      {voiceChip(r.id)}
      {r.unread > 0 && <span className="cz-conv-badge">{r.unread}</span>}
    </button>
  )

  /** somebody you cannot message yet: the row is their profile, the button is your standing */
  const personRow = (p: Person) => (
    <div key={p.username} className="cz-person">
      <a
        className="cz-person-main"
        href={'#profile?u=' + encodeURIComponent(p.username)}
        title={`See ${p.name}'s profile`}
      >
        <PersonAvatar person={p} seen={seenOf(p)} />
        <span className="cz-person-text">
          <span className="cz-person-name">{p.name}</span>
          <span className="cz-person-handle muted">
            @{p.username}
            {seenOf(p) && <> · {seenWord(seenOf(p))}</>}
          </span>
        </span>
      </a>
      <span className="cz-person-actions">
        {p.rel === 'in' && (
          <>
            <button
              className="btn cz-tap"
              disabled={busy === p.username}
              onClick={() => void ppl.act(p.username, 'accept')}
              style={{
                background: 'var(--accent, #7c6af7)',
                color: 'var(--btn-text)',
                borderColor: 'transparent',
              }}
            >
              Accept
            </button>
            <button
              className="btn cz-tap"
              disabled={busy === p.username}
              onClick={() => void ppl.act(p.username, 'decline')}
            >
              Decline
            </button>
          </>
        )}
        {/* a friend turned up by the handle lookup: same door as their row in the list */}
        {p.rel === 'friend' && (
          <button
            className="btn cz-tap"
            disabled={opening === p.username}
            onClick={() => onOpenPerson(p)}
          >
            💬 Message
          </button>
        )}
        {p.rel === 'out' && (
          <button
            className="btn cz-tap"
            disabled={busy === p.username}
            onClick={() => void ppl.act(p.username, 'remove')}
            title="Cancel request"
            style={{ opacity: 0.7 }}
          >
            Requested
          </button>
        )}
        {p.rel === 'none' && (
          <button
            className="btn cz-tap"
            disabled={busy === p.username}
            onClick={() => void ppl.act(p.username, 'add')}
          >
            ＋ Add
          </button>
        )}
      </span>
    </div>
  )

  const section = (title: string, count: number, body: React.ReactNode) => (
    <div className="cz-list-sec">
      <div className="cz-sec">
        {title} {count > 0 && `(${count})`}
      </div>
      {body}
    </div>
  )

  const nothingMatches =
    !!needle &&
    groups.requests.length + friends.length + groups.others.length + otherRooms.length === 0

  return (
    <div className="cz-chat-list">
      <MyPresence />
      <input
        className="cz-list-search"
        value={q}
        onChange={(e) => ppl.setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void ppl.lookUp()}
        placeholder="Search, or type an exact @handle"
        aria-label="Search friends and conversations"
      />

      {ppl.err && (
        <p className="muted cz-list-note" style={{ color: 'var(--accent-2, #ff5566)' }}>
          {ppl.err}
        </p>
      )}

      {ppl.found !== null &&
        (ppl.found.length > 0 ? (
          section('Found', ppl.found.length, ppl.found.map(personRow))
        ) : (
          <p className="muted cz-list-note">No member with the handle “{q.trim()}”.</p>
        ))}

      {/* The directory only lists people you already share something with, so somebody new is
          found by their exact handle — offered the moment a search comes back with nothing. */}
      {needle.length >= 2 && ppl.found === null && nothingMatches && (
        <p className="muted cz-list-note">
          Nobody you know matches that.{' '}
          <button className="btn cz-tap" onClick={() => void ppl.lookUp()} disabled={ppl.looking}>
            {ppl.looking ? 'Looking…' : `Look up @${needle}`}
          </button>
        </p>
      )}

      {groups.requests.length > 0 &&
        section('Wants to be friends', groups.requests.length, groups.requests.map(personRow))}

      {/* Always present, even empty: it is the section the page is for, and its empty state is
          the instruction for filling it. Dropped only while a search is narrowing the list. */}
      {(friends.length > 0 || !needle) &&
        section(
          'Friends',
          friends.length,
          friends.length > 0 ? (
            friends.map(friendRow)
          ) : (
            <p className="muted cz-list-note">
              No friends yet. Add someone from the list below, or search for their @handle.
            </p>
          ),
        )}

      {otherRooms.length > 0 &&
        section('Groups and rooms', otherRooms.length, otherRooms.map(roomRow))}

      {/* The Lounge is the one room that isn't yours by default — offer it rather than assuming
          it. Hidden until we know the answer, so it can't flash. */}
      {lounge.offer && !needle && (
        <div className="cz-lounge-invite">
          <span className="cz-lounge-ic" aria-hidden>
            🛋️
          </span>
          <div className="cz-lounge-copy">
            <strong>The Lounge</strong>
            <span className="muted">One open room shared by everyone with an account.</span>
          </div>
          <button className="btn" onClick={lounge.join} disabled={lounge.busy}>
            {lounge.busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      )}

      {groups.others.length > 0 &&
        section('People in your circles', groups.others.length, groups.others.map(personRow))}
    </div>
  )
}
