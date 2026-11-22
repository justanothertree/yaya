// The member directory and your standing with each person in it: who is a friend, who has asked,
// who you have asked. It was the People page's own state; it is a hook now because the page it
// belonged to became the left-hand side of Chat (see ui/ChatList.tsx), and the open conversation
// on the right needs the same answers — whose thread this is, and whether they are a friend.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { errText } from '../ui/errText'
import { notificationsChanged } from '../hooks/notifySignal'
import { getSupabaseClient } from '../finance/client'
import { previewMember, PREVIEW_PEOPLE, type PreviewPerson } from '../dev/previewMember'
import { usePresence, type Seen } from '../hooks/usePresence'

export type Rel = 'none' | 'in' | 'out' | 'friend'
// user_id is present for anyone from the DIRECTORY (list_member_directory), which is exactly
// presence's own audience -- optional because handle lookup (find_member_by_username) can
// surface someone OUTSIDE that audience, and presence must not extend there
export type Person = { user_id?: string; username: string; name: string; rel: Rel }

/** directory + friendships, folded into one row per person */
async function loadPeople(): Promise<Person[]> {
  const sb = getSupabaseClient()
  const [dir, friends] = await Promise.all([
    sb.rpc('list_member_directory'),
    sb.rpc('list_friends'),
  ])
  const rel = new Map<string, Rel>()
  for (const f of (friends.data ?? []) as {
    username: string
    status: string
    direction: string
  }[]) {
    rel.set(f.username, f.status === 'accepted' ? 'friend' : f.direction === 'in' ? 'in' : 'out')
  }
  return ((dir.data ?? []) as { user_id: string; username: string; name: string }[]).map((p) => ({
    user_id: p.user_id,
    username: p.username,
    name: p.name,
    rel: rel.get(p.username) ?? 'none',
  }))
}

export type PeopleState = {
  people: Person[]
  /** who is visible to you right now; a missing entry is offline AND invisible, on purpose */
  online: Record<string, Seen | undefined>
  /** the search box: filters what is listed, and is the handle looked up on Enter */
  q: string
  setQ: (q: string) => void
  /** the username a friendship call is in flight for */
  busy: string | null
  err: string | null
  /** null = no lookup made; [] = looked up and nobody has that handle */
  found: Person[] | null
  looking: boolean
  act: (username: string, kind: 'add' | 'remove' | 'accept' | 'decline') => Promise<void>
  lookUp: () => Promise<void>
  /** `people` narrowed by the search box and split by what you can do about each */
  groups: { requests: Person[]; friends: Person[]; others: Person[] }
}

/**
 * @param meId your own id once there is a real session, else null — presence subscribes on it,
 *   and the dev harness has no session to subscribe with
 */
export function usePeople(authed: boolean, meId: string | null): PeopleState {
  const [people, setPeople] = useState<Person[]>([])
  // Friends-or-circuit is exactly the directory's own audience (list_member_directory), so
  // presence for everyone listed is a single hook call, not a per-row subscription.
  const ids = useMemo(
    () => people.map((p) => p.user_id).filter((id): id is string => !!id),
    [people],
  )
  const online = usePresence(meId, ids)
  const [q, setQRaw] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // The directory only lists people you already share something with, so finding someone new
  // is an explicit act: look up their exact handle (they had to share it with you).
  const [found, setFound] = useState<Person[] | null>(null)
  const [looking, setLooking] = useState(false)

  const refresh = useCallback(async () => {
    if (previewMember) {
      setPeople(PREVIEW_PEOPLE.map((p: PreviewPerson) => ({ ...p })))
      return
    }
    if (!authed) return
    try {
      setPeople(await loadPeople())
    } catch (e) {
      setErr(errText(e, 'Could not load members'))
    }
  }, [authed])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setQ = useCallback((next: string) => {
    setQRaw(next)
    setFound(null)
  }, [])

  /** run a friendship RPC, then reflect the new standing */
  const act = useCallback(
    async (username: string, kind: 'add' | 'remove' | 'accept' | 'decline') => {
      setBusy(username)
      setErr(null)
      if (previewMember) {
        const next: Rel = kind === 'add' ? 'out' : kind === 'accept' ? 'friend' : 'none'
        /* ⚠️ the fixture too, not only this copy of it: the bell reads PREVIEW_PEOPLE to count
           requests, so answering one here and leaving it there keeps a badge on a request you
           have already answered — a bug in the harness that reads as a bug in the page */
        const fixture = PREVIEW_PEOPLE.find((p) => p.username === username)
        if (fixture) fixture.rel = next
        setPeople((prev) => prev.map((p) => (p.username === username ? { ...p, rel: next } : p)))
        setFound((prev) =>
          prev ? prev.map((p) => (p.username === username ? { ...p, rel: next } : p)) : prev,
        )
        notificationsChanged()
        setBusy(null)
        return
      }
      const sb = getSupabaseClient()
      const { error } =
        kind === 'accept' || kind === 'decline'
          ? await sb.rpc('respond_friend', { p_username: username, p_accept: kind === 'accept' })
          : await sb.rpc(kind === 'add' ? 'request_friend' : 'remove_friend', {
              p_username: username,
            })
      if (error) setErr(error.message)
      else {
        await refresh()
        // answering a request changes the bell's count, and this screen never navigates
        notificationsChanged()
      }
      setBusy(null)
    },
    [refresh],
  )

  const lookUp = useCallback(async () => {
    const handle = q.trim().replace(/^@/, '')
    if (handle.length < 2) return
    setLooking(true)
    setErr(null)
    if (previewMember) {
      const hit = PREVIEW_PEOPLE.filter((p) => p.username.toLowerCase() === handle.toLowerCase())
      setFound(hit.map((p) => ({ ...p })))
      setLooking(false)
      return
    }
    const { data, error } = await getSupabaseClient().rpc('find_member_by_username', {
      p_username: handle,
    })
    if (error) setErr(error.message)
    else {
      const rows = (data ?? []) as { username: string; name: string; is_friend: boolean }[]
      setFound(
        rows.map((r) => ({
          username: r.username,
          name: r.name,
          rel: r.is_friend ? 'friend' : 'none',
        })),
      )
    }
    setLooking(false)
  }, [q])

  const groups = useMemo(() => {
    const needle = q.trim().replace(/^@/, '').toLowerCase()
    const match = (p: Person) =>
      !needle || p.name.toLowerCase().includes(needle) || p.username.toLowerCase().includes(needle)
    const hit = people.filter(match)
    return {
      requests: hit.filter((p) => p.rel === 'in'),
      friends: hit.filter((p) => p.rel === 'friend'),
      others: hit.filter((p) => p.rel === 'none' || p.rel === 'out'),
    }
  }, [people, q])

  return { people, online, q, setQ, busy, err, found, looking, act, lookUp, groups }
}
