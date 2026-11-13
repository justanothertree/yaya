import { devCall, type PartyEnvelope, type RoomKind } from '../voice/voiceSession'
import { devFriends } from '../lab/social/friends'

/**
 * ⚠️ DEV ONLY: a call between tabs of this browser, for checking anything that rides a call —
 * the party's pages and pointers, the Lab's presence, cursors and rooms — without two accounts,
 * two microphones or production Realtime.
 *
 * Open each tab at `#dev-call?name=Ann` (then `name=Bo`, …). Options:
 *   kind=dm|circuit|profile|lounge   the room kind the call claims (default dm)
 *   stranger=1                       this tab is NOT a friend of the others
 * The tab remembers its identity in sessionStorage and goes on to the Lab; a reload keeps it.
 * Close the tab, or open `#dev-call?off=1`, to leave.
 *
 * What travels is exactly what the real call carries for the party: `party` envelopes, stamped
 * by the sender. What does not exist here: audio, signalling, Supabase, and any check that the
 * other tabs are who they say — the same trust the real party gives a peer's `from`.
 *
 * Only ever loaded by a dynamic import behind `import.meta.env.DEV` in main.tsx.
 */
type Cfg = { id: string; name: string; kind: RoomKind; stranger: boolean }
type Msg =
  | { t: 'here'; id: string; name: string; stranger: boolean }
  | { t: 'bye'; id: string }
  | { t: 'party'; payload: PartyEnvelope }

const KEY = 'dev_call'
const KINDS: RoomKind[] = ['dm', 'circuit', 'profile', 'lounge']

function readCfg(asked: string): Cfg | null {
  const m = /^#dev-call(?:\?(.*))?$/.exec(asked)
  if (m) {
    const q = new URLSearchParams(m[1] ?? '')
    if (q.get('off')) {
      sessionStorage.removeItem(KEY)
      location.hash = '#lab'
      return null
    }
    const kind = (q.get('kind') ?? 'dm') as RoomKind
    const cfg: Cfg = {
      id: `dev-${Math.random().toString(36).slice(2, 8)}`,
      name: (q.get('name') ?? 'Tab').slice(0, 20),
      kind: KINDS.includes(kind) ? kind : 'dm',
      stranger: q.get('stranger') === '1',
    }
    sessionStorage.setItem(KEY, JSON.stringify(cfg))
    location.hash = '#lab'
    return cfg
  }
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Cfg | null
  } catch {
    return null
  }
}

export function startIfAsked(asked: string) {
  if (!import.meta.env.DEV) return
  const cfg = readCfg(asked)
  if (!cfg) return
  const bc = new BroadcastChannel('dev-call')
  const roster = new Map<string, { name: string; stranger: boolean; at: number }>()
  const partyFns = new Set<(p: unknown) => void>()
  const rosterFns = new Set<(people: { id: string; name: string }[]) => void>()
  const people = () => [...roster].map(([id, p]) => ({ id, name: p.name }))
  const tellRoster = () => rosterFns.forEach((fn) => fn(people()))
  const post = (m: Msg) => bc.postMessage(m)
  bc.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data
    if (m.t === 'party') partyFns.forEach((fn) => fn(m.payload))
    else if (m.t === 'bye') {
      if (roster.delete(m.id)) tellRoster()
    } else if (m.t === 'here' && m.id !== cfg.id) {
      const known = roster.has(m.id)
      roster.set(m.id, { name: m.name, stranger: m.stranger, at: Date.now() })
      if (!known) {
        tellRoster()
        // answer a newcomer at once, so neither waits a heartbeat to see the other
        post({ t: 'here', id: cfg.id, name: cfg.name, stranger: cfg.stranger })
      }
    }
  }
  // who counts as a friend, seen from this tab: everybody else here who is not a stranger, and
  // nobody at all if THIS tab is the stranger (friendship goes both ways)
  devFriends(
    () => new Set(cfg.stranger ? [] : [...roster].filter(([, p]) => !p.stranger).map(([id]) => id)),
  )
  const beat = () => {
    post({ t: 'here', id: cfg.id, name: cfg.name, stranger: cfg.stranger })
    const now = Date.now()
    let gone = false
    for (const [id, p] of roster) if (now - p.at > 4000) gone = roster.delete(id) || gone
    if (gone) tellRoster()
  }
  beat()
  window.setInterval(beat, 1000)
  window.addEventListener('pagehide', () => post({ t: 'bye', id: cfg.id }))
  devCall({ id: cfg.id, name: cfg.name }, cfg.kind, {
    send: (payload) => post({ t: 'party', payload }),
    listen: (fn) => {
      partyFns.add(fn)
      return () => partyFns.delete(fn)
    },
    roster: (fn) => {
      rosterFns.add(fn)
      fn(people())
      return () => rosterFns.delete(fn)
    },
  })
}
