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

type Held = { at: number; pic: Kept | null }

const held = new Map<string, Held>()

/** ids waiting for the next flush, each with everyone who asked */
let waiting = new Map<string, Array<(p: Kept | null) => void>>()
let timer: number | null = null

const flush = () => {
  timer = null
  const batch = waiting
  waiting = new Map()
  const ids = [...batch.keys()]
  void (async () => {
    const got = await seenPictures(ids)
    const by = new Map(got.map((p) => [p.id, p]))
    const at = Date.now()
    for (const [id, waiters] of batch) {
      /**
       * ⚠️ A MISS IS CACHED TOO, as `null`. `seenPictures` returns fewer than it is asked for
       * without saying so — a picture that has gone, or that this viewer may not see, is simply
       * absent. Without remembering the absence, every render asks again for the one id that can
       * never be answered, which is the shape of an accidental loop.
       */
      const pic = by.get(id) ?? null
      held.set(id, { at, pic })
      for (const w of waiters) w(pic)
    }
  })()
}

export function pictureById(id: string): Promise<Kept | null> {
  const have = held.get(id)
  if (have && Date.now() - have.at < STALE_AFTER) return Promise.resolve(have.pic)
  return new Promise((resolve) => {
    const waiters = waiting.get(id)
    if (waiters) waiters.push(resolve)
    else waiting.set(id, [resolve])
    if (timer === null) timer = window.setTimeout(flush, 30)
  })
}

/** forget one, so the next draw asks again — for right after it is attached or removed */
export function forgetPicture(id: string | null | undefined) {
  if (id) held.delete(id)
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
