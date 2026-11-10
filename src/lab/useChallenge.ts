import { useEffect, useState } from 'react'
import { dropBeat, fromHash, type Beat } from './beat'

/**
 * The challenge in the address for one game, kept in step with it: a link clicked while the Lab is
 * already open changes only the hash, so this listens rather than reading once.
 */
export function useChallenge<G extends Beat['game']>(game: G) {
  type Mine = Extract<Beat, { game: G }>
  const read = () => {
    const b = fromHash()
    return b && b.game === game ? (b as Mine) : null
  }
  const [beat, setBeat] = useState<Mine | null>(read)
  useEffect(() => {
    const on = () => setBeat(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
    // `read` only closes over `game`, which never changes for a mounted demo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const leave = () => {
    dropBeat()
    setBeat(null)
  }
  return [beat, leave] as const
}
