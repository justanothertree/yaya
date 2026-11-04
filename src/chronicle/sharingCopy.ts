/**
 * The two sentences the Sharing panel uses to say what reaches whom — pure, so they can be asked
 * a question without a browser.
 *
 * ⚠️ THEY ARE HERE BECAUSE ONE OF THEM WAS WRONG FOR AS LONG AS THE PANEL HAS EXISTED, and no
 * check anywhere could have said so. "On. Friends can see your sittings on 3 activities" was shown
 * above a Chronicle card set to Only me: three true facts — the switch is on, the rows name their
 * levels, the levels are real — adding up to a false impression, with nothing on screen to give it
 * away. The cause was in the database (`chronicle_shares_timeline` asks `can_see_item`, which an
 * owner can never fail about their own block) and the symptom was a string in a component.
 *
 * ⚠️ THE INVARIANT IS THE ORDER, NOT THE WORDING. Both lines walk a chain from the outside in and
 * name the FIRST link that is missing. Reaching somebody needs the card, then the card's switch,
 * then a card they can see, then the item's own level — and naming the wrong link makes a control
 * that works look broken: "pick some friends" is useless advice about a card nobody can see. The
 * test sweeps every combination of the three booleans, including the ones the server cannot
 * produce, because a reordered ternary is exactly the edit that would not look wrong.
 */

/** the four facts both sentences are built from — the panel's state minus its lists */
export type Reach = {
  /** the timeline switch's own state: what the owner ticked */
  timeline: boolean
  /** whether a card carrying that switch reaches anybody — `item_reaches_anyone`, not `can_see` */
  timelineReaches: boolean
  /** a Chronicle card exists on the profile at all */
  hasCard: boolean
  /** a card asks for goals — `config.goals`, which is not the timeline's key */
  wantsGoals: boolean
  /** whether a card carrying THAT switch reaches anybody */
  goalsReach: boolean
}

/**
 * ⚠️ `ticked` IS COUNTED FROM `reaches`, NEVER FROM THE TIER, and the caller owes it that. An
 * activity at `certain` with an empty list is set to a sharing level and reaches nobody, so a
 * count built on the tier would put a wrong number in the one sentence that must not have one.
 */
export function timelineSays(s: Reach, ticked: number): string {
  if (!s.timeline)
    return 'Off. Nobody can see your sittings. Your hours and goals follow your profile card as before.'
  if (!s.timelineReaches)
    return 'On — but your Chronicle card is set so nobody else can see it, so nothing is shared yet.'
  if (ticked === 0)
    return 'On — but no activity is ticked yet, so nothing is shared. Tick the ones below.'
  return `On. Friends can see your sittings on ${ticked} ${ticked === 1 ? 'activity' : 'activities'} — and nothing else: no notes, no ratings. Goals are below.`
}

/**
 * ⚠️ A GOAL REACHES SOMEBODY THROUGH EXACTLY ONE PATH. `get_member_chronicle` is the only reader
 * of `chronicle_goals` that consults `can_see`, so there is no feed half to this: a card, its
 * goals switch, a card the viewer can see, and then the goal's own level. The rows answer the
 * fourth; this names whichever of the first three is missing.
 *
 * ⚠️ AND THE LAST LINE DOES NOT PROMISE THAT `private` HIDES A GOAL'S EXISTENCE. The card carries
 * "1 goal on the go" as its own payload, counts without titles, gated by the block's visibility
 * rather than the goal's — a deliberate decision, see docs/2026-10-14-chronicle-profile-block.sql.
 * What a level here governs is the title.
 */
export function goalsSays(s: Reach): string {
  if (!s.hasCard)
    return 'Your profile has no Chronicle card, so your goals are not shown anywhere. Add one under My profile and tick “Show the goals I’ve picked”.'
  if (!s.wantsGoals)
    return 'Your Chronicle card is not showing goals. Tick “Show the goals I’ve picked” on it, under My profile.'
  if (!s.goalsReach)
    return 'Your Chronicle card is set so nobody else can see it, so no goal title is shown yet.'
  return 'Who can see each goal. Your card counts them either way; a level here decides whether the title is shown.'
}
