import { useEffect, useState } from 'react'
import { type Kept, seenPictures } from './cloud'

/**
 * One signed picture, by id, for whoever is drawing it.
 *
 * ⚠️ IT BATCHES, AND THAT IS THE WHOLE REASON IT EXISTS RATHER THAN AN EFFECT PER COMPONENT. A
 * week of workouts is seven cards; a month is thirty. Each asking for its own picture is thirty
 * round trips and thirty RPCs, and the alternative — resolving in `Feed` and threading a lookup
 * down through WeekView and DayView into LogCard — is four levels of prop for a photograph. Ids
 * asked for within the same tick go up as one call instead, which is what the `seen` op's array
 * was for.
 *
 * ⚠️ AND IT FORGETS, BECAUSE A SIGNED URL STOPS WORKING. The edge function signs reads for an
 * hour (GET_FOR). A cache that lives as long as the tab would therefore start handing out dead
 * links to a page somebody left open over lunch — and a dead R2 link is a broken image with
 * nothing to say why. Anything older than STALE_AFTER is asked for again, which is cheap because
 * the answer is one row and a signature.
 */
const STALE_AFTER = 45 * 60 * 1000

/**
 * ⚠️ MATCHED TO THE `seen` OP'S OWN CAP, so the client never builds a request the server will
 * refuse. The op dedupes and rejects more than this; `pictures_i_can_see` has a looser 200 behind
 * it as a backstop for any other caller. A batch above the cap is SPLIT rather than truncated —
 * a month view is allowed to hold more photographs than one request carries, and silently
 * dropping the overflow would draw some of the page and not the rest, which is the shape of a
 * bug nobody can see the cause of.
 */
const PER_CALL = 60

type Held = { at: number; pic: Kept | null }

const held = new Map<string, Held>()

/** ids waiting for the next flush, each with everyone who asked */
let waiting = new Map<string, Array<(p: Kept | null) => void>>()
let timer: ReturnType<typeof setTimeout> | null = null

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

const flush = () => {
  timer = null
  const batch = waiting
  waiting = new Map()
  const at = Date.now()

  void Promise.all(
    chunk([...batch.keys()], PER_CALL).map(async (ids) => {
      const got = await seenPictures(ids)
      const by = new Map(got.pictures.map((p) => [p.id, p]))
      for (const id of ids) {
        const pic = by.get(id) ?? null
        /**
         * ⚠️ A MISS IS CACHED, A FAILURE IS NOT, and conflating the two was the bug. Caching a
         * real miss is deliberate: `seenPictures` returns fewer than it is asked for without
         * saying so, and without remembering the absence every render asks again for the one id
         * that can never be answered — an accidental loop. But a FAILED call produces the same
         * empty-handed shape while proving nothing, so caching it would pin a perfectly good
         * photograph as missing until the entry went stale, 45 minutes later, from one dropped
         * connection. On failure the waiters get null for this draw and the id is left unknown,
         * so the next render asks again.
         */
        if (!got.failed) held.set(id, { at, pic })
        for (const w of batch.get(id) ?? []) w(got.failed ? null : pic)
      }
    }),
  )
}

export function pictureById(id: string): Promise<Kept | null> {
  const have = held.get(id)
  if (have && Date.now() - have.at < STALE_AFTER) return Promise.resolve(have.pic)
  return new Promise((resolve) => {
    const waiters = waiting.get(id)
    if (waiters) waiters.push(resolve)
    else waiting.set(id, [resolve])
    /* ⚠️ plain `setTimeout`, not `window.setTimeout`: the suite runs in node, where `window` is
       undefined, so the windowed form made this module impossible to ask a question of.

       The `timer === null` guard is an OPTIMISATION, not a correctness condition, which is worth
       writing down because it reads like one. Dropping it and arming a timer per caller leaves
       every test green: the first `flush` takes the whole `waiting` map and replaces it, so the
       extra flushes find nothing to send. It saves the timers, not the requests. */
    if (timer === null) timer = setTimeout(flush, 30)
  })
}

/** forget one, so the next draw asks again — for right after it is attached or removed */
export function forgetPicture(id: string | null | undefined) {
  if (id) held.delete(id)
}

/** the whole cache, for a test that needs a known starting point */
export function forgetAllPictures() {
  held.clear()
}

/** the picture behind an id, or null while it is being fetched and if it cannot be had */
export function useSeenPicture(id: string | null | undefined): Kept | null {
  const [pic, setPic] = useState<Kept | null>(null)
  useEffect(() => {
    if (!id) {
      setPic(null)
      return
    }
    let dead = false
    void pictureById(id).then((p) => {
      if (!dead) setPic(p)
    })
    return () => {
      dead = true
    }
  }, [id])
  return pic
}
