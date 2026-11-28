import { useState, type ReactNode } from 'react'
import { circuitStore, useCircuit } from '../store'
import { CouldNotLoad } from '../../ui/CouldNotLoad'

/**
 * The Circuit's board, or "Couldn't load the board. Retry" when the last load did not get every
 * read (see boardLoad.ts).
 *
 * ⚠️ OVER THE BOARD, NOT INSTEAD OF IT, when there is one: a failed load keeps the board from before
 * it, which is real and worth seeing, and saying it did not load is what stops it being mistaken for
 * the fresh one. With NOTHING from before — a first visit whose first load failed — the children
 * are not drawn at all, because every one of them would say "No participants yet" or "Nothing rated
 * yet" about a board nobody got: an empty state made of an error.
 *
 * With no children it is just the notice, for a surface that only needs to say why it will not save.
 */
export function BoardLoad({
  what = 'the board',
  children,
}: {
  what?: string
  children?: ReactNode
}) {
  const state = useCircuit()
  const [retrying, setRetrying] = useState(false)
  if (!state.loadFailed?.length) return <>{children}</>
  const notice = (
    <CouldNotLoad
      what={what}
      retrying={retrying}
      onRetry={() => {
        setRetrying(true)
        void circuitStore.refresh().finally(() => setRetrying(false))
      }}
    />
  )
  const nothingFromBefore =
    !state.people.length && !state.logs.length && !state.movies.length && !state.watchlist.length
  if (nothingFromBefore) return notice
  return (
    <>
      {notice}
      {children}
    </>
  )
}
