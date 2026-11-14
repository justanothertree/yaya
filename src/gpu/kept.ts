import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * What a Lab toy keeps between visits — its level, its look, its record — read and written the one
 * way. Seventy-three toys had the same seventeen lines for it: a `load` that read the store through
 * the toy's own `readSaved` and fell back to nothing kept, and an effect that wrote it back on every
 * change, quietly doing nothing when the store refused (private mode). Each toy still owns its
 * reader, which is where what counts as a valid saved value is decided and tested.
 */

/** what is kept under `key`, through the toy's own reader; a store that refuses reads as nothing */
export function loadKept<T>(key: string, read: (text: string | null) => T): T {
  try {
    return read(localStorage.getItem(key))
  } catch {
    return read(null)
  }
}
/**
 * The event a Lab write announces in its own tab. The browser's `storage` event tells OTHER tabs
 * that something changed and never the tab that wrote it, so whatever shows a toy's result while
 * the toy is open (the Share your score box) would otherwise have to keep asking. Every Lab write
 * goes through writeKept, which says so here; kept.test.ts fails on a write that does not.
 */
export const RESULT_EVENT = 'lab:result'

/**
 * Write a toy's stored text and announce it in this tab. Throws as localStorage does (private
 * mode, a full store), so a caller's own catch still decides what a refusal means; the event goes
 * out only for a write that happened.
 */
export function writeKept(key: string, text: string) {
  localStorage.setItem(key, text)
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(RESULT_EVENT, { detail: { key } }))
}

/** keep it; a store that refuses — private mode — keeps it for this visit only */
export function storeKept(key: string, value: unknown) {
  try {
    writeKept(key, JSON.stringify(value))
  } catch {
    /* private mode: kept for this visit */
  }
}
/** state that is read from the store once and written back whenever it changes */
export function useKept<T>(
  key: string,
  read: (text: string | null) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [kept, setKept] = useState<T>(() => loadKept(key, read))
  useEffect(() => storeKept(key, kept), [key, kept])
  return [kept, setKept]
}

/**
 * A count read back from the store: a whole number from nought up to just under `max`, or nought.
 * What is stored can be anything a person (or an old version) left there, so a count is believed
 * only when it is one. Forty-four readers had their own copy of this line, differing only in max.
 */
export const whole = (v: unknown, max = 1e6) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max ? v : 0
