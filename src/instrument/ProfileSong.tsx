import { useState, useSyncExternalStore } from 'react'
import { toSong } from '../audio/songFile'
import { putSongOnProfile } from '../profile/putOnProfile'
import { writerFor } from '../profile/pageWriterLive'
import { getSupabaseClient } from '../finance/client'
import { previewMember, PREVIEW_ME } from '../dev/previewMember'
import { loopState as benchNow } from '../audio/looper'
import { setSongName, songName, subscribeSongName } from './songName'

/**
 * 🎵 Put it on my profile, in 📁 Songs. Evan, 21 Nov 2026: "yes to a 'Put it on my profile'
 * button (notes only, nothing new on the server)".
 *
 * The song goes into the first song block on your page, in place of one of the same name, or at
 * the end of its list, or into a new song block (profile/newBlock.withSong).
 *
 * ⚠️ THE NAME IS ASKED EVERY TIME, offered as the one the song was kept under. The kept name
 * belongs to whichever song was last kept or opened, and the bench may have moved on to another
 * since; used silently, it would replace that other song on the page. And replacing a song
 * already on the page is asked about too, because a shared name is not always the same song.
 *
 * ⚠️ NOTES ONLY, AND THE LINE AFTERWARDS SAYS SO. A profile song block plays the parts on the
 * visitor's own synth, every part all the way through at one level (songPlayer.ts reads neither
 * a part's level nor its arrangement), and the words and recordings are sound made in this room.
 * A visitor hearing less than you do would otherwise be reported as a bug.
 *
 * Not offered to somebody signed out or without a profile: there is no page to put it on.
 *
 * ⚠️ WHOSE ACCOUNT IT IS IS TAKEN WHEN THE BUTTON IS PRESSED, before the name is asked: the
 * question can stay open while you sign in as somebody else in another tab, and an answer given
 * after that must write nothing (profile/putOnProfile.ts).
 */
export function ProfileSong({
  loop,
  username,
  askName,
  confirmIt,
}: {
  loop: ReturnType<typeof benchNow>
  username: string | null
  /** the room's own name prompt, which lets go of every sounding note first */
  askName: (question: string, offered?: string) => string
  /** the room's own yes-or-no, which does the same */
  confirmIt: (question: string) => boolean
}) {
  const kept = useSyncExternalStore(subscribeSongName, songName, songName)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null)
  /** the page's name as the writer last proved it, for "Open it" */
  const [pageName, setPageName] = useState<string | null>(null)
  if (!username) return null
  const notes = loop.layers.some((l) => l.events.some((e) => e.on))

  const put = async () => {
    const uid0 =
      import.meta.env.DEV && previewMember
        ? PREVIEW_ME.id
        : (await getSupabaseClient().auth.getSession()).data.session?.user.id
    if (!uid0) return setSaid({ ok: false, text: 'Sign in again to put it on your page.' })
    const name = askName('Name this song on your page', kept ?? '')
    if (!name) return
    /* what the bench was when this was asked, so a song opened while it saves is not renamed */
    const keptThen = songName()
    const benchThen = benchNow().layers
    setBusy(true)
    setSaid(null)
    try {
      const writer = writerFor(uid0)
      const r = await putSongOnProfile({
        writer,
        uid0,
        name: username,
        song: toSong(name, loop.bpm, loop.bars, loop.layers),
        confirm: (as) => confirmIt(`Replace “${as}” on your page with this?`),
      })
      setPageName(writer.known()?.name ?? username)
      if (r.ok) {
        if (r.name !== keptThen && songName() === keptThen && benchNow().layers === benchThen)
          setSongName(r.name)
        setSaid({
          ok: true,
          text: `${r.how === 'updated' ? 'Updated' : 'Added'} “${r.name}”. Visitors hear the notes alone: no words, recordings, levels or arrangement.`,
        })
      } else setSaid({ ok: false, text: r.say })
    } catch {
      setSaid({ ok: false, text: 'Your page did not save. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="inst-profile-song">
      <div className="inst-row">
        <button
          className="btn btn-ghost"
          disabled={!notes || busy}
          onClick={() => void put()}
          title="Put this song's notes in a song block on your profile"
        >
          {busy ? 'Putting it on your page…' : '🎵 Put it on my profile'}
        </button>
        {/* a disabled button says why, where a phone can see it */}
        {!notes && <span className="muted inst-note">Play or draw some notes first.</span>}
      </div>
      {/* ⚠️ always mounted, so a reader hears it change rather than a region arriving full */}
      <p className="muted inst-note inst-profile-said" role="status">
        {said && (
          <>
            {said.text}
            {said.ok && (
              <>
                {' '}
                <a href={`#profile?u=${encodeURIComponent(pageName ?? username)}`}>Open it</a>
              </>
            )}
          </>
        )}
      </p>
    </div>
  )
}
