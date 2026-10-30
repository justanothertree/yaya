# One feed, and the switch that makes half of it possible

✅ APPLIED 29 Oct 2026 as four migrations:
`activity_events_carry_their_own_id`, `one_feed_for_the_whole_site`,
`the_feed_includes_you`, `one_switch_for_sharing_a_chronicle`.

Asked for as "making Chronicle the main feed and having invites auto-friend people". The audit
changed both halves of that, so what was built is not what was asked for word for word — this
file is why.

---

## The invite half was already done

`complete_member_signup` has been inserting an accepted friendship with the invite's creator for
some time. Checked against the data rather than the code: **all 12 used invites** have an
`accepted` row between `created_by` and `used_by`. Only one function touches both `invites` and
`friendships`, so there is no second signup path that could skip it.

It also already generalises. The friendship is made with `v_invite.created_by`, not with Evan —
so on the day members can invite their own friends, the new person is friended to whoever invited
them with no change to this function. Two things WILL need doing then, both named here rather
than guessed at later:

- `get_invite_by_token` does not return who made the invite, and `AcceptInvite.tsx` hardcodes
  `site.name` as the sender in five places ("Ask Evan for a new one", "you and Evan are already
  connected"). That file's own comment already predicted this: _"Revisit this if friends are ever
  able to invite their own friends… the honest fix is for get_invite_by_token to return who made
  it rather than for this copy to guess."_
- `create_invite` is admin-gated. Opening it up is the actual feature; the friending underneath
  it is not.

## The feed half had a bigger problem than where to put it

The ask was Chronicle-as-feed. Measured across all 14 members first:

| gate on `chronicle_friends_log`            | members passing |
| ------------------------------------------ | --------------: |
| has a Chronicle card on their profile      |        **1**/14 |
| ticked "Show my timeline" on it            |        **0**/14 |
| any activity ticked "Friends can see this" |        **0**/14 |

So that function has returned `[]` to every member on every day it has existed. Promoting it as
it stood would have put a permanently empty page at the front door.

Three of fourteen use Chronicle at all (108 entries, all inside 30 days). Meanwhile the site
already had a feed — `#circuit?tab=feed`, where the notification bell sends every kudos and
comment — and it could show exactly one of the five kinds of thing people do here.

### What was built

One `feed_recent` RPC carrying all five kinds: chronicle sittings, circuit logs, ratings, snake
scores and trophies.

**It contains no visibility logic at all.** It calls `get_member_activity` per member and
`chronicle_friends_log` for sittings, and merges the answers. Each of those already decides who
may see what — four different answers, one deferring to `movie_visible`, another to circuit group
membership, and the chronicle's four gates. Writing those predicates out again would be a second
copy that agrees with the first until somebody changes one. This repository has that lesson twice
over from the park's stub relay.

Consequence worth stating plainly: a member at `activity_visibility = 'private'` contributes
nothing, because the function being asked says so. **Six of fourteen are**, and that is their
choice rather than something this feed gets a vote on. Proved load-bearing rather than assumed —
with Evan at `public` a viewer sees his 18 events; flipped to `private` inside a rolled-back
transaction, **18 → 0**.

### The mistake, and how it surfaced

`one_feed_for_the_whole_site` excluded the caller's own events, copying the rule from
`chronicle_friends_log` where it is right. Measured as Evan over 31 days: **0 events** — not
because the site was quiet (7 circuit logs, 8 ratings, 4 snake scores, 2 trophies in that window)
but because **every one of them was his**. One person makes most of what happens here and the
rule hid exactly that person's work from exactly that person.

A zero looks identical whether the query is wrong or the world is empty, which is the only reason
it was checked against the tables instead of believed. `the_feed_includes_you` corrects it twenty
minutes later.

It also makes the feed a **mirror**: your own sittings appear under the same gates a friend's do,
so the feed answers "is my sharing actually on?" by showing you the row itself rather than a
sentence describing it.

## The switch

Default **off**. A timeline is a sitting-by-sitting record of somebody's day and §3 is
unambiguous that two different tiers are not one decision. Nothing here widens anybody.

What changed is the number of rooms you must visit, which was two, and how many of them are in
the nav, which was zero. One switch in Chronicle now does gates 1, 2 and 4; the per-activity ticks
come with it, because "Gym" and "Therapy" are genuinely not one decision — Timer.tsx argues that
already, beside the tick it owns.

Measured end to end in a rolled-back transaction: switch on → tick one activity → feed gains
**3 sittings**, all `mine: true`; switch off → **0**. Both directions, so the switch is
load-bearing rather than decorative. The card's other config keys (`days`, `live`, `goals`,
`heading`) survive three flips — `||` on jsonb, not replacement, which is the §8 "a save that
writes every column is a delete for the ones the caller forgot" shape this repo has now found
four times.

### ⚠️ A trap avoided, and left in place for somebody else

`chronicle_activity_save` protects `colour`, `metric` and `shared` against a caller that does not
mention them — null leaves each alone, with a long comment explaining why — and then writes
`session_mins = v_session` flat. So **a caller passing null for a field it does not care about
clears the sitting length.** A share toggle is exactly that caller.

It is not a live bug: the activity editor always resends the current value, and an emptied field
legitimately means "clear". It is a trap for the next caller. Avoided here with a one-field
writer, `chronicle_activity_share`, matching the existing `chronicle_goal_share`. Fixing the
underlying asymmetry needs a sentinel for "clear" (0 already means that) **and** a client change,
which is a separate piece of work rather than something to half-do.

## What is not done

- **Kudos and comments still only attach to circuit logs.** `circuit_log_reactions` and
  `circuit_log_comments` key on a bare `log_id`. Every event now carries a stable `kind:id` —
  which is the groundwork, and the reason ratings emit a composite id rather than a bare
  `movie_id` (the table's key is the pair, and a bare film id would be one event wearing two
  people's names). Generalising the social layer is the next piece.
- **The bell still points at `#circuit?tab=feed`**, correctly: the notices it lists are about
  circuit-log kudos and comments, which still live there.
- **The Circuit's feed tab keeps its month/week/day/table views.** Those are a workout browser,
  not a feed; only the list is superseded.
- **Performance ceiling:** `feed_recent` loops members, so it is O(members). Measured **174ms**
  at 14 members. At ~200 it would be seconds and want a different shape — the same revisit point
  §5 already names for `member_library`.
