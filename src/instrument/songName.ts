import { loopState, subscribeLoop } from '../audio/looper'

/**
 * The working song's name, when it has one: the name it was kept under, or the name of the kept
 * song it was opened from. Evan, 17 Nov 2026: an export is named after the song, not only the day.
 *
 * ⚠️ BESIDE THE LOOPER, NOT IN IT. The looper's state is the music, and everything that walks it
 * (the workbench, undo, a jam, a song file) would have to learn a field that none of them plays.
 * A name is the library's word for a song, so it lives here, written down on its own key so a
 * reload keeps it as the workbench keeps the song.
 *
 * ⚠️ AND IT FORGETS WHEN THE SONG EMPTIES. Open “Sunday”, take every part out and start again, and
 * what you are making is not Sunday any more; an export called that would be a wrong name, which
 * is worse than none. So the name goes on the turn from something to nothing, and never on an
 * empty START: the room opens empty and the bench is put back a moment later, and forgetting
 * then would lose the name on every reload.
 */

const KEY = 'inst_song_name_v1'
/** a song's name is cut to this many characters wherever a song is read (songFile.ts MAX_NAME) */
const MAX = 60

function read(): string | null {
  try {
    const v = localStorage.getItem(KEY)
    return v && v.trim() ? v.trim().slice(0, MAX) : null
  } catch {
    return null
  }
}

let name: string | null = null
let loaded = false
const listeners = new Set<() => void>()

export function songName(): string | null {
  if (!loaded) {
    name = read()
    loaded = true
  }
  return name
}

export function setSongName(next: string | null) {
  const v = next?.trim().slice(0, MAX) || null
  loaded = true
  if (v === name) return
  name = v
  try {
    if (v) localStorage.setItem(KEY, v)
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode: the name lasts as long as the page */
  }
  listeners.forEach((fn) => fn())
}

export function subscribeSongName(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Forget the name when the song goes from something to nothing. Returns the unsubscribe. */
export function forgetWhenEmptied(): () => void {
  const isEmpty = () => {
    const st = loopState()
    return !st.layers.length && !st.takes.length
  }
  let was = isEmpty()
  return subscribeLoop(() => {
    const now = isEmpty()
    if (now && !was) setSongName(null)
    was = now
  })
}

/** the day, where the person is: toISOString is UTC, and an evening in Eastern time is tomorrow there */
export function day(when: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}`
}

/** how many characters of the song's name a file keeps, so the day is never what gets cut */
const FILE_NAME = 60

/**
 * What an export is called, without its extension: the song's name and the day, or `song-` and
 * the day when it has no name.
 *
 * ⚠️ THE NAME IS CLEANED FOR EVERY PHONE AND DESKTOP IT MAY LAND ON. `/ \ : * ? " < > |` and
 * control characters are refused by one file system or another, a name ending in a dot or a space
 * is quietly renamed by Windows, and one starting with a dot is hidden on a Mac. Cut by CHARACTER, not by UTF-16 unit, or an emoji at the
 * cut is left as half of itself.
 */
export function exportName(song: string | null, when: Date): string {
  const clean = (song ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const cut = Array.from(clean)
    .slice(0, FILE_NAME)
    .join('')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  return cut ? `${cut} ${day(when)}` : `song-${day(when)}`
}
