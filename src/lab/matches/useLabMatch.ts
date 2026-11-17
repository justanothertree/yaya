import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TOY_EVENT, hashParam } from '../links'
import {
  MatchError,
  acceptMatch,
  challenge,
  claimMatch,
  declineMatch,
  getMatch,
  resignMatch,
  sendMove,
  type MatchView,
  type Seat,
} from './cloud'
import { matchToy } from './games'
import { matchHash } from './words'

/**
 * The match the address names, for one toy: `#lab?demo=chess&match=<id>`.
 *
 * ⚠️ THE ADDRESS IS THE ONLY WAY IN, ON PURPOSE. Your games, the bell, a bookmark and a pasted link
 * all arrive here the same way, so they can never open different things. The link is not a key:
 * `lab_match_get` answers only the match's two players, still friends, and gives anybody else the
 * answer a match that never existed gets.
 *
 * ⚠️ A MOVE IS CHOSEN, THEN SENT. Playing on the board only proposes it (`pending`), shown on the
 * board with Undo beside it; Send is what reaches `lab-move`, which plays it by the toy's own rules
 * against the board at `seq` and refuses it if somebody moved first. A move is never sent behind
 * the player's back, and a refusal leaves the board as the server says it is.
 */
export type LabMatch = ReturnType<typeof useLabMatch>

/** the match id in the address, if the address is about this toy */
const idFor = (demo: string) =>
  /^#lab(\?|$)/.test(location.hash) && hashParam('demo') === demo ? hashParam('match') : null

/** how often an open match looks again while it waits on the other player */
const WATCH_MS = 20000

/**
 * `preview: false` for a toy where seeing the move played would give it away — a pool shot, whose
 * outcome IS the physics. Its chosen move is shown as itself (the aim), never applied, and only
 * the server's answer moves anything.
 */
export function useLabMatch(demo: string, { preview = true }: { preview?: boolean } = {}) {
  const [id, setId] = useState<string | null>(() => idFor(demo))
  const [view, setView] = useState<MatchView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<unknown>(null)
  const [hasPending, setHasPending] = useState(false)
  /* ⚠️ A GENERATION, so an answer for a match you have already left never lands on the next one */
  const gen = useRef(0)

  useEffect(() => {
    const on = () => setId(idFor(demo))
    window.addEventListener('hashchange', on)
    window.addEventListener(TOY_EVENT, on)
    return () => {
      window.removeEventListener('hashchange', on)
      window.removeEventListener(TOY_EVENT, on)
    }
  }, [demo])

  const load = useCallback(async () => {
    if (!id) return
    const g = gen.current
    try {
      const v = await getMatch(id)
      if (g !== gen.current) return
      if (v.demo !== demo) {
        setView(null)
        setError('This link is for a different toy.')
        return
      }
      setView(v)
      setError(null)
    } catch (e) {
      if (g !== gen.current) return
      setError(e instanceof Error ? e.message : 'The match could not be loaded.')
      if (e instanceof MatchError && e.status === 404) setView(null)
    }
  }, [id, demo])

  useEffect(() => {
    gen.current++
    setView(null)
    setError(null)
    setPending(null)
    setHasPending(false)
    void load()
  }, [load])

  /* ── looking again: on the way back to the tab, and every so often while it waits on them */
  const waiting =
    !!view &&
    ((view.status === 'active' && view.turn !== view.you) ||
      (view.status === 'invited' && view.you === 0))
  useEffect(() => {
    if (!id) return
    const look = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('focus', look)
    document.addEventListener('visibilitychange', look)
    window.addEventListener('online', look)
    const t = waiting ? window.setInterval(look, WATCH_MS) : 0
    return () => {
      window.removeEventListener('focus', look)
      document.removeEventListener('visibilitychange', look)
      window.removeEventListener('online', look)
      window.clearInterval(t)
    }
  }, [id, load, waiting])

  /* ── the game, by the toy's own rules */
  const rules = useMemo(
    () => (view ? (matchToy(view.demo)?.rulesFor(view.settings) ?? null) : null),
    [view],
  )
  const game = useMemo(
    () => (rules && view && view.state !== undefined ? rules.decode(view.state) : null),
    [rules, view],
  )
  /** the side the viewer moves for: their own seat in versus, the team's (0) together */
  const side: Seat = view?.mode === 'together' ? 0 : (view?.you ?? 0)
  const shown = useMemo(
    () => (preview && rules && game && hasPending ? rules.apply(game, pending, side) : game),
    [preview, rules, game, pending, hasPending, side],
  )
  const myTurn = !!view && view.status === 'active' && view.turn === view.you
  const canPlay = myTurn && !hasPending && !busy && !!rules && !!game && rules.turn(game) === side

  /** propose a move: true if it is one, and it now waits for Send */
  const play = (m: unknown) => {
    if (!canPlay || !rules || !game || !rules.legal(game, m, side)) return false
    setPending(m)
    setHasPending(true)
    return true
  }
  const undo = () => {
    setPending(null)
    setHasPending(false)
  }

  const run = async (fn: () => Promise<MatchView>, after?: (v: MatchView) => void) => {
    const g = gen.current
    setBusy(true)
    setError(null)
    try {
      const v = await fn()
      if (g !== gen.current) return
      setView(v)
      after?.(v)
    } catch (e) {
      if (g !== gen.current) return
      setError(e instanceof Error ? e.message : 'That did not work.')
      // somebody moved first, or the match changed under us: show the board as it really is
      if (e instanceof MatchError && e.status === 409) void load()
    } finally {
      if (g === gen.current) setBusy(false)
    }
  }
  const send = () => {
    if (!id || !view || !hasPending) return
    return run(
      () => sendMove(id, view.seq, pending),
      () => undo(),
    )
  }
  /** go to a match by its address: pushed, so Back returns to where you were */
  const open = (matchId: string) => {
    location.hash = matchHash(demo, matchId)
  }
  /** leave the match for the toy itself; the match carries on without you watching */
  const leave = () => {
    history.replaceState(history.state, '', `#lab?${new URLSearchParams({ demo })}`)
    window.dispatchEvent(new Event(TOY_EVENT))
  }

  return {
    id,
    view,
    error,
    busy,
    rules,
    game,
    shown,
    side,
    myTurn,
    canPlay,
    hasPending,
    play,
    undo,
    send,
    open,
    leave,
    reload: load,
    accept: () => id && run(() => acceptMatch(id)),
    decline: () => id && run(() => declineMatch(id)),
    resign: () => id && run(() => resignMatch(id)),
    claim: () => id && run(() => claimMatch(id)),
    rematch: () => {
      if (!view) return
      const other = view.seats[view.you === 0 ? 1 : 0].id
      // the asker is the new challenger; a toy with sides says which they take now
      const settings = matchToy(view.demo)?.rematch?.(view) ?? view.settings
      return run(
        () => challenge(other, view.demo, view.mode, settings, view.id),
        (v) => open(v.id),
      )
    },
  }
}
