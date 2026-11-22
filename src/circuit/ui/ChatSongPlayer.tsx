import { useState } from 'react'
import { lengthLabel, playUrl, removeSong, type ChatSong } from '../chatSongs'
import { refreshSongs } from '../roomThread'

/**
 * A song sent into a chat, drawn where its message is (chatSongs.ts).
 *
 * ⚠️ NOTHING IS FETCHED UNTIL ▶ IS PRESSED. A thread can hold a dozen songs and most will never be
 * played, and each link is signed for an hour — so the press asks for one, and only then is there
 * an `<audio>` to play it. The press is also what lets it start at once: a browser lets a page
 * play sound after the person has touched it.
 *
 * ⚠️ REMOVE IS TWO PRESSES, INLINE, NOT `window.confirm` — the decision Pictures and CirclesCard
 * made: the second press says what it will do, a phone has no modal to mis-tap, and the Browser
 * pane can drive it (it auto-dismisses `confirm`).
 */
export function ChatSongPlayer({ song, roomId }: { song: ChatSong; roomId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  /** what is in flight: a link being fetched, or the song coming down */
  const [busy, setBusy] = useState<'play' | 'remove' | null>(null)
  const [sure, setSure] = useState(false)
  const [say, setSay] = useState('')

  if (song.removed) return <div className="cz-song is-removed">🎵 removed by its sender</div>

  const play = async () => {
    if (busy) return
    setBusy('play')
    setSay('')
    const r = await playUrl(song.file_id)
    setBusy(null)
    if ('url' in r) return setUrl(r.url)
    setSay(r.why)
    /* refused: perhaps its sender took it down since this room was read, and asking again is how
       the thread finds out — the song then says so rather than offering ▶ again */
    refreshSongs(roomId)
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
      {url ? (
        /* ⚠️ A FAILED LINK GOES BACK TO ▶. It is signed for an hour, so a thread left open past
           that has a dead one — and a recording this browser cannot decode fails the same way.
           Either way pressing ▶ again asks for a fresh link, which is the one thing worth trying. */
        <audio
          className="cz-song-audio"
          controls
          autoPlay
          src={url}
          onError={() => {
            setUrl(null)
            setSay('That didn’t play here. Press ▶ to try again.')
          }}
        />
      ) : (
        <button
          className="btn cz-song-play"
          onClick={() => void play()}
          disabled={!!busy}
          aria-label={`Play ${song.name}`}
        >
          {busy === 'play' ? '▶ …' : '▶ Play'}
        </button>
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
