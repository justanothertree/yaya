import type { PageWriter } from './pageWriter'

/**
 * The page writers this tab holds, one per member (pageWriterLive.ts makes them).
 *
 * ⚠️ ITS OWN MODULE SO THE APP SHELL CAN FORGET THEM WITHOUT LOADING THEM. App calls `dropWriters`
 * on sign-out; importing it from pageWriterLive put the whole writer — and the song format it
 * reads — into the entry chunk every page loads, for a feature two lazily loaded rooms use. This
 * file imports nothing at runtime.
 */
export const writers = new Map<string, PageWriter>()

/** signed out: no writer outlives the session it was made for */
export function dropWriters() {
  writers.clear()
}
