// ── DEV-ONLY member preview harness ──────────────────────────────────────────
// Renders the signed-in, members-only UI (chat, DMs, gated nav) using FAKE local data
// so those screens can be inspected in the preview without ever signing in.
//
// What it is NOT: no login, no credentials, no real Supabase session, no real database
// access, no elevated permissions. It only (a) flips client-side UI gates and (b) feeds
// components hardcoded mock data. Real RLS/security is completely untouched, and the whole
// module is `import.meta.env.DEV`-gated so it tree-shakes out of production builds.
//
// NOTE: every name here is invented. This file is committed to a public repo, so it must
// never carry a real member's name or username.
//
// Enable in the dev browser:  localStorage.setItem('dev_preview_member','1'); location.reload()
// Disable:                    localStorage.removeItem('dev_preview_member'); location.reload()

export const previewMember: boolean =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  window.localStorage?.getItem('dev_preview_member') === '1'

// a fake identity for the preview member (never a real account)
export const PREVIEW_ME = {
  id: 'preview-me',
  name: 'Preview You',
  username: 'preview',
  email: 'preview@localhost',
}

/**
 * Stand-in circuits, so anything scoped to a group (the circuit filter, group-scoped boards)
 * can be exercised in the preview. The real store loads from its adapter, which overwrites
 * anything seeded into localStorage, so the harness has to supply these itself.
 */
export const PREVIEW_GROUPS = [
  { id: 'pv-crew', name: 'The Crew' },
  { id: 'pv-family', name: 'Family' },
]

/** stand-in member directory + friendships, so the People screen can be exercised */
export type PreviewPerson = {
  username: string
  name: string
  /** none = not connected, in/out = pending request, friend = accepted */
  rel: 'none' | 'in' | 'out' | 'friend'
}
export const PREVIEW_PEOPLE: PreviewPerson[] = [
  { username: 'jordan_b', name: 'Jordan', rel: 'friend' },
  { username: 'Riley', name: 'Riley', rel: 'out' },
  { username: 'Alex', name: 'Alex', rel: 'in' },
  { username: 'Sam', name: 'Sam', rel: 'none' },
  { username: 'casey_m', name: 'Casey', rel: 'none' },
]

export type PreviewRoom = { id: string; kind: string; name: string }
export type PreviewMsg = {
  id: string
  room_id: string
  user_id: string
  author_name: string
  body: string
  created_at: string
}

export const PREVIEW_ROOMS: PreviewRoom[] = [
  { id: 'pv-crew', kind: 'circuit', name: 'The Crew' },
  { id: 'pv-lounge', kind: 'lounge', name: 'The Lounge' },
  { id: 'pv-dm', kind: 'dm', name: 'Alex' },
]

const t = (minsAgo: number) => new Date(Date.now() - minsAgo * 60000).toISOString()

/** unread counts the conversation list shows in preview (cleared when a room is opened) */
export const PREVIEW_UNREAD: Record<string, number> = {
  'pv-crew': 0,
  'pv-lounge': 0,
  'pv-dm': 2,
}

/** the conversation-list shape, derived from the mock rooms + messages */
export function previewOverview(): {
  id: string
  kind: string
  name: string
  last_body: string | null
  last_author: string | null
  last_at: string | null
  unread: number
}[] {
  return PREVIEW_ROOMS.map((r) => {
    const ms = PREVIEW_MSGS[r.id] ?? []
    const last = ms[ms.length - 1]
    return {
      ...r,
      last_body: last?.body ?? null,
      last_author: last?.author_name ?? null,
      last_at: last?.created_at ?? null,
      unread: PREVIEW_UNREAD[r.id] ?? 0,
    }
  }).sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''))
}

export const PREVIEW_MSGS: Record<string, PreviewMsg[]> = {
  'pv-crew': [
    {
      id: 'c1',
      room_id: 'pv-crew',
      user_id: 'pv-alex',
      author_name: 'Alex',
      body: 'anyone lifting today?',
      created_at: t(180),
    },
    {
      id: 'c2',
      room_id: 'pv-crew',
      user_id: 'pv-riley',
      author_name: 'Riley',
      body: 'leg day 💀',
      created_at: t(174),
    },
    {
      id: 'c3',
      room_id: 'pv-crew',
      user_id: PREVIEW_ME.id,
      author_name: 'Preview You',
      body: 'just logged mine, 128 pts',
      created_at: t(60),
    },
    {
      id: 'c4',
      room_id: 'pv-crew',
      user_id: 'pv-alex',
      author_name: 'Alex',
      body: 'beast. catching up tonight',
      created_at: t(12),
    },
  ],
  'pv-lounge': [
    {
      id: 'l1',
      room_id: 'pv-lounge',
      user_id: 'pv-sam',
      author_name: 'Sam',
      body: 'new here, hi all 👋',
      created_at: t(300),
    },
    {
      id: 'l2',
      room_id: 'pv-lounge',
      user_id: PREVIEW_ME.id,
      author_name: 'Preview You',
      body: 'welcome!',
      created_at: t(280),
    },
  ],
  'pv-dm': [
    {
      id: 'd1',
      room_id: 'pv-dm',
      user_id: 'pv-alex',
      author_name: 'Alex',
      body: 'you around for the movie thing?',
      created_at: t(45),
    },
    {
      id: 'd2',
      room_id: 'pv-dm',
      user_id: PREVIEW_ME.id,
      author_name: 'Preview You',
      body: 'yeah, rating it after',
      created_at: t(40),
    },
    {
      id: 'd3',
      room_id: 'pv-dm',
      user_id: 'pv-alex',
      author_name: 'Alex',
      body: '🔥',
      created_at: t(38),
    },
  ],
}
