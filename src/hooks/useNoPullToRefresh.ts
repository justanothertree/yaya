import { useEffect } from 'react'

/**
 * No pull-to-refresh while `on`.
 *
 * ⚠️ A PULL-TO-REFRESH IS A RELOAD NOBODY CHOSE, and on a phone it is one drag away from the top
 * of any page. A member lost a whole minion to it on 27 Nov 2026, pulling down while looking for
 * Save. An editor holding work says no to it for as long as it is open.
 *
 * ⚠️ ON <html>, BECAUSE THAT IS WHERE THE GESTURE LIVES. Chrome on Android starts its refresh from
 * the root scroller's overscroll, and `overscroll-behavior` on the document element is the switch;
 * a rule on a section deeper down cannot reach up to it — the reason chat set this in App.tsx.
 *
 * ⚠️ COUNTED, NOT SAVED-AND-RESTORED. Chat did this with "remember the old value, put it back on
 * the way out", which is right for exactly one owner. With two — chat, and Paint in a canvas window
 * over it — the second to leave restores what the first had set, and the page is left with the
 * gesture off for good, or back on under an open editor. A count has no order to get wrong.
 *
 * Safari's own pull-to-refresh is not something this has been seen to stop: the pane is Chromium.
 */
let holders = 0

export function useNoPullToRefresh(on = true) {
  useEffect(() => {
    if (!on) return
    const el = document.documentElement
    if (holders++ === 0) el.style.overscrollBehavior = 'none'
    return () => {
      if (--holders === 0) el.style.overscrollBehavior = ''
    }
  }, [on])
}
