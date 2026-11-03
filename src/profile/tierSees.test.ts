import { describe, it, expect } from 'vitest'
import { tierSees } from './look'
import { TIER_ORDER, openness } from '../components/visibilityLabels'
import type { VisibilityTier } from '../circuit/types'

/**
 * The profile's "Seen by" preview — would a viewer at this reach have been sent this block?
 *
 * ⚠️ IT DECIDES NOTHING AND MUST NEVER. `can_see_item` in Postgres decides what anybody
 * actually receives; this filters blocks the OWNER already holds, so they can see the subset
 * somebody else would have got. Nothing is protected by it. What it can get wrong is a sentence
 * on the owner's own screen about who can see their page, which is the whole reason the row
 * exists — so the rules are asserted here, where the Browser pane cannot help: the preview
 * harness has no session, so a screenshot of it proves the component mounts and nothing else.
 *
 * ⚠️ AND THE EXPECTATIONS ARE WRITTEN FROM THE LADDER'S SHAPE, not from `REACH`'s numbers —
 * which is the difference between a test and a second copy of the function. The claim is: a
 * block reaches a viewer when the block's AUDIENCE is at least as wide as the group the viewer
 * belongs to. `openness()` ranks the ladder the opposite way round to `REACH`, so this is
 * measured through a path that shares no arithmetic with the thing being measured.
 *
 * ⚠️ MADE TO FAIL ONCE, 3 Nov 2026. With the `certain` branch taken back out of
 * `tierSees` -- so the level is decided by rank like the other four -- three of these seven go
 * red: "is decided by the list and by nothing else", "defaults to hidden when the caller says
 * nothing", and "does not take the friends-tier blocks away from a chosen friend". The four
 * about the other levels stay green, which is the asymmetry that matters: a rank-only function
 * is correct about everything except the one thing this file was added for.
 *
 * ⚠️ AND THE FIRST DRAFT OF IT WAS WRONG, BECAUSE look.ts's OWN COMMENT READ BACKWARDS. It said
 * "a viewer clears a block when their own reach is at least as wide as the audience the block
 * was written for" — but a stranger's reach is the NARROWEST thing in this model, so "wide" was
 * doing opposite duty on the two sides of that sentence. Written from it, this assertion
 * compared `openness(block) <= openness(viewer)` and went red against code that was perfectly
 * correct. The comment is fixed; the episode is recorded because a sentence that produces a
 * confident wrong test is worth more attention than a sentence that is merely unclear.
 */
describe('tierSees', () => {
  it('reaches a viewer when the block’s audience is at least as wide as their group', () => {
    for (const viewer of TIER_ORDER) {
      for (const block of TIER_ORDER) {
        /* `certain` is not a reach and is asserted separately below — it is the one level whose
           answer is not a function of the two tiers. */
        if (block === 'certain') continue
        expect(tierSees(viewer, block)).toBe(openness(block) >= openness(viewer))
      }
    }
  })

  it('shows a public block to everybody and a private one to nobody but the owner', () => {
    for (const viewer of TIER_ORDER) {
      expect(tierSees(viewer, 'public')).toBe(true)
      /* `private` as a VIEWER is the owner looking at their own page, which the row spells
         `null` and skips the filter for entirely. Everybody else is refused — "Only me means no
         one else, owner included" is about other PEOPLE, and the owner is not one of them. */
      expect(tierSees(viewer, 'private')).toBe(viewer === 'private')
    }
  })

  /**
   * ⚠️ THE ONE LEVEL WHERE "a viewer at this tier" IS NOT A THING. A Certain list belongs to one
   * block, so two friends looking at the same page are sent different pages. No ranking can
   * express that, which is why `onList` is a third input and why the default is `false`: a
   * caller that has not been taught about lists gets the fail-closed answer rather than a guess.
   */
  describe('a block at `certain`', () => {
    it('is decided by the list and by nothing else', () => {
      for (const viewer of TIER_ORDER) {
        expect(tierSees(viewer, 'certain', true)).toBe(true)
        expect(tierSees(viewer, 'certain', false)).toBe(false)
      }
    })

    it('defaults to hidden when the caller says nothing', () => {
      for (const viewer of TIER_ORDER) expect(tierSees(viewer, 'certain')).toBe(false)
    })

    /**
     * The preview's own mapping, asserted as the product rule rather than as a line of code:
     * somebody on a list IS a friend, so being chosen ADDS the blocks that name them and takes
     * nothing away. Previewing a chosen friend as `certain` rather than as `friends` would hide
     * every ordinary friends block from them, which is the opposite of what the level does.
     */
    it('does not take the friends-tier blocks away from a chosen friend', () => {
      /* what Profile.tsx passes for `seenAs === 'certain'`: the viewer IS a friend, and the list
         only adds the blocks that name them */
      const chosen: VisibilityTier = 'friends'
      expect(tierSees(chosen, 'friends', true)).toBe(true)
      expect(tierSees(chosen, 'certain', true)).toBe(true)
      expect(tierSees(chosen, 'members', true)).toBe(true)
      expect(tierSees(chosen, 'private', true)).toBe(false)
    })

    it('leaves a friend who is on no list with the ordinary friends page', () => {
      expect(tierSees('friends', 'friends', false)).toBe(true)
      expect(tierSees('friends', 'certain', false)).toBe(false)
    })
  })

  /** `onList` is meaningless anywhere else, and must change nothing anywhere else. */
  it('ignores the list for every other level', () => {
    for (const viewer of TIER_ORDER) {
      for (const block of TIER_ORDER) {
        if (block === 'certain') continue
        expect(tierSees(viewer, block, true)).toBe(tierSees(viewer, block, false))
      }
    }
  })
})
