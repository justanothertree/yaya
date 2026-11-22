import { voiceSession } from '../../voice/voiceSession'
import { friendIdsNow, refreshFriendIds } from './friends'
import { labShareAllowed, type Verdict } from './gate'

/**
 * The Lab's one answer to "may I share with this call?", kept current as people come and go.
 *
 * It recomputes whenever the call changes (someone joins or leaves, the call starts or ends), and
 * reloads the friend list at the start of every call — a friendship made or ended since the last
 * call counts in the next one. Until the list arrives the answer is no (gate.ts fails closed).
 */
let verdict: Verdict = { allowed: false, why: 'no-call' }
const listeners = new Set<() => void>()
let wasIn = false
let started = false

function recompute() {
  const v = voiceSession.getState()
  const next = labShareAllowed({
    inCall: v.inCall,
    roomKind: v.roomKind,
    present: v.peers.map((p) => p.id),
    friends: friendIdsNow(),
  })
  const same = JSON.stringify(next) === JSON.stringify(verdict)
  verdict = next
  if (!same) listeners.forEach((l) => l())
}

function start() {
  if (started) return
  started = true
  voiceSession.subscribe(() => {
    const inCall = voiceSession.getState().inCall
    if (inCall && !wasIn) void refreshFriendIds().then(recompute)
    wasIn = inCall
    recompute()
  })
  recompute()
}

export const labSocial = {
  /** the verdict now; starts watching the call the first time anybody asks */
  get(): Verdict {
    start()
    return verdict
  },
  allowed: () => labSocial.get().allowed,
  subscribe(fn: () => void) {
    start()
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}
