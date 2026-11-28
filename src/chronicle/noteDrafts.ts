/**
 * What Chronicle keeps on the device of a note not yet saved, and how it is read back.
 *
 * ⚠️ THE TWO BOXES THAT HELD WORDS NOWHERE BUT IN STATE: the Journal's "Write something down for
 * today…" and the note under the running sitting. A reload, a pull-down on a phone, or for the
 * Journal even switching to the Day tab, threw away whatever was typed — the loss a whole minion
 * met in Paint on 27 Nov 2026. See drafts/useKeptDraft. Pure, so a reload can be tested.
 */

/** the journal boxes' own maxLength, and so the most a kept draft is believed to hold */
export const NOTE_MAX = 4000

/** the Journal's new note: the words, and the day they are about when it is not today */
export type JournalDraft = { draft: string; about: string | null }

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function readJournalDraft(raw: unknown): JournalDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.draft !== 'string' || !o.draft.trim()) return null
  return {
    draft: o.draft.slice(0, NOTE_MAX),
    about: typeof o.about === 'string' && DAY.test(o.about) ? o.about : null,
  }
}

/** the running sitting's note: only the words — which sitting it is about is the draft's key */
export function readNoteText(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.slice(0, NOTE_MAX) : null
}
