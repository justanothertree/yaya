import { useKeptDraft } from '../drafts/useKeptDraft'
import { readNoteText } from './noteDrafts'

/**
 * Keeps the note being typed about the running sitting on this device, under THAT sitting.
 *
 * ⚠️ KEYED BY THE SITTING, AND RENDERS NOTHING. The note's words live in Timer, because Stop and
 * every switch save them first (`keepRunNote`); this only keeps a copy. Mounting one per sitting —
 * `key={running.id}` — makes the sitting part of the draft's key, so words typed about one sitting
 * can only ever come back while that sitting is the one running, never under the next one.
 *
 * ⚠️ `text` IS EMPTY WHEN THE BOX IS STILL ABOUT THE PREVIOUS SITTING — Timer passes '' until its
 * own save has moved the words on — so a switch never files the old note under the new sitting.
 */
export function KeepRunNote({
  sitting,
  text,
  putBack,
}: {
  sitting: string
  text: string
  putBack: (words: string) => void
}) {
  useKeptDraft<string>({
    kind: 'sitting-note',
    scope: sitting,
    value: text,
    isEmpty: (t) => !t.trim(),
    parse: readNoteText,
    restore: putBack,
  })
  return null
}
