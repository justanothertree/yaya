import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useVoiceSession } from './useVoiceSession'
import type { VoicePeer } from './voiceSession'
import { callWord, peerWord, speakingNames } from './callWords'
import { CallRoster } from './CallRoster'
import { party, routeIsPrivate } from '../party/party'
import { together } from '../party/together'
import { shared } from '../party/shared'

/**
 * A call now outlives the screen it started on, which is what makes it usable — but a call
 * you can't see is worse than one that hangs up. This is the small floating strip that
 * follows you across every page while you're connected: who you're with, how loud they are,
 * mute, hang up, and a way back to the conversation.
 *
 * It also owns the audio elements. They used to live in the chat thread, so navigating away
 * unmounted them and the other person went silent even though the connection was fine.
 */

const VOL_KEY = 'voice.volume.v1'

function readVol(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOL_KEY) ?? '1')
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
  } catch {
    return 1
  }
}

/**
 * The element exists to keep the remote track flowing — some browsers won't deliver one
 * without a media sink attached. When Web Audio is handling playback (which is what lets
 * volume exceed 100%) this stays muted so nothing is heard twice; if Web Audio failed it
 * plays normally, capped at source level.
 */
function PeerAudio({
  peer,
  fallbackVolume,
  webAudio,
}: {
  peer: VoicePeer
  fallbackVolume: number
  webAudio: boolean
}) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !peer.stream) return
    el.srcObject = peer.stream
    void el.play().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [peer.stream])
  // Applied separately so dragging a slider never re-attaches the stream — re-attaching
  // mid-call causes an audible gap.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.muted = webAudio
    el.volume = Math.min(1, fallbackVolume)
  }, [fallbackVolume, webAudio])
  return <audio ref={ref} autoPlay playsInline />
}

export function CallDock() {
  const [rosterOpen, setRosterOpen] = useState(false)
  const {
    inCall,
    roomId,
    roomName,
    peers,
    muted,
    leave,
    toggleMute,
    peerVolume,
    setMaster,
    usesWebAudio,
    sharing,
    shareError,
    shareMode,
    crowded,
    startShare,
    stopShare,
    setShareMode,
  } = useVoiceSession()
  const [volume, setVolume] = useState(readVol)

  useEffect(() => {
    setMaster(volume)
    try {
      localStorage.setItem(VOL_KEY, String(volume))
    } catch {
      /* private mode — it just won't persist */
    }
  }, [volume, setMaster])

  /**
   * Tell the stylesheet a call is up, and how tall this thing actually is.
   *
   * The dock is fixed and floats over whatever is beneath it, which is fine on a document and
   * wrong on the chat screen, where the composer lives at exactly that height. Rather than
   * writing the dock's height into the chat rule as a constant, publish it: a second line of
   * status text or a longer room name changes this box, and the composer should move with it
   * instead of quietly ending up underneath.
   *
   * Set above the early return so both tokens still clear when the call ends.
   */
  const pointers = useSyncExternalStore(party.subscribe, party.getState, party.getState).sharing
  const shareAll = useSyncExternalStore(together.subscribe, together.getState, together.getState).on
  const sharedState = useSyncExternalStore(shared.subscribe, shared.getState, shared.getState)
  /**
   * ⚠️ Derived from the store snapshot rather than memoised on its own, so it cannot go stale:
   * offers arrive and expire on a sweep, and a list that updated only when this component felt
   * like it would show people who stopped sharing minutes ago.
   */
  const sharers = shared.sharers()
  // recomputed on every render rather than watched: the dock re-renders on navigation anyway,
  // and a hashchange listener here would be a second copy of the one party.ts already keeps
  const onPrivatePage = routeIsPrivate()

  const dockRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = document.documentElement
    if (!inCall) return
    el.dataset.inCall = '1'
    const node = dockRef.current
    const publish = () => {
      const h = node?.getBoundingClientRect().height ?? 0
      el.style.setProperty('--dock-h', `${Math.round(h)}px`)
    }
    publish()
    const ro = node ? new ResizeObserver(publish) : null
    if (node && ro) ro.observe(node)
    return () => {
      ro?.disconnect()
      delete el.dataset.inCall
      el.style.removeProperty('--dock-h')
    }
  }, [inCall])

  if (!inCall) return null

  return (
    <div className="call-dock" role="status" aria-live="polite" ref={dockRef}>
      <span className="voice-dot" aria-hidden />
      {/* Tapping the room name takes you back to the conversation the call is in — you can
          wander off mid-call, and finding your way back shouldn't mean hunting for it. */}
      <a
        className="call-dock-who"
        href={roomId ? `#chat?room=${roomId}` : '#chat'}
        title={peers.map(peerWord).join('\n') || `Back to ${roomName}`}
      >
        <strong>{roomName}</strong>
        {/* Who's talking wins over the roster while it's happening — that's the information
            you want mid-call, and it's the Discord cue Evan's friends asked for. */}
        {speakingNames(peers).length > 0 ? (
          <span className="call-dock-talking">🗣 {speakingNames(peers).join(', ')}</span>
        ) : (
          <span className="muted">{callWord(peers)}</span>
        )}
      </a>
      <label className="call-vol" title={`Their volume: ${Math.round(volume * 100)}%`}>
        <span aria-hidden>{volume === 0 ? '🔈' : '🔊'}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          aria-label="Call volume"
        />
      </label>
      {/* Says the size and why it matters, rather than just going choppy and leaving people
          to guess. This is also the instrument for finding the real ceiling: when a call of
          this size genuinely struggles, CALL_SOFT_LIMIT is the number to bring down. */}
      {crowded && (
        <span
          className="muted call-dock-crowded"
          title={`Everyone sends their voice to everyone, so each person is handling ${peers.length} streams. Big calls can get choppy.`}
        >
          ⚠ {peers.length + 1} in call
        </span>
      )}
      {/* One roster button, showing the headcount at a glance — the same information the
          talking-names line already implies, but as a stable count you can click through. */}
      <button
        className={'btn' + (rosterOpen ? ' is-on' : '')}
        onClick={() => setRosterOpen((v) => !v)}
        aria-pressed={rosterOpen}
        title="Who's in this call"
      >
        👥 {peers.length + 1}
      </button>
      {rosterOpen && <CallRoster onClose={() => setRosterOpen(false)} />}
      {/* A refusal has to be SEEN. This lived only in the button's tooltip, so hitting share
          with too many people in the call looked like the button was broken. */}
      {shareError && (
        <span className="call-dock-shareerr" role="status" title={shareError}>
          {shareError}
        </span>
      )}
      {/* Beside mute, because sharing your screen is the same KIND of decision: what of mine
          is going out to the room. */}
      {/* Only while sharing: a mode switch with nothing to switch is just clutter. One button
          that names what you'd be GOING to, so it reads as an action rather than a status. */}
      {sharing && (
        <button
          className="btn"
          onClick={() => void setShareMode(shareMode === 'motion' ? 'detail' : 'motion')}
          title={
            shareMode === 'motion'
              ? 'Sharing smoothly for games. Switch to sharp text for showing work.'
              : 'Sharing sharp for text. Switch to smooth for games.'
          }
        >
          {shareMode === 'motion' ? '🎮' : '🔤'}
        </button>
      )}
      {/**
       * Pointer sharing.
       *
       * ⚠️ It lives HERE rather than in Appearance with the other toggles, because it is not
       * a preference — it is a live broadcast, and the control for a broadcast belongs next to
       * the indicator that you are on the air. It also resets every page load on purpose, which
       * would be baffling behaviour for something filed under settings.
       *
       * Disabled rather than hidden on a private page, with the reason in the tooltip: a
       * control that vanishes looks like a bug, and the fact that this page is excluded is
       * exactly the thing worth telling you.
       */}
      {/**
       * ⚠️ ONE SWITCH FOR THREE MECHANISMS, and it belongs HERE rather than in any of them.
       *
       * Playing together, drawing together and sharing a window each have their own on-switch
       * inside their own room, so sharing three things meant visiting three rooms. The switch
       * that means "all of it" cannot live in one of the three; it lives with the call, which is
       * the only place all three are true at once, and is where you are standing when you decide.
       *
       * It shares and never follows: what other people are offering still waits for you to join
       * it, because offering costs a room nothing while adopting somebody's settings changes what
       * is on your screen.
       */}
      <button
        className={'btn' + (shareAll ? ' is-on' : '')}
        onClick={() => together.setOn(!shareAll)}
        aria-pressed={shareAll}
        title={
          shareAll
            ? 'Sharing everything you open — the instrument, the drawing, the visualiser'
            : 'Share everything you open with the call, instead of switching each room on'
        }
      >
        {shareAll ? '🤝' : '🫱'}
      </button>
      {/**
       * ⚠️ ONE BUTTON PER PERSON, NOT ONE PER WINDOW, because what made this manual was never
       * the first join — it was the second and the third. They open the instrument, you join;
       * they open the visualiser, you join again. "I am watching what Josh is doing" is one
       * decision, and shared.ts remembers it so windows they open later come along too.
       *
       * Still a decision, though: nobody is followed until you say so, and touching any control
       * of theirs hands that window — and the standing answer — back to you.
       */}
      {sharers.map((p) => {
        const on = sharedState.followingAll.includes(p.by)
        return (
          <button
            key={p.by}
            className={'btn' + (on ? ' is-on' : '')}
            aria-pressed={on}
            onClick={() => (on ? shared.unfollowAll(p.by) : shared.followAll(p.by))}
            title={
              on
                ? `Stop following ${p.name}`
                : `Follow everything ${p.name} is showing — ${p.count} open now, and whatever they open next`
            }
          >
            {on ? '👀' : '👁'} {p.name.split(' ')[0]}
          </button>
        )
      })}
      <button
        className={'btn' + (pointers ? ' is-on' : '')}
        onClick={() => party.setSharing(!pointers)}
        aria-pressed={pointers}
        disabled={!pointers && onPrivatePage}
        title={
          onPrivatePage
            ? 'This page is never shared — your pointer stays private here'
            : pointers
              ? 'Stop sharing your pointer'
              : 'Show your pointer to the call, and see theirs. Off again when you reload.'
        }
      >
        {pointers ? '↖️' : '↗'}
      </button>
      <button
        className={'btn' + (sharing ? ' is-on' : '')}
        onClick={() => (sharing ? stopShare() : void startShare())}
        aria-pressed={sharing}
        title={
          shareError ?? (sharing ? 'Stop sharing your screen' : 'Share your screen with the call')
        }
      >
        {sharing ? '🖥️' : '🖵'}
      </button>
      <button
        className={'btn' + (muted ? ' is-muted' : '')}
        onClick={toggleMute}
        aria-pressed={muted}
        title={muted ? 'Unmute your microphone' : 'Mute your microphone'}
      >
        {muted ? '🔇' : '🎙'}
      </button>
      {/* wrapped so the click event isn't passed as leave()'s `silent` flag — see VoiceBar */}
      <button className="btn voice-leave" onClick={() => leave()} title="Leave the call">
        Leave
      </button>
      {/* Audio lives here so it survives navigation. Only peers that actually sent a
          stream — a failed peer has none, and an <audio> with a null source is noise. */}
      {peers
        .filter((p) => p.stream)
        .map((p) => (
          <PeerAudio
            key={p.id}
            peer={p}
            fallbackVolume={volume * (peerVolume[p.id] ?? 0.5) * 2}
            webAudio={usesWebAudio()}
          />
        ))}
    </div>
  )
}
