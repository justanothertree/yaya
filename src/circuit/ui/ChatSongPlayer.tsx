import { useRef, useState } from 'react'
import {
  afterPlayError,
  lengthLabel,
  playUrl,
  removeSong,
  startedPlaying,
  stoppedPlaying,
  type ChatSong,
} from '../chatSongs'
import { refreshSongs } from '../roomThread'

/**
 * A song sent into a chat, drawn where its message is (chatSongs.ts).
 *
 * ⚠️ NOTHING IS FETCHED UNTIL ▶ IS PRESSED. A thread can hold a dozen songs and most will never be
 * played, and each link is signed for an hour — so the press asks for one, and only then are the
 * `<audio>`'s own controls shown.
 *
 * ⚠️ THE `<audio>` IS THERE FROM THE START, HIDDEN, AND ▶ PLAYS IT BEFORE THERE IS ANYTHING TO PLAY.
 * iPhone Safari lets a page start sound only inside the tap itself, and the link arrives after an
 * awaited fetch — by which point the tap no longer counts, so `play()` there is refused and the
 * song sits silent behind a control that looks pressed. Calling `play()` on the element while
 * still inside the tap is what unlocks it; the source is set when the link arrives and `play()`
 * is called again. `src` is set by hand rather than by React, because React setting it a second
 * time, a render later, would restart the load and abort the play just begun.
 *
 * ⚠️ REMOVE IS TWO PRESSES, INLINE, NOT `window.confirm` — the decision Pictures and CirclesCard
 * made: the second press says what it will do, a phone has no modal to mis-tap, and the Browser
 * pane can drive it (it auto-dismisses `confirm`).
 */
export function ChatSongPlayer({ song, roomId }: { song: ChatSong; roomId: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  /** the link is in the `<audio>`: show its controls, not ▶ */
  const [ready, setReady] = useState(false)
  /** when the link arrived, so a failure can tell an expired link from a recording this cannot play */
  const gotAt = useRef(0)
  /** this browser cannot play this recording: said once, never offered again */
  const [cannot, setCannot] = useState(false)
  /** what is in flight: a link being fetched, or the song coming down */
  const [busy, setBusy] = useState<'play' | 'remove' | null>(null)
  const [sure, setSure] = useState(false)
  const [say, setSay] = useState('')

  if (song.removed) return <div className="cz-song is-removed">🎵 removed by its sender</div>

  const play = () => {
    if (busy) return
    const el = audio.current
    /* inside the tap, before anything is awaited — see the header. With no source yet this
       settles as nothing; the call is what counts */
    if (el) void el.play().catch(() => {})
    setBusy('play')
    setSay('')
    void playUrl(song.file_id).then((r) => {
      setBusy(null)
      /* ⚠️ NOT ON AN ELEMENT THAT HAS LEFT THE PAGE: a detached `<audio>` still plays, with no
         control anywhere to stop it */
      const here = el && el.isConnected ? el : null
      if ('url' in r) {
        gotAt.current = Date.now()
        setReady(true)
        if (here) {
          here.src = r.url
          void here.play().catch(() => {})
        }
        return
      }
      here?.pause()
      setSay(r.why)
      /* refused: perhaps its sender took it down since this room was read, and asking again is
         how the thread finds out — the song then says so rather than offering ▶ again */
      refreshSongs(roomId)
    })
  }

  const remove = async () => {
    if (busy) return
    if (!sure) return setSure(true)
    setSure(false)
    setBusy('remove')
    setSay('')
    const bad = await removeSong(song.file_id)
    setBusy(null)
    if (bad) setSay(bad.why)
  }

  return (
    <div className="cz-song">
      <div className="cz-song-head">
        <span className="cz-song-name">🎵 {song.name}</span>
        <span className="cz-song-len">{lengthLabel(song.seconds)}</span>
      </div>
      <audio
        ref={audio}
        className={'cz-song-audio' + (ready ? '' : ' is-waiting')}
        controls
        preload="none"
        onPlay={(e) => startedPlaying(e.currentTarget)}
        onPause={(e) => stoppedPlaying(e.currentTarget)}
        onEnded={(e) => stoppedPlaying(e.currentTarget)}
        onError={(e) => {
          const el = e.currentTarget
          /* the unlock in `play` runs on an element with no source, which is not a failure */
          if (!el.getAttribute('src')) return
          stoppedPlaying(el)
          setReady(false)
          if (afterPlayError(el.error?.code, Date.now() - gotAt.current) === 'cannot') {
            setCannot(true)
            setSay('')
            return
          }
          /* ⚠️ A FAILED LINK GOES BACK TO ▶. It is signed for an hour, so a thread left open past
             that has a dead one, and pressing ▶ asks for a fresh link. The element is emptied
             first, so the next tap's unlock starts from nothing rather than from the error. */
          el.removeAttribute('src')
          el.load()
          setSay('That didn’t play here. Press ▶ to try again.')
        }}
      />
      {cannot ? (
        <p className="cz-song-say">This browser can’t play this recording.</p>
      ) : (
        !ready && (
          <button
            className="btn cz-song-play"
            onClick={play}
            disabled={!!busy}
            aria-label={`Play ${song.name}`}
          >
            {busy === 'play' ? '▶ …' : '▶ Play'}
          </button>
        )
      )}
      {song.mine && (
        <div className="cz-song-mine">
          {sure && <span className="cz-song-sure">Remove it for everyone?</span>}
          <button
            className={'btn btn-ghost cz-song-remove' + (sure ? ' is-on' : '')}
            onClick={() => void remove()}
            disabled={!!busy}
          >
            {sure ? 'Remove' : 'Remove…'}
          </button>
          {sure && (
            <button className="btn btn-ghost cz-song-remove" onClick={() => setSure(false)}>
              Keep it
            </button>
          )}
        </div>
      )}
      {say && (
        <p className="cz-song-say" role="alert">
          {say}
        </p>
      )}
    </div>
  )
}
