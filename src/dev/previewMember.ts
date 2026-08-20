import type { ProfileData } from '../profile/profileData'

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
  /** placeholder only -- preview mode never has a real session, so presence never subscribes */
  user_id: string
  username: string
  name: string
  /** none = not connected, in/out = pending request, friend = accepted */
  rel: 'none' | 'in' | 'out' | 'friend'
}
export const PREVIEW_PEOPLE: PreviewPerson[] = [
  { user_id: 'preview-jordan', username: 'jordan_b', name: 'Jordan', rel: 'friend' },
  { user_id: 'preview-riley', username: 'Riley', name: 'Riley', rel: 'out' },
  { user_id: 'preview-alex', username: 'Alex', name: 'Alex', rel: 'in' },
  { user_id: 'preview-sam', username: 'Sam', name: 'Sam', rel: 'none' },
  { user_id: 'preview-casey', username: 'casey_m', name: 'Casey', rel: 'none' },
]

/** stand-in activity notices (kudos / comments / joins) for the bell */
export const PREVIEW_ACTIVITY: {
  kind: 'kudos' | 'comment' | 'join'
  actor: string
  subject: string
  detail: string | null
}[] = [
  { kind: 'kudos', actor: 'Alex', subject: '2026-07-28', detail: '🔥' },
  { kind: 'comment', actor: 'Riley', subject: '2026-07-28', detail: 'that leg day was unreal' },
  { kind: 'join', actor: 'Casey', subject: 'The Crew', detail: null },
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

/**
 * Whether the preview member has opted into The Lounge. Flip to false to exercise
 * the "Join The Lounge" invite card — the real list_chat_overview omits the room
 * until you opt in, so previewOverview() has to omit it too or the preview shows a
 * room and an invitation to join it at the same time.
 */
export const PREVIEW_LOUNGE_IN = true

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
  return PREVIEW_ROOMS.filter((r) => r.kind !== 'lounge' || PREVIEW_LOUNGE_IN)
    .map((r) => {
      const ms = PREVIEW_MSGS[r.id] ?? []
      const last = ms[ms.length - 1]
      return {
        ...r,
        last_body: last?.body ?? null,
        last_author: last?.author_name ?? null,
        last_at: last?.created_at ?? null,
        unread: PREVIEW_UNREAD[r.id] ?? 0,
      }
    })
    .sort((a, b) => (b.last_at ?? '').localeCompare(a.last_at ?? ''))
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

/**
 * Stand-in profiles, so the profile page (looks, blocks, guestbook) can be inspected without a
 * session. Every person here is invented — see the note at the top of this file.
 *
 * The looks are deliberately loud and different from each other: the whole question a preview
 * has to answer is "does someone else's theme actually land on their page, and can I get out
 * of it", and two tasteful near-identical palettes prove nothing.
 */
export const PREVIEW_PROFILES: Record<string, ProfileData> = {
  Alex: {
    username: 'Alex',
    first_name: 'Alex',
    member_since: 'Mar 2025',
    is_me: false,
    friend_status: 'pending_in',
    shared_circuits: [{ name: 'The Crew', people: ['Alex', 'Riley', PREVIEW_ME.name] }],
    movies_rated: 12,
    snake_best: { score: 180, game_mode: 'race', achieved: '2026-07-02' },
    viewer_snake_best: { score: 225 },
    activity_visibility: 'friends',
    look: { theme: 'light', palette: null, flair: 'hearts' },
  },
  Riley: {
    username: 'Riley',
    first_name: 'Riley',
    member_since: 'Jan 2025',
    is_me: false,
    friend_status: 'pending_out',
    shared_circuits: [{ name: 'The Crew', people: ['Alex', 'Riley', PREVIEW_ME.name] }],
    movies_rated: 3,
    snake_best: null,
    activity_visibility: 'members',
    // a custom palette rather than a built-in theme, so both code paths get exercised
    look: {
      theme: null,
      palette: { bg: '#1a0f2e', text: '#f4e9ff', accent: '#ff7ab8' },
      flair: 'orbit',
    },
  },
  jordan_b: {
    username: 'jordan_b',
    first_name: 'Jordan',
    member_since: 'Feb 2025',
    is_me: false,
    friend_status: 'friends',
    shared_circuits: [],
    movies_rated: 0,
    snake_best: null,
    activity_visibility: 'friends',
    // no look set: their page should render exactly like the rest of the site
    look: null,
  },
  preview: {
    username: 'preview',
    first_name: PREVIEW_ME.name,
    member_since: 'Jan 2025',
    is_me: true,
    friend_status: null,
    shared_circuits: [{ name: 'The Crew', people: ['Alex', 'Riley', PREVIEW_ME.name] }],
    movies_rated: 7,
    snake_best: { score: 225, game_mode: 'solid', achieved: '2026-08-01' },
    activity_visibility: 'friends',
    // your own page: always your look, whatever the viewer toggle says
    look: { theme: 'alt', palette: null, flair: 'sparks' },
  },
}

/**
 * A call in progress, for the preview.
 *
 * Voice presence is live realtime state with no session behind it in preview mode, so
 * without this the "someone is calling you" notice has nothing to render from and cannot be
 * looked at without two real people and two browsers.
 */
export const PREVIEW_VOICE_IN: Record<string, string[]> = {
  'pv-dm': ['Alex'],
  'pv-crew': ['Riley', 'Casey'],
}
