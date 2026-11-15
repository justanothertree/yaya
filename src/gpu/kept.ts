import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { loadKept, storeKept } from './stored'

/**
 * What a Lab toy keeps between visits — its level, its look, its record — read and written the one
 * way. Seventy-three toys had the same seventeen lines for it: a `load` that read the store through
 * the toy's own `readSaved` and fell back to nothing kept, and an effect that wrote it back on every
 * change, quietly doing nothing when the store refused (private mode). Each toy still owns its
 * reader, which is where what counts as a valid saved value is decided and tested.
 *
 * The React half. Everything else lives in stored.ts, which a rules module imports instead, so it
 * never reaches React; it is re-exported here for components, which already have React.
 */
export { RESULT_EVENT, loadKept, storeKept, whole, writeKept } from './stored'

/** state that is read from the store once and written back whenever it changes */
export function useKept<T>(
  key: string,
  read: (text: string | null) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const [kept, setKept] = useState<T>(() => loadKept(key, read))
  useEffect(() => storeKept(key, kept), [key, kept])
  return [kept, setKept]
}
