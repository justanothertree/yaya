import { devCall, voiceSession, type PartyEnvelope, type RoomKind } from '../voice/voiceSession'
import { devFriends } from '../lab/social/friends'

/**
 * ⚠️ DEV ONLY: a call between tabs of this browser, for checking anything that rides a call —
 * the party's pages and pointers, the Lab's presence, cursors and rooms — without two accounts,
 * two microphones or production Realtime.
 *
 * Open each tab at `#dev-call?name=Ann` (then `name=Bo`, …). Options:
 *   kind=dm|circuit|profile|lounge   the room kind the call claims (default dm)
 *   stranger=1                       this tab is NOT a friend of the others
 *   unfriend=Cy[,Dee]                this tab is not friends with the tabs of those names, and
 *                                    nor are they with it: the list travels with the tab, so one
 *                                    side is enough and no setup can be one-way (a real
 *                                    friendship always goes both ways). One call can then hold
 *                                    Ann and Cy who are each Bo's friend but not each other's —
 *                                    friendship is not transitive, so Bo's gate opens while
 *                                    Ann's stays shut.
 *   meter=1                          show the admin's Realtime meter in the roster (👥)
 *   id=<uuid>                        this tab stands in for that member, as a real call's peer id
 *                                    is the member's user id: what a rematch by turns challenges
 * The tab remembers its identity in sessionStorage and goes on to the Lab; a reload keeps it.
 * Close the tab, or open `#dev-call?off=1`, to leave.
 *
 * ⚠️ THE ROSTER CHANGES THE WAY A REAL CALL'S DOES, OR THE DOUBLE INVENTS FEATURES. A real call
 * drops somebody on a `bye` and on nothing else: leave() sends one (the Leave button, and a tab
 * closed through pagehide), and a crashed tab sends none — WebRTC never reports it closed either,
 * voiceSession only marks it reconnecting, so it stays on everybody's roster for the rest of the
 * call. This double used to drop a tab after 4 s of silence and to keep a tab that had pressed
 * Leave, and on 22 Nov that made a crash look eleven seconds shorter than production can make it,
 * in a commit message, as a measurement. So: a `bye` when this tab leaves the call or the page,
 * and silence changes nothing.
 *
 * What travels is exactly what the real call carries for the party: `party` envelopes, stamped
 * by the sender. What does not exist here: audio, signalling, Supabase, and any check that the
 * other tabs are who they say — the same trust the real party gives a peer's `from`.
 *
 * Only ever loaded by a dynamic import behind `import.meta.env.DEV` in main.tsx.
 */
type Cfg = {
  id: string
  name: string
  kind: RoomKind
  stranger: boolean
  meter: boolean
  /** names of the tabs this one is not friends with */
  unfriend?: string[]
}
type Msg =
  | { t: 'here'; id: string; name: string; stranger: boolean; unfriend?: string[] }
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
      id: /^[0-9a-f-]{36}$/.test(q.get('id') ?? '')
        ? q.get('id')!
        : `dev-${Math.random().toString(36).slice(2, 8)}`,
      name: (q.get('name') ?? 'Tab').slice(0, 20),
      kind: KINDS.includes(kind) ? kind : 'dm',
      stranger: q.get('stranger') === '1',
      meter: q.get('meter') === '1',
      unfriend: (q.get('unfriend') ?? '')
        .split(',')
        .map((n) => n.trim().slice(0, 20))
        .filter(Boolean),
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
  const roster = new Map<string, { name: string; stranger: boolean; unfriend: string[] }>()
  const partyFns = new Set<(p: unknown) => void>()
  const rosterFns = new Set<(people: { id: string; name: string }[]) => void>()
  const people = () => [...roster].map(([id, p]) => ({ id, name: p.name }))
  const tellRoster = () => rosterFns.forEach((fn) => fn(people()))
  let left = false
  const post = (m: Msg) => {
    if (!left) bc.postMessage(m)
  }
  const hello = (): Msg => ({
    t: 'here',
    id: cfg.id,
    name: cfg.name,
    stranger: cfg.stranger,
    unfriend: cfg.unfriend ?? [],
  })
  bc.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data
    if (m.t === 'party') partyFns.forEach((fn) => fn(m.payload))
    else if (m.t === 'bye') {
      if (roster.delete(m.id)) tellRoster()
    } else if (m.t === 'here' && m.id !== cfg.id) {
      const known = roster.has(m.id)
      roster.set(m.id, { name: m.name, stranger: m.stranger, unfriend: m.unfriend ?? [] })
      if (!known) {
        tellRoster()
        // answer a newcomer at once, so neither waits a heartbeat to see the other
        post(hello())
      }
    }
  }
  // who counts as a friend, seen from this tab: everybody else here who is not a stranger and
  // not unfriended by name on EITHER side, and nobody at all if THIS tab is the stranger —
  // friendship goes both ways
  const unfriend = new Set(cfg.unfriend ?? [])
  devFriends(
    () =>
      new Set(
        cfg.stranger
          ? []
          : [...roster]
              .filter(
                ([, p]) => !p.stranger && !unfriend.has(p.name) && !p.unfriend.includes(cfg.name),
              )
              .map(([id]) => id),
      ),
  )
  /* said again every second, so a tab that missed a newcomer's hello catches up — and never
     taken back on silence (see the header) */
  post(hello())
  const beat = window.setInterval(() => post(hello()), 1000)
  const bye = () => {
    post({ t: 'bye', id: cfg.id })
    left = true
    window.clearInterval(beat)
    bc.close()
  }
  window.addEventListener('pagehide', bye)
  /* the Leave button: a real call's leave() sends `bye` to everybody, so this one does too */
  let joined = false
  voiceSession.subscribe(() => {
    if (voiceSession.getState().inCall) joined = true
    else if (joined && !left) bye()
  })
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
