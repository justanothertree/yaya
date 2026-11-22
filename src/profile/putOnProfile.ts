import type { Song } from '../audio/songFile'
import { withSong, type WithSong } from './newBlock'
import type { PageWriter, PutOutcome } from './pageWriter'

/**
 * 🎵 Put it on my profile, from the Instrument room. Evan, 21 Nov 2026: "yes to a 'Put it on my
 * profile' button (notes only, nothing new on the server)".
 *
 * ⚠️ THROUGH THE PAGE WRITER, BY ONE OF TWO ROADS (22 Nov 2026), because the first version read the
 * page and saved it on its own and was found to lose songs and pages twelve ways
 * (docs/2026-11-22-profile-page-writer.md):
 *
 * - **Your page is open in an editor in this tab** (a canvas window): the song goes into THAT
 *   editor's copy, as it stands — edits not yet saved included — as one step its Undo takes back,
 *   and is sent straight away. Two copies of the page are never in play, so neither can delete
 *   the other's change.
 * - **It is not**: one queued job reads the page, adds the song to what is there now, and saves —
 *   nothing from this tab writes the page in between, and an editor somewhere else that started
 *   before it finds its copy old and says so, rather than saving the song away.
 *
 * Either way a song already on the page is replaced only after you said yes to replacing THAT
 * song: if the page changed while you answered, you are asked again.
 *
 * ⚠️ WHAT IT CANNOT PREVENT: another device saving the page in the moment between the check and
 * the save (only a check inside the server function closes that), and a tab still running a
 * bundle from before this, which saves without any check until it is reloaded.
 */

export type PutResult =
  | { ok: true; how: Extract<WithSong, { ok: true }>['how']; name: string }
  | { ok: false; say: string }

const SAY: Record<Extract<WithSong, { ok: false }>['why'], string> = {
  empty: 'This song has no notes yet.',
  full: 'Your song block has 24 songs. Take one off it to add this.',
  'too many blocks': 'Your page has 20 blocks. Take one off it to add a song block.',
  'too big': 'This song is too long for a profile block.',
  'page too big': 'Your page is full. Take something off it to add this.',
}

/** what a refused or unanswered put says, in the words of the line under the button */
function sayOutcome(o: PutOutcome): string {
  switch (o.kind) {
    case 'cannot':
      return SAY[o.why]
    case 'unacknowledged':
      return 'No answer from the server, so it may not have saved. Open your page to check.'
    case 'not-yours':
      return 'Your page isn’t under that name any more. Reload the site and try again.'
    case 'not-you':
      return 'You’re signed in as someone else now. Nothing was saved.'
    case 'signed-out':
      return 'Sign in again to put it on your page.'
    case 'unverified':
      return 'Couldn’t reach your page. Try again.'
    case 'collided':
      return 'Your page was saved from two places at once. Open it to check what it holds.'
    case 'error':
      return `Your page did not save: ${o.message}`
    default:
      return 'Your page changed while this was saving. Try again.'
  }
}

/**
 * @param uid0 whose account it was when the button was pressed, before any question was asked:
 *   an answer given after a switch to another account writes nothing.
 * @param confirm asked before a song already on the page is replaced by one of the same name; a no
 *   keeps the page as it is. Usually it is the same song worked on since; sometimes a different
 *   song that happens to share the name.
 */
export async function putSongOnProfile(o: {
  writer: PageWriter
  uid0: string
  name: string
  song: Song
  confirm: (name: string) => boolean
}): Promise<PutResult> {
  const done = (out: PutOutcome): PutResult =>
    out.kind === 'saved' && 'how' in out && out.how && out.song
      ? { ok: true, how: out.how, name: out.song }
      : { ok: false, say: sayOutcome(out) }
  const asWas: PutResult = { ok: false, say: 'Your page is as it was.' }

  /* the open editor's copy, when there is one that can take it */
  const live = o.writer.liveLineage()
  if (live) {
    const pre = withSong(live.apply.peek(), o.song)
    if (!pre.ok) return { ok: false, say: SAY[pre.why] }
    let approved: string | null = null
    if (pre.how === 'updated') {
      if (!o.confirm(pre.name)) return asWas
      approved = pre.name
    }
    let out = await live.apply.commit(o.song, approved)
    if (out.kind === 'ask') {
      if (!o.confirm(out.name)) return asWas
      out = await live.apply.commit(o.song, out.name)
      if (out.kind === 'ask')
        return { ok: false, say: 'Your page changed while you answered. Try again.' }
    }
    /* the editor's copy was refused as old: the song still lands, read onto the page as it is */
    if (out.kind !== 'stale' && out.kind !== 'changed') return done(out)
  }

  let out = await o.writer.put({ song: o.song, name: o.name, approved: null, uid0: o.uid0 })
  if (out.kind === 'ask') {
    if (!o.confirm(out.name)) return asWas
    out = await o.writer.put({ song: o.song, name: o.name, approved: out.name, uid0: o.uid0 })
    if (out.kind === 'ask')
      return { ok: false, say: 'Your page changed while you answered. Try again.' }
  }
  return done(out)
}
