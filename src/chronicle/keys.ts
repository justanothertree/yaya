import { isTypingTarget, type KeyTarget } from '../nav/typing'

/**
 * Chronicle's keyboard shortcuts: which key does what, and when a key is not the room's at all.
 *
 * ⚠️ S, NOT SPACE, FOR START AND STOP — the one place this departs from the proposal that asked for
 * it. Space pages down, and the Day's log is the longest thing in the room: somebody reading back
 * through it with Space would stop the timer they were reading about, which ends a real sitting
 * and splits it in two when they start again. S does nothing else on the page.
 *
 * ⚠️ A KEY IS NEVER TAKEN FROM SOMEBODY TYPING. Fields, dropdowns and anything contenteditable keep
 * every key (`isTypingTarget`, the site's one answer to that question), and so does any key held
 * with Ctrl, ⌘ or Alt — Ctrl+S is the browser's, and N with ⌘ is a new window. A key held down
 * repeating is not a second press, and a key something else already answered is not ours.
 *
 * ⚠️ AND NOTHING WHILE THE ROOM IS NOT THE THING IN FRONT OF YOU: a dialog is open (the sheets, a
 * sitting's editor, the ? overlay itself), or a game pinned over the page has the keyboard. The
 * room says which with `blocked`.
 *
 * Pure, so the rules can be asked without a browser; Timer.tsx does what the answer says.
 */

/** what a shortcut asks the room to do */
export type KeyAct = { do: 'stop' } | { do: 'start' } | { do: 'chip'; n: number } | { do: 'note' }

/** the parts of a keydown this reads */
export type KeyPress = {
  key: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  repeat?: boolean
  defaultPrevented?: boolean
  target?: KeyTarget
}

/** the parts of the room it depends on */
export type KeyRoom = {
  running: boolean
  /** how many start chips there are to press — the three under ▶ Start something, or fewer */
  chips: number
  /** a dialog is open or a game has the keyboard: nothing here is the room's to answer */
  blocked: boolean
}

/** the list the ? overlay prints in Chronicle — the same keys `chronicleKey` answers */
export const CHRONICLE_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['S', 'start something, or stop what is running'],
  ['1 2 3', 'start one of the three under Start something'],
  ['N', 'write a note: about what is running, or about today'],
]

export function chronicleKey(e: KeyPress, room: KeyRoom): KeyAct | null {
  if (room.blocked || e.defaultPrevented || e.repeat) return null
  if (e.altKey || e.ctrlKey || e.metaKey) return null
  if (isTypingTarget(e.target)) return null
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  if (k === 's') return room.running ? { do: 'stop' } : { do: 'start' }
  if (k === 'n') return { do: 'note' }
  /* the chips are drawn only when nothing is running, so they are only pressed then */
  if (!room.running && /^[1-3]$/.test(k) && Number(k) <= room.chips)
    return { do: 'chip', n: Number(k) }
  return null
}
