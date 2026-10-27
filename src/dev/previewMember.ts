import type { ProfileData } from '../profile/profileData'

// ── DEV-ONLY member preview harness ──────────────────────────────────────────
// Renders the signed-in, members-only UI (chat, DMs, gated nav) using FAKE local data
// so those screens can be inspected in the preview without ever signing in.
//
// What it is NOT: no login, no credentials, no real Supabase session, no real database
// access, no elevated permissions. It only (a) flips client-side UI gates and (b) feeds
// components hardcoded mock data. Real RLS/security is completely untouched, and the whole
// module is `import.meta.env.DEV`-gated, so every BRANCH that uses it folds away in a
// production build. The module itself does not entirely go — see previewMsgs below, which
// measures what survives and why. Nothing here is sensitive (every name is invented), but
// "it tree-shakes out" is not a claim this file gets to make.
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
  kind: 'kudos' | 'comment' | 'join' | 'pool'
  actor: string
  subject: string
  detail: string | null
}[] = [
  { kind: 'kudos', actor: 'Alex', subject: '2026-07-28', detail: '🔥' },
  { kind: 'comment', actor: 'Riley', subject: '2026-07-28', detail: 'that leg day was unreal' },
  { kind: 'join', actor: 'Casey', subject: 'The Crew', detail: null },
  // subject is the pool's id (what the href needs), detail its name (what the bell shows)
  { kind: 'pool', actor: 'Jordan', subject: 'pv-crew', detail: 'Friday film' },
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
      const ms = previewMsgs()[r.id] ?? []
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

/**
 * Stand-in chat, built on FIRST USE rather than at module load.
 *
 * ⚠️ IT IS A FUNCTION BECAUSE A MODULE-SCOPE CALL KEPT THIS WHOLE FILE IN THE PRODUCTION BUNDLE.
 * The header above says this module tree-shakes out, and that was MEASURED FALSE: `index-*.js`
 * carried `{id:"preview-me",name:"Preview You",username:"preview",email:"preview@localhost"}`
 * followed by a run of discarded `t(180), t(174), …` calls. `previewMember` itself folded to
 * `false` correctly — the guard was never the problem. `t()` reads `Date.now()` and builds a
 * `Date`, which rollup cannot prove pure, so the calls below counted as side effects at module
 * scope; a module with side effects is retained whole, and PREVIEW_ME came along with it even
 * though every reference to it sits inside a branch that folded away.
 *
 * Behind a function there is nothing to evaluate until something calls it, and in production
 * nothing does: the `t(…)` run is gone from the bundle, which is the part with a runtime cost —
 * about a dozen `Date` constructions on every page load, for a harness nobody is using.
 *
 * ⚠️ AND THE OBJECT IS STILL THERE, 90 BYTES OF IT, FOR A REASON THAT IS NOT THE GUARD. This was
 * first blamed on the side effect above, the fix was applied, and `preview-me` was still in
 * `index-*.js` — so the next question was whether the binding is referenced or merely orphaned.
 * It is referenced, once, in the chunk's own EXPORT LIST (`Vv as ad`). previewMember.ts lands in
 * the shared entry chunk while Chat and Account are split out, so the binding is re-exported
 * across a chunk boundary; each importer's `previewMember ? … : …` folds correctly at its own
 * site, and the export in the shared chunk survives regardless. Code splitting, not tree shaking.
 *
 * Which is why this stops here: exporting `previewMe()` instead would ship a function body in
 * place of an object literal for the same 90 bytes of invented placeholder, and the only real
 * cure is loading the whole module dynamically in DEV — a restructure out of all proportion to
 * what is left. The measurement is written down instead, so the next person starts from it.
 *
 * ⚠️ AND IT IS A MEMOISED SINGLETON, NOT A FRESH OBJECT, because Chat.tsx MUTATES it — sending a
 * message in the harness appends to the room's array and expects it to still be there next
 * render. Returning a new object each call would make a sent message vanish, which looks exactly
 * like a broken chat.
 */
let msgs: Record<string, PreviewMsg[]> | null = null
export const previewMsgs = (): Record<string, PreviewMsg[]> =>
  (msgs ??= {
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
  })

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
