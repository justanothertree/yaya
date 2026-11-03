import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'

/**
 * Who you may put on a Certain list, and the circles that fill one in.
 *
 * ⚠️ ITS OWN MODULE SO `CertainChooser.tsx` ONLY EXPORTS COMPONENTS — the same reason
 * `visibilityLabels.ts` sits beside `VisibilityPicker.tsx` rather than inside it. Mixing a hook
 * in with components breaks fast refresh, and eslint says so as an error rather than a warning.
 *
 * ⚠️ ONE CACHE, ONE DEFINITION OF "FRIEND". Two things ask this question — the chooser, and the
 * profile's "view as" row, which has to offer a friend to look through the eyes of — and two
 * fetches of the same answer are two things that can disagree. The accepted filter in particular
 * belongs here: `list_friends` returns pending requests in both directions, and the server drops
 * a name that is not an accepted friend, so offering one would be a control that appears to work
 * and silently does nothing.
 */
export type Friend = { username: string; name: string; status: string }
export type Circle = { id: string; name: string; members: { username: string; name: string }[] }
export type Roster = { friends: Friend[]; circles: Circle[] }

/**
 * Stand-ins, so every surface that uses this can be inspected in the workbench.
 *
 * ⚠️ A FUNCTION, NOT A CONST, AND NOT EXPORTED — the bundle reason written up at length in
 * previewMember.ts and repeated in CirclesCard.tsx. A statement-level call at module scope is a
 * side effect rollup cannot prove pure, so it keeps the whole file; and an `export const`
 * reachable from a lazily-loaded chunk ships whatever it holds however many
 * `import.meta.env.DEV` guards surround its readers.
 *
 * ⚠️ AND IT IS A SECOND COPY OF `CirclesCard`'s FIXTURE, deliberately. Sharing one would mean
 * exporting it from somewhere both files can import, which is exactly the shape that shipped
 * 2.78 kB of invented fixture to real users once already. Duplication inside the fold is the
 * cheaper mistake. Every name is invented: this file is committed to a public repo.
 */
function previewRoster(): Roster {
  return {
    friends: [
      { username: 'quill', name: 'Quill', status: 'accepted' },
      { username: 'marlow', name: 'Marlow', status: 'accepted' },
      { username: 'bramble', name: 'Bramble', status: 'accepted' },
    ],
    circles: [
      {
        id: 'pv-circle-near',
        name: 'Nearest',
        members: [{ username: 'quill', name: 'Quill' }],
      },
    ],
  }
}

/**
 * ⚠️ CACHED AT MODULE LEVEL BECAUSE THE BLOCK EDITOR MOUNTS ONE CHOOSER PER BLOCK. Twenty blocks
 * on a page would be twenty `list_friends` round trips for one answer that is the same every
 * time. A plain `let` with no call at module scope, so this file holds no side effect for rollup
 * to keep — the same shape `useMyCeiling` uses, for the same reason.
 */
let cached: Roster | undefined
let inFlight: Promise<Roster> | undefined

async function fetchRoster(): Promise<Roster> {
  try {
    const sb = getSupabaseClient()
    const [f, c] = await Promise.all([sb.rpc('list_friends'), sb.rpc('my_visibility_circles')])
    return {
      /* accepted only — see the header */
      friends: ((f.data as Friend[]) ?? []).filter((x) => x.status === 'accepted'),
      circles: (c.data as Circle[]) ?? [],
    }
  } catch {
    return { friends: [], circles: [] }
  }
}

/** `undefined` while the answer is still coming; never a guess at who your friends are. */
export function useFriendRoster(): Roster | undefined {
  const [roster, setRoster] = useState<Roster | undefined>(() =>
    previewMember ? previewRoster() : cached,
  )

  useEffect(() => {
    if (previewMember || cached) return
    let alive = true
    inFlight ??= fetchRoster()
    void inFlight.then((r) => {
      cached = r
      if (alive) setRoster(r)
    })
    return () => {
      alive = false
    }
  }, [])

  return roster
}
