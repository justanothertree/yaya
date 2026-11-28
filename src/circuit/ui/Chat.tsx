import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../../finance/client'
import {
  previewMember,
  PREVIEW_ME,
  PREVIEW_UNREAD,
  previewOverview,
  previewOpenDm,
  PREVIEW_LOUNGE_IN,
} from '../../dev/previewMember'
import { notificationsChanged } from '../../hooks/notifySignal'
import { useRoomPresence } from '../../voice/useRoomPresence'
import { VoiceBar } from '../../voice/VoiceBar'
import { usePeople, type Person } from '../usePeople'
import { ChatList, PersonAvatar } from './ChatList'
import { MessageLog } from './MessageLog'
import { Composer } from './Composer'
import { sendToThread, useThread } from '../roomThread'
import { roomIcon, seenWord, type Overview } from '../chatRooms'
import { ProfileChallenge } from '../../lab/matches/ProfileChallenge'

/**
 * Chat — a real messaging screen, not a row of room chips. The left side is your friends, each
 * one a conversation, with the group rooms and the rest of the directory under them (ChatList);
 * the right side is whichever one is open. On a phone the two take turns, on a wide screen they
 * sit side by side. One rooms model still serves every shape: each circuit has a room, The
 * Lounge is everyone with an account, and DMs come from friendships.
 *
 * Reads ride RLS directly (realtime included); sends go through send_chat_message, which
 * resolves the author's name server-side so it can't be spoofed. The list comes from
 * list_chat_overview, and opening a room calls mark_room_read to clear its badge.
 */

export function Chat({
  authed = false,
  voiceIn = {},
}: {
  authed?: boolean
  /** who is in each room's call, subscribed once in App — see useVoicePresence */
  voiceIn?: Record<string, string[]>
}) {
  // DEV member preview: render with fake rooms/messages, no Supabase session (see previewMember)
  const sb = authed && !previewMember ? getSupabaseClient() : null
  const [rooms, setRooms] = useState<Overview[]>([])
  const [room, setRoom] = useState<Overview | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /** a refusal that happened in the LIST — shown there, since on a phone the thread is hidden */
  const [listErr, setListErr] = useState<string | null>(null)
  const [me, setMe] = useState<string | null>(previewMember ? PREVIEW_ME.id : null)
  // Your own name, for voice. It used to be the literal string 'You', which meant every
  // participant announced themselves as "You" — so the call read "in call with You", two
  // friends showed as "You, You", and the presence count never rose above 1 because they
  // all shared one identity. A real name per person fixes all three.
  const [myName, setMyName] = useState<string>(previewMember ? 'Preview You' : 'You')
  /**
   * What OTHER Lounge members see you as — deliberately separate from `myName`.
   *
   * The Lounge is the one room open to every opted-in account rather than to friends or
   * circuit-mates, which is why joining it asks for a name at all. Publishing `myName` in its
   * presence strip would hand back the real identity that name exists to keep out of it.
   */
  const [myLoungeName, setMyLoungeName] = useState<string | null>(null)
  // The Lounge is opt-in: nobody is placed in a room with every other account by
  // default. null = not looked up yet, so the invite card doesn't flash on load.
  const [loungeIn, setLoungeIn] = useState<boolean | null>(previewMember ? PREVIEW_LOUNGE_IN : null)
  /**
   * "N here" now means CURRENTLY VIEWING the Lounge, not "has ever opted in" -- the earlier
   * version (get_lounge_names) answered the second question while the label claimed the
   * first, which is how it ended up saying "5 here" to an empty room. Real-time presence,
   * tracked only while this thread is actually the one open.
   */
  const loungeNames = useRoomPresence(
    !previewMember && room?.kind === 'lounge' ? room.id : null,
    me,
    // the Lounge name, never the real one — see myLoungeName above
    myLoungeName ?? myName,
  )
  const [loungeBusy, setLoungeBusy] = useState(false)
  /* the directory and your standing with everyone in it — presence only with a real session */
  const ppl = usePeople(authed, previewMember ? null : me)
  /** the friend whose conversation is being opened (or created) right now */
  const [opening, setOpening] = useState<string | null>(null)
  const [challenging, setChallenging] = useState(false)
  // Live occupancy for every conversation you can see, so a call in progress is visible from
  // the list without opening it. ⚠️ Handed down rather than subscribed here: the bell needs
  // the same presence to notify you about a call while you're on another page, and two
  // subscribers to one `vp:<room>` topic is not two channels — realtime-js dedupes by topic,
  // so whichever one tears down first takes the other's subscription with it.

  const loadOverview = useCallback(async () => {
    if (previewMember) {
      setRooms(previewOverview())
      return
    }
    if (!sb) return
    const { data } = await sb.rpc('list_chat_overview')
    if (data) setRooms(data as Overview[])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  // initial load — plus a ?room= deep link (the profile's Message button) opens that thread
  useEffect(() => {
    let live = true
    if (previewMember) {
      const list = previewOverview()
      setRooms(list)
      const wanted = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('room')
      if (wanted) {
        const r = list.find((x) => x.id === wanted) ?? null
        setRoom(r)
        // arriving straight into a room (from the bell, or a profile's Message button) has
        // to clear its unread the same way tapping the row does — it didn't, so the badge
        // kept counting messages you were literally looking at
        if (r) {
          PREVIEW_UNREAD[r.id] = 0
          setRooms((prev) => prev.map((x) => (x.id === r.id ? { ...x, unread: 0 } : x)))
        }
      }
      return
    }
    if (!sb) return
    void sb.auth.getSession().then(({ data }) => live && setMe(data.session?.user.id ?? null))
    void sb.rpc('get_my_profile').then(({ data }) => {
      const row = (Array.isArray(data) ? data[0] : data) as {
        nickname?: string | null
        first_name?: string | null
        username?: string | null
      } | null
      // same order the server's display_name() resolver uses
      const n = row?.nickname || row?.first_name || row?.username
      if (live && n) setMyName(n)
    })
    void sb.rpc('my_lounge_opt_in').then(({ data }) => live && setLoungeIn(data === true))
    // What to announce yourself as in the Lounge specifically. Falls back to the same chain as
    // `myName` server-side when no Lounge name was chosen, so this is only ever different when
    // the person deliberately picked one.
    void sb
      .rpc('my_lounge_display_name')
      .then(({ data }) => live && typeof data === 'string' && data && setMyLoungeName(data))
    void sb.rpc('list_chat_overview').then(({ data }) => {
      if (!live || !data) return
      const rs = data as Overview[]
      setRooms(rs)
      const wanted = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('room')
      if (wanted) {
        const r = rs.find((x) => x.id === wanted) ?? null
        setRoom(r)
        if (r) {
          setRooms((prev) => prev.map((x) => (x.id === r.id ? { ...x, unread: 0 } : x)))
          void sb.rpc('mark_room_read', { p_room: r.id }).then(() => notificationsChanged())
        }
      }
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  // keep the conversation list fresh: any message we're allowed to see bumps it. RLS applies
  // to realtime too, so this only ever fires for rooms we're actually in.
  useEffect(() => {
    // Also gated on being signed in, not just on having a client: the topic is private now, so
    // a signed-out visitor would be refused rather than silently receiving nothing. They have
    // no conversations either way, so the subscription was always pointless for them.
    if (!sb || !authed) return
    const ch = sb
      .channel('chat:overview', { config: { private: true } })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => void loadOverview(),
      )
      .subscribe((status, err) => {
        if (status !== 'SUBSCRIBED' && status !== 'CLOSED')
          console.warn(
            `[realtime] chat:overview: ${status}${err ? ` — ${err.message}` : ''} (not live)`,
          )
      })
    return () => {
      void sb.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  /**
   * A ?room= link has to work when this screen is already open. It was only read on mount, so
   * tapping an unread DM in the bell did nothing if you happened to be on the chat page — the
   * hash changed under a mounted component and nobody was listening.
   */
  useEffect(() => {
    const onHash = () => {
      const wanted = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('room')
      if (!wanted) return
      setRooms((prev) => {
        const hit = prev.find((x) => x.id === wanted)
        if (hit) {
          setRoom(hit)
          if (previewMember) {
            PREVIEW_UNREAD[hit.id] = 0
            notificationsChanged()
          } else if (sb) {
            void sb.rpc('mark_room_read', { p_room: hit.id }).then(() => notificationsChanged())
          }
          return prev.map((x) => (x.id === hit.id ? { ...x, unread: 0 } : x))
        }
        return prev
      })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed])

  /* the open room's messages, loaded and followed live — shared with the call anchor's panel
     when that is showing the same conversation, see roomThread.ts */
  const thread = useThread(room?.id ?? null, room?.kind ?? '')
  const msgs = thread.msgs

  function openRoom(r: Overview) {
    setRoom(r)
    setErr(null)
    setListErr(null)
    setChallenging(false)
    // clear the badge locally right away, then persist it
    setRooms((prev) => prev.map((x) => (x.id === r.id ? { ...x, unread: 0 } : x)))
    if (previewMember) {
      PREVIEW_UNREAD[r.id] = 0
      notificationsChanged()
      return
    }
    // Tapping a row doesn't change the hash, so the bell has no other way to learn this
    // room is read. Announce only once the write lands, or it re-counts what we just read.
    if (sb) void sb.rpc('mark_room_read', { p_room: r.id }).then(() => notificationsChanged())
  }

  /**
   * Open the conversation with a friend — the one you already have, or a new one.
   *
   * ⚠️ A FRIEND YOU HAVE NEVER MESSAGED HAS NO ROOM, and the old conversation list could not
   * show them at all: it listed rooms, so the only way to start talking to somebody was to go
   * to another page and press Message there. open_dm is that button's own call — it returns the
   * existing room or makes one, and refuses anybody who is not an accepted friend.
   */
  async function openPerson(p: Person) {
    const have = rooms.find((r) => r.kind === 'dm' && !!p.user_id && r.peer_user_id === p.user_id)
    if (have) return openRoom(have)
    setErr(null)
    if (previewMember) {
      const made = previewOpenDm(p.username)
      if (!made) return
      const list = previewOverview()
      setRooms(list)
      const r = list.find((x) => x.id === made)
      if (r) openRoom(r)
      return
    }
    if (!sb || opening) return
    setOpening(p.username)
    const { data, error } = await sb.rpc('open_dm', { p_username: p.username })
    if (error || !data) {
      setOpening(null)
      setListErr(error?.message ?? `Could not open a conversation with ${p.name}.`)
      return
    }
    const { data: fresh } = await sb.rpc('list_chat_overview')
    setOpening(null)
    const list = (fresh as Overview[] | null) ?? rooms
    setRooms(list)
    /* A brand-new room has no message, and the overview may order or omit it differently from
       a room with history — so fall back to a row built from what is already known rather than
       leaving the tap with nothing to open. */
    openRoom(
      list.find((r) => r.id === data) ?? {
        id: data as string,
        kind: 'dm',
        name: p.name,
        last_body: null,
        last_author: null,
        last_at: null,
        unread: 0,
        peer_user_id: p.user_id ?? null,
      },
    )
  }

  function backToList() {
    setRoom(null)
    void loadOverview()
  }

  // Joining/leaving changes what chat_room_member() allows, so the room appears in
  // or vanishes from list_chat_overview on the next load — no local splicing needed.
  async function setLounge(on: boolean) {
    if (!sb || loungeBusy) return
    /**
     * Asked ONCE, at join -- the Lounge is the one room broader than friends/circuit, so this
     * is the one place a chosen name matters. Friends/circuit-mates elsewhere already know who
     * you are; a room open to every opted-in member is different, and the name asked for here
     * is what OTHER lounge members see, not your real name.
     */
    let name: string | undefined
    if (on) {
      const raw = window.prompt(
        'What name should other Lounge members see you as? Leave blank to use your usual name.',
      )
      if (raw === null) return // cancelled -- do not opt in
      name = raw.trim()
    }
    setLoungeBusy(true)
    setErr(null)
    const { error } = await sb.rpc('set_lounge_opt_in', { p_on: on })
    if (!error && on && name) {
      await sb.rpc('set_lounge_display_name', { p_name: name })
      // locally too, so the presence strip announces the chosen name on this visit rather than
      // the real one until the next reload
      setMyLoungeName(name)
    }
    if (error) {
      setErr(error.message)
    } else {
      setLoungeIn(on)
      if (!on && room?.kind === 'lounge') {
        setRoom(null)
      }
      await loadOverview()
    }
    setLoungeBusy(false)
  }

  if (!authed && !previewMember)
    return (
      <p className="muted" style={{ margin: 0 }}>
        Chat is for members — sign in and your crew&apos;s room is waiting.
      </p>
    )

  /* the person a DM is with, when the directory knows them — see Overview.peer_user_id */
  const peer =
    room?.kind === 'dm' && room.peer_user_id
      ? (ppl.people.find((p) => p.user_id === room.peer_user_id) ?? null)
      : null
  const peerSeen = peer?.user_id ? ppl.online[peer.user_id] : undefined

  return (
    /* ⚠️ THE OUTER BOX IS A SIZE CONTAINER, and that is what decides one pane or two. The rule
       used to ask the SCREEN (max-width: 640px), and this component also lives in a canvas
       window, which is as narrow as you drag it on a screen as wide as you like — so a 430px
       window kept both panes and the conversation got what was left. Measured: 77px. */
    <div className="cz-chat-box">
      <div className="cz-chat" data-view={room ? 'thread' : 'list'}>
        {/* ── friends, rooms and the directory ──────────────────────────── */}
        <ChatList
          ppl={listErr ? { ...ppl, err: ppl.err ?? listErr } : ppl}
          rooms={rooms}
          openId={room?.id ?? null}
          voiceIn={voiceIn}
          onOpenRoom={openRoom}
          onOpenPerson={(p) => void openPerson(p)}
          opening={opening}
          lounge={{
            offer: loungeIn === false,
            busy: loungeBusy,
            join: () => void setLounge(true),
          }}
        />

        {/* ── the open thread ───────────────────────────────────────────── */}
        <div className="cz-chat-thread">
          {room ? (
            <>
              <div className="cz-thread-head">
                <button
                  className="cz-thread-back"
                  onClick={backToList}
                  aria-label="Back to messages"
                >
                  ‹
                </button>
                {peer ? (
                  /* Whose conversation this is, as a person rather than a room name: their
                   avatar and presence, and the name is the way to their profile — which is
                   what their row in the directory used to be before it became this thread. */
                  <a
                    className="cz-thread-who"
                    href={'#profile?u=' + encodeURIComponent(peer.username)}
                    title={`See ${peer.name}'s profile`}
                  >
                    <PersonAvatar person={peer} seen={peerSeen} />
                    <span className="cz-person-text">
                      <span className="cz-thread-name">{peer.name}</span>
                      <span className="cz-person-handle muted">
                        @{peer.username}
                        {peerSeen && <> · {seenWord(peerSeen)}</>}
                      </span>
                    </span>
                  </a>
                ) : (
                  <>
                    <span className="cz-thread-ic" aria-hidden>
                      {roomIcon(room.kind)}
                    </span>
                    <span className="cz-thread-name">{room.name}</span>
                  </>
                )}
                {/* Beside the Call button underneath, so the two things you do WITH a person —
                  talk to them and play them — start from the conversation you have with them.
                  ⚠️ Friends only, and the server asks again: lab_match_challenge refuses
                  anybody who is not an accepted friend, so a DM left over from a friendship
                  that ended is not offered a button that could only fail. */}
                {peer?.rel === 'friend' && (
                  <button
                    className={'btn cz-thread-act' + (challenging ? ' is-on' : '')}
                    aria-expanded={challenging}
                    aria-controls="profile-challenge"
                    onClick={() => setChallenging((v) => !v)}
                  >
                    🎲 Challenge
                  </button>
                )}
                {room.kind === 'lounge' && loungeIn && (
                  <button
                    className="btn btn-ghost cz-thread-leave"
                    onClick={() => void setLounge(false)}
                    disabled={loungeBusy}
                    title="Stop seeing The Lounge. You can rejoin any time."
                  >
                    {loungeBusy ? 'Leaving…' : 'Leave'}
                  </button>
                )}
              </div>
              {/* Plain text, deliberately NOT links to a profile. Someone chose a name here
                specifically so the Lounge wouldn't reveal who they really are -- turning that
                name into a click-through to their real profile would undo the entire point. */}
              {room.kind === 'lounge' && loungeNames.length > 0 && (
                <div className="cz-lounge-whos-here muted">
                  {loungeNames.length} here: {loungeNames.join(', ')}
                </div>
              )}

              {challenging && peer?.rel === 'friend' && (
                <div className="cz-thread-challenge">
                  <ProfileChallenge
                    key={peer.username}
                    username={peer.username}
                    name={peer.name}
                    friendId={peer.user_id}
                  />
                </div>
              )}

              {/* Voice only makes sense with a real session — the DEV harness has no peers. */}
              {!previewMember && sb && me && (
                <VoiceBar
                  roomId={room.id}
                  roomName={room.name}
                  meId={me}
                  myName={myName}
                  // presence is already loaded for the room list — it is the only count of who
                  // is in a call, since nothing server-side keeps a tally
                  occupancy={voiceIn[room.id]?.length ?? 0}
                  roomKind={
                    room.kind === 'lounge' || room.kind === 'dm' || room.kind === 'circuit'
                      ? room.kind
                      : undefined
                  }
                />
              )}

              <MessageLog msgs={msgs} named={room.kind !== 'dm'} songs={thread.songs} />

              {(err ?? thread.err) && (
                <p className="muted cz-chat-err" role="alert">
                  {err ?? thread.err}
                </p>
              )}

              <Composer
                key={room.id}
                keep={`thread:${room.id}`}
                placeholder={`Message ${room.name}`}
                onSend={(text) => sendToThread(room.id, text)}
              />
            </>
          ) : (
            <p className="muted cz-thread-empty">Pick a friend or a room to start reading.</p>
          )}
        </div>
      </div>
    </div>
  )
}
