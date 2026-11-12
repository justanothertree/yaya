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
/** keep it; a store that refuses — private mode — keeps it for this visit only */
export function storeKept(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
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
