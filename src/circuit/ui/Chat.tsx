import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '../../finance/client'
import {
  previewMember,
  PREVIEW_ME,
  previewMsgs,
  PREVIEW_PEOPLE,
  PREVIEW_UNREAD,
  previewOverview,
  previewOpenDm,
  PREVIEW_LOUNGE_IN,
} from '../../dev/previewMember'
import { notificationsChanged } from '../../hooks/notifySignal'
import { useRoomPresence } from '../../voice/useRoomPresence'
import { VoiceBar } from '../../voice/VoiceBar'
import { challengeRoomOf, challengeText } from '../../game/challenge'
import { boutCodeOf, boutInviteText } from '../../pets/boutInvite'
import { circuitInviteText, circuitJoinCodeOf } from '../inviteLink'
import { usePeople, type Person } from '../usePeople'
import { ChatList, PersonAvatar } from './ChatList'
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

type Msg = {
  id: string
  room_id: string
  /** null in the Lounge — see list_room_messages. Never read it to decide "is this mine". */
  author_user_id: string | null
  author_name: string
  /** present only when the author's identity is theirs to show; null makes the name unlinkable */
  author_username: string | null
  mine: boolean
  body: string
  created_at: string
}

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
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** a refusal that happened in the LIST — shown there, since on a phone the thread is hidden */
  const [listErr, setListErr] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
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

  const scrollDown = useCallback(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  // load + live-follow the open room
  useEffect(() => {
    if (previewMember) {
      if (room) {
        // Mirror what list_room_messages does server-side, so the harness exercises the real
        // rule: identity everywhere except the lounge, where the name stays unlinkable.
        setMsgs(
          (previewMsgs()[room.id] ?? []).map((m) => ({
            id: m.id,
            room_id: m.room_id,
            author_user_id: room.kind === 'lounge' ? null : m.user_id,
            author_name: m.author_name,
            author_username:
              room.kind === 'lounge'
                ? null
                : (PREVIEW_PEOPLE.find((p) => p.name === m.author_name)?.username ?? null),
            mine: m.user_id === PREVIEW_ME.id,
            body: m.body,
            created_at: m.created_at,
          })),
        )
        setTimeout(scrollDown, 60)
      }
      return
    }
    if (!sb || !room) return
    let live = true
    // ⚠️ Through the RPC, not `from('chat_messages').select('*')`. The RPC returns an identity
    // only where it's the author's to show. The table itself no longer holds one for the
    // Lounge at all — see the lounge_message_authors migration — so neither this read nor the
    // realtime payload below can carry the alias away, whichever way someone reaches for it.
    void sb.rpc('list_room_messages', { p_room: room.id, p_limit: 50 }).then(({ data, error }) => {
      if (!live) return
      if (error) setErr(error.message)
      else {
        setMsgs(((data as Msg[]) ?? []).reverse())
        setTimeout(scrollDown, 60)
      }
    })
    const ch = sb
      // private: gated on being in this room, so a non-member can't even hold the subscription
      // open. The row payloads were already filtered by chat_messages' RLS — this is depth.
      .channel('chat:' + room.id, { config: { private: true } })
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          // The raw table row. `user_id` is null for every lounge message now — the column
          // holds nothing there, so this payload cannot carry the alias away with it.
          const row = payload.new as {
            id: string
            room_id: string
            user_id: string | null
            author_name: string
            body: string
            created_at: string
          }
          setMsgs((prev) => {
            if (prev.some((x) => x.id === row.id)) return prev
            // Resolve the username the way the RPC would, from authors already loaded for THIS
            // room, rather than trusting anything in the payload. Guarded on a non-null id:
            // matching null against null would pair a lounge message with the first other
            // lounge message in the list, which is the exact link this is meant to prevent.
            const known = row.user_id ? prev.find((x) => x.author_user_id === row.user_id) : null
            const m: Msg = {
              id: row.id,
              room_id: row.room_id,
              author_user_id: known ? row.user_id : null,
              author_name: row.author_name,
              author_username: known?.author_username ?? null,
              // A lounge echo of your OWN message has no id to match, so it can't be
              // recognised as yours here — the optimistic append in send() already added it
              // with mine:true, and this dedupes against that by id.
              mine: !!row.user_id && row.user_id === me,
              body: row.body,
              created_at: row.created_at,
            }
            return [...prev, m]
          })
          setTimeout(scrollDown, 60)
          // We're looking at it, so keep it read. The bell reloads off this same INSERT,
          // so without announcing after the write lands it races us and badges a room
          // you are actively reading — with nothing left to re-read and clear it.
          void sb.rpc('mark_room_read', { p_room: row.room_id }).then(() => notificationsChanged())
        },
      )
      .subscribe((status, err) => {
        if (status !== 'SUBSCRIBED' && status !== 'CLOSED')
          console.warn(
            `[realtime] chat:<room>: ${status}${err ? ` — ${err.message}` : ''} (not live)`,
          )
      })
    return () => {
      live = false
      void sb.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, authed])

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
    setMsgs([])
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
        setMsgs([])
      }
      await loadOverview()
    }
    setLoungeBusy(false)
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!room || !draft.trim() || sending) return
    if (previewMember) {
      const fixture = {
        id: 'pv' + Date.now(),
        room_id: room.id,
        user_id: PREVIEW_ME.id,
        author_name: PREVIEW_ME.name,
        body: draft.trim(),
        created_at: new Date().toISOString(),
      }
      setMsgs((prev) => [
        ...prev,
        { ...fixture, author_user_id: fixture.user_id, author_username: null, mine: true },
      ])
      previewMsgs()[room.id] = [...(previewMsgs()[room.id] ?? []), fixture]
      setDraft('')
      setTimeout(scrollDown, 60)
      return
    }
    if (!sb) return
    setSending(true)
    setErr(null)
    const { data, error } = await sb.rpc('send_chat_message', {
      p_room: room.id,
      p_body: draft.trim(),
    })
    setSending(false)
    if (error) {
      setErr(error.message)
      return
    }
    setDraft('')
    // ⚠️ send_chat_message returns a SET now, so this is an array — and it returns the same
    // shape list_room_messages does rather than the raw row. That shape is the fix for two
    // things at once: the raw row had no `mine` flag (so your own message rendered as
    // somebody else's until a reload), and in the lounge it no longer says who wrote it even
    // to the person who did.
    const m = (data as unknown as Msg[] | null)?.[0]
    if (m?.id) setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    setTimeout(scrollDown, 60)
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

  const dayOf = (iso: string) => iso.slice(0, 10)
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

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

              <div className="cz-chat-log">
                {msgs.length === 0 && (
                  <p className="muted" style={{ margin: 'auto', fontSize: '0.85rem' }}>
                    Nothing here yet — say the first thing.
                  </p>
                )}
                {msgs.map((m, i) => {
                  const mine = m.mine
                  const newDay = i === 0 || dayOf(m.created_at) !== dayOf(msgs[i - 1].created_at)
                  return (
                    <div key={m.id}>
                      {newDay && (
                        <div
                          className="muted"
                          style={{ textAlign: 'center', fontSize: '0.7rem', margin: '0.35rem 0' }}
                        >
                          {dayOf(m.created_at)}
                        </div>
                      )}
                      <div
                        style={{
                          maxWidth: '85%',
                          marginLeft: mine ? 'auto' : 0,
                          padding: '0.4rem 0.6rem',
                          borderRadius: 10,
                          background: mine
                            ? 'var(--accent, #7c6af7)'
                            : 'var(--card2, rgba(127,127,127,0.15))',
                          color: mine ? 'var(--btn-text, #fff)' : 'var(--text, #eeeef8)',
                        }}
                      >
                        {!mine &&
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
                        {/* A Snake challenge is an ordinary message with a room link in it. Shown
                          as a card with a Join button rather than a URL to squint at — and it
                          still falls back to the plain text if the link is malformed. */}
                        {challengeRoomOf(m.body) ? (
                          <div className="cz-challenge">
                            {challengeText(m.body) && (
                              <div className="cz-challenge-say">{challengeText(m.body)}</div>
                            )}
                            <a
                              className="btn cz-challenge-join"
                              href={`#snake?room=${encodeURIComponent(challengeRoomOf(m.body)!)}`}
                            >
                              🎮 Join the game
                            </a>
                          </div>
                        ) : boutCodeOf(m.body) ? (
                          /* A scrap invite is the same idea again, with the bout code in the link —
                           see src/pets/boutInvite.ts. Same card, so all three read alike. */
                          <div className="cz-challenge">
                            {boutInviteText(m.body) && (
                              <div className="cz-challenge-say">{boutInviteText(m.body)}</div>
                            )}
                            <a
                              className="btn cz-challenge-join"
                              href={`#games?play=fight&bout=${encodeURIComponent(boutCodeOf(m.body)!)}`}
                            >
                              ⚔️ Join the scrap
                            </a>
                          </div>
                        ) : circuitJoinCodeOf(m.body) ? (
                          /* A circuit invite is the same idea with a different link — see
                           src/circuit/inviteLink.ts. Same card so both read alike. */
                          <div className="cz-challenge">
                            {circuitInviteText(m.body) && (
                              <div className="cz-challenge-say">{circuitInviteText(m.body)}</div>
                            )}
                            <a
                              className="btn cz-challenge-join"
                              href={`#circuit?join=${encodeURIComponent(circuitJoinCodeOf(m.body)!)}`}
                            >
                              🏆 Join the circuit
                            </a>
                          </div>
                        ) : (
                          <div
                            style={{
                              fontSize: '0.9rem',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {m.body}
                          </div>
                        )}
                        <div style={{ fontSize: '0.65rem', opacity: 0.7, textAlign: 'right' }}>
                          {timeOf(m.created_at)}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={endRef} />
              </div>

              {err && (
                <p
                  className="muted"
                  style={{ margin: 0, fontSize: '0.8rem', color: 'var(--accent-2, #ff5566)' }}
                >
                  {err}
                </p>
              )}

              <form
                className="cz-chat-form"
                onSubmit={send}
                style={{ display: 'flex', gap: '0.4rem' }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Message ${room.name}`}
                  maxLength={2000}
                  style={{ flex: 1, padding: '0.55rem 0.7rem', borderRadius: 10 }}
                />
                <button className="btn" disabled={!draft.trim() || sending} type="submit">
                  {sending ? '…' : 'Send'}
                </button>
              </form>
            </>
          ) : (
            <p className="muted cz-thread-empty">Pick a friend or a room to start reading.</p>
          )}
        </div>
      </div>
    </div>
  )
}
