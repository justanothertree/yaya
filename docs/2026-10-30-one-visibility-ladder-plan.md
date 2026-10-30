# One visibility ladder — audit and migration plan

**Planning only. Nothing in this file has been applied.**

The two fixes asked for alongside it are done and live (`snake_events_attach_by_user_id`,
`feed_waits_for_an_adult`).

---

## 1 · What exists today

Eleven separate controls across seven systems. Every level and default below is read from the
database, and every count is today's data.

| #   | System                     | Control                           | Levels   | Default       | Enforced by                                                                  | Today                                        |
| --- | -------------------------- | --------------------------------- | -------- | ------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Profile page               | `profiles.public_page`            | bool     | `false`       | `get_public_profile`                                                         | 1 true (evan)                                |
| 2   | Profile blocks             | `profile_blocks.visibility`       | tier ×4  | **`members`** | `can_see`                                                                    | 27 members · 10 public · 3 friends           |
| 3   | Activity feed (per member) | `profiles.activity_visibility`    | tier ×4  | `private`     | `can_see` in `get_member_activity`                                           | 6 private · 5 members · 2 public · 1 friends |
| 4   | Circuit people             | `circuit_people.visibility`       | tier ×4  | `private`     | `can_see` **or** group membership                                            | 8 private · 2 public                         |
| 5   | Ratings                    | _(none — derived)_                | n/a      | n/a           | `movie_visible`: in the film's group, **or** a friend rated it, **or** admin | 162 films, all in a group                    |
| 6   | Snake names                | `player_registry.visibility`      | tier ×4  | `private`     | leaderboard reads                                                            | 109 private · 16 friends · 3 public          |
| 7   | Chronicle sittings         | `chronicle_activities.shared`     | **bool** | `false`       | 3 gates + friendship                                                         | 27 rows, **all false**                       |
| 8   | Chronicle goals            | `chronicle_goals.shared`          | **bool** | `false`       | block config + friendship                                                    | 1 row, false                                 |
| 9   | Chronicle timeline         | `profile_blocks.config->timeline` | **bool** | absent        | `chronicle_shares_timeline`                                                  | 0 on                                         |
| 10  | Rooms (profile / park)     | `*.audience`                      | tier ×4  | `friends`     | invites                                                                      | 1 each, friends                              |
| 11  | Lounge                     | `profiles.lounge_opt_in`          | **bool** | `false`       | lounge reads                                                                 | 8 false · 6 true                             |

Plus two added four hours ago by the interim guard: `profiles.age_band` and
`profiles.feed_opt_in`.

### What the audit turned up

**a · `private` is not "only me" everywhere.** `can_see` already excludes the admin at the
`private` tier — the owner check comes first and the `else false` catches the rest. But at the
**`friends`** tier it reads `public.is_admin() or are_friends(...)`, and **`movie_visible` grants
the admin unconditionally**. So today the admin can read every member's friends-tier blocks and
every rating on the site. That is a real decision, not a bug, but it is the opposite of "no one
else, owner included" and the ladder has to settle it deliberately.

**b · Five of the eleven controls are booleans pretending to be tiers.** `shared`, `timeline`,
`public_page`, `lounge_opt_in` and now `feed_opt_in`. Each encodes exactly one level — and in
each case that level is _friends_, because chronicle sharing is friends-only by design. They map
cleanly, but only because the hidden level happens to be the same one each time.

**c · Two of them are a PAIR, and the pair is load-bearing.** A block's tier and the page being
published are separate switches, deliberately: `can_see(owner, 'public')` is true for anybody,
but a visitor cannot load the page at all unless `public_page` is set. This is why Josh has three
blocks marked `public` that no stranger can see — his page is not published. CLAUDE.md §3 names
this exactly ("two different tiers are not one decision"). **A ladder that collapses the pair
into one level would widen Josh's bio, song and status to the open web.** It must not.

**d · Ratings have no control at all.** Visibility is derived: you see a film if you are in its
group, or if a friend rated it, or if you are the admin. There is nothing for a member to set,
so there is nothing to migrate — but there is also nowhere for them to say "not this one".

---

## 2 · The proposed ladder

One type, used everywhere:

| Level               | Means                                    | Who may choose it      |
| ------------------- | ---------------------------------------- | ---------------------- |
| **Public**          | anyone on the internet                   | **Evan only**, for now |
| **All members**     | any signed-in, unsuspended member        | everyone (adults)      |
| **Friends**         | accepted friendships only                | everyone               |
| **Certain friends** | a named circle of friends                | everyone               |
| **Only me**         | nobody else — _including the site owner_ | everyone               |

Three rules on top:

1. **Public is Evan's alone** until he says otherwise.
2. **Minors are capped at Friends** — they may not choose All members or Public. ⚠️ The cap is
   not the whole protection: it bounds how wide a minor may choose to be, and says nothing about
   whether anybody agreed to an audience at all. The guardian opt-in stays alongside it — see
   Phase 6.
3. **Only me excludes the admin.** This is the one that changes existing behaviour, and it is the
   point of having the level at all.

### Certain friends needs a new structure

Per-item friend lists go stale and are unmanageable past a handful of people. Recommend **named
circles** instead — `visibility_circles(id, owner, name)` and `visibility_circle_members(circle,
friend)` — with an item carrying `circle_id` when its level is `certain`. One circle called
"Family" reused across twelve items beats twelve lists that drift apart.

### The ceiling cannot be a CHECK constraint

"Only Evan may choose Public" and "minors cap at Friends" are facts about a _different row_ (the
owner's profile), so they cannot be table constraints — the same shape as `chronicle_goals`'
half-expressible rule in CLAUDE.md §2. They go in **one function**, `visibility_ceiling(owner)`,
used by:

- every **write** path, through a shared `clamp_visibility(owner, wanted)`; and
- the **read** path too.

**Both, not just the write path.** A row stored as `public` before the cap existed must not be
_served_ as public afterwards. Clamping only on write would leave ten such rows live and make the
rule depend on somebody re-saving. This is the "count the write paths" lesson pointed at the read
side: the ceiling is a property of the owner, so it must be applied wherever the owner's level is
consulted.

---

## 3 · How every existing setting maps

Nothing widens. Two members narrow, and both are named.

| System              | Today                        | Becomes                     | Rows | Widens?                        |
| ------------------- | ---------------------------- | --------------------------- | ---- | ------------------------------ |
| profile_blocks      | `public` (evan)              | Public                      | 7    | no                             |
| profile_blocks      | `public` (**Josh**)          | **All members**             | 3    | **narrows**                    |
| profile_blocks      | `members`                    | All members                 | 27   | no                             |
| profile_blocks      | `friends`                    | Friends                     | 3    | no                             |
| activity_visibility | `private`                    | Only me                     | 6    | no                             |
| activity_visibility | `members`                    | All members                 | 5    | no                             |
| activity_visibility | `friends`                    | Friends                     | 1    | no                             |
| activity_visibility | `public` (evan + 1)          | Public / **All members**    | 2    | **narrows** (the non-evan one) |
| circuit_people      | `private`                    | Only me                     | 8    | no                             |
| circuit_people      | `public` (evan)              | Public                      | 1    | no                             |
| circuit_people      | `public` (**jefelegendary**) | **All members**             | 1    | **narrows**                    |
| player_registry     | `private` / `friends`        | Only me / Friends           | 125  | no                             |
| player_registry     | `public` (evan)              | Public                      | 3    | no                             |
| chronicle `shared`  | `true`                       | Friends                     | 0    | no                             |
| chronicle `shared`  | `false`                      | Only me                     | 27   | no                             |
| goals `shared`      | `false`                      | Only me                     | 1    | no                             |
| rooms `audience`    | `friends`                    | Friends                     | 2    | no                             |
| `public_page`       | —                            | **stays a separate switch** | —    | no                             |
| `lounge_opt_in`     | bool                         | stays its own thing         | 14   | no                             |

> ⚠️ **RESOLVED 30 Oct — this table is now live-accurate.** It briefly was not. Building Phase 1
> made it conditional: `visibility_ceiling` caps anyone whose `age_band` is not `adult` at
> **Friends** — minors and unknowns alike, deliberately, since a cap that assumes adulthood
> protects nobody — and the moment the function existed, **13 of 14 members sat at a `friends`
> ceiling** because no age had been established. Running Phase 2 then would have narrowed almost
> everything rather than the three rows below.
>
> Evan has since confirmed that nobody on the site today is a minor, and all 14 are marked
> `adult` (`everyone_here_today_is_an_adult`). Ceilings are now 13 × members and 1 × public, which
> is exactly what this table assumes. The gate is spent; the caveat is kept because the shape of
> it will return the first time somebody joins who has not been marked.

**The three narrowing rows cost almost nothing in practice.** Josh's three blocks are marked
`public` on a page that is _not_ published, so no stranger can reach them today — capping them to
All members changes nothing observable. The one that genuinely narrows is jefelegendary's circuit
person, which is reachable by the public path. Worth a word to him rather than a silent change.

`public_page` stays separate from the ladder on purpose — see §1c. Collapsing it is the one move
here that could quietly publish somebody.

---

## 4 · Migration plan

Six phases, each independently revertible, each with a measured no-widening proof.

**Phase 0 — baseline.** Hash what every member can see of every other member, before anything
changes: `docs/2026-09-15-member-to-member-sweep.sql` already simulates this. Store the matrix.
Every later phase re-runs it and diffs. A phase that changes a hash it did not intend to change
does not ship.

**Phase 1 — the type and the ceiling, read-only. ✅ DONE 30 Oct**, as
`visibility_tier_gains_certain` and `visibility_circles_and_the_ceiling`. `certain` sits between
`private` and `friends` so the enum's sort order _is_ the ladder and `least()` is the clamp; the
circles tables are deny-all (RLS on, zero policies, zero grants, checked per privilege including
TRUNCATE); `visibility_ceiling()`, `clamp_visibility()` and `may_publish_a_page()` exist and
**nothing calls any of them** — verified by asking the catalogue, not by grepping the repo. Zero
behaviour change, proved by the matrix: 14/14 activity hashes and 14/14 trophy hashes identical,
813 events.

**Phase 2 — apply the ceiling on READ. ✅ DONE 30 Oct**, as `can_see_respects_the_ceiling` and
`the_public_doors_respect_the_ceiling_too`. It took two migrations because the first one did
nothing, and finding that out is the most useful thing in this phase.

`can_see` now clamps by the owner's ceiling. Predicted beforehand to be a no-op between members
— everyone can already see `members`-tier content, so cutting `public` to `members` cannot change
what one member sees of another — and measured as one: the 196-cell viewer × owner matrix hashes
identically before and after (`35acf6cf…`, 539 blocks / 8,175 events / 130 trophies).

⚠️ **AND A NO-OP EVERYWHERE WOULD HAVE MEANT A CLAMP THAT WAS NOT WIRED.** With the anon surface
also identical, every number said the phase was clean. So the clamp was made to speak: Josh's
page published in a rolled-back transaction, his ceiling toggled between `members` and `public`
— and anon saw his **3 blocks in all three states**. `can_see` does not govern the open web at
all. The public doors compare the stored tier themselves (`b.visibility = 'public'`), so the
ceiling never reached them.

That is "count the write paths" asked of READS. Of the ten functions that compare a tier to a
literal, **four are anon-callable**; three were clamped (the fourth, `get_demo_profile`, is
fabricated data with no owner). Re-run after: page refused → ceiling raised → loads with 3
blocks → ceiling lowered → refused.

**The live effect is exactly one thing**, as predicted here: the anonymous profile surface is
byte-identical, and `circuit_public` went from 44,221 to 43,564 bytes because jefelegendary's
circuit person leaves the signed-out board. His person has 0 logs; Evan's keeps all 255.

**Phase 3 — Only me stops meaning "only me and Evan". ✅ DONE 30 Oct**, as
`phase_three_the_admin_stops_reading_by_default`, after an audit that changed what it removed.

⚠️ **THE AUDIT FOUND A THIRD BYPASS AND IT WAS THE ONLY ONE DOING ANY WORK.** The two named
here — `can_see`'s friends branch and `movie_visible` — granted the admin **nothing at all**:
he is friends with 12 of the 13 other members, the one exception has no friends-tier rows, and
all 163 films reach him through group membership anyway. `circuit_is_member` was the real one.
It began `is_admin() or`, making him a member of every circuit group, and it feeds 2 functions
and **12 policies**. `grep is_admin` finds the function; it does not find the twelve policies
leaning on it — which is exactly the worry this plan recorded, arriving from the other
direction.

Measured as the admin, before → after: groups **3 → 2**, group members **10 → 9**, and nothing
else moved (163 films, 4 watchlist, 710 logs, 479 ratings, Josh's 20 blocks all unchanged). For
members, the 196-cell matrix is byte-identical. Made to speak, since two moved numbers could also
be an unwired change: delete the admin's friendship with Josh and Josh's blocks fall 20 → 19,
where the old bypass would have held them at 20.

**Management keeps its bypasses**, decided: `rename_circuit`, `delete_circuit`,
`circuit_can_edit_person` and the finance writers stay admin-capable. What went is READING other
people's things as a side effect of who you are. `is_suspended` and `are_friends` keep their
admin answer — one bit each, and moderation needs them.

**The moderation read path is deliberately NOT built.** Held until a real report needs one,
rather than built speculatively. When it is built: it must respect Only me through its own
queries, or it has moved the rule rather than implemented it.

**Phase 4 — the booleans become levels. ✅ ADDITIVE HALF DONE 30 Oct**, as
`chronicle_sharing_becomes_a_tier`. `chronicle_activities` and `chronicle_goals` each carry a
`visibility` column now, backfilled `true → friends` / `false → private`.

⚠️ **ELEVEN FUNCTIONS READ OR WRITE `shared` AND NONE WAS TOUCHED.** A BEFORE trigger derives
whichever side was not moved and a CHECK makes disagreement impossible, so the four writers and
seven readers keep working untouched. Two columns that can drift are a bug; two that _cannot_ are
a migration in progress, and the CHECK is the whole difference.

⚠️ **`certain` sets `shared = false`**, so an activity moved to Certain friends becomes
invisible to the seven readers still using the boolean rather than visible to everyone. An
unwired level failing closed is what lets this ship before circles exist.

The useful range here is private | certain | friends, not the whole ladder: a sitting-by-sitting
timeline is friends-only by design and nothing here widens it. What the tier adds is the ability
to go NARROWER than "all my friends".

**Still owed by Phase 5**, written down now because a round trip would lose it: `chronicle_export`
carries `shared` and `chronicle_import` writes it, so exporting and re-importing would turn a
`certain` activity into a plain private one. It cannot happen today — nothing can set `certain`
yet — which is exactly why it is recorded rather than left to be found.

**Capped 30 Oct**, as `chronicle_tiers_are_capped_and_the_export_carries_them`: the column
accepted `members` and `public` and nothing stopped it — a sentence in a comment is not a
constraint. Both tables now CHECK `visibility in ('private','certain','friends')`.

**And the export now carries the tier.** Checking whether `certain` survives a round trip turned
up something older: **the goals block never carried `shared` at all**, so a goal put on somebody's
profile has come back from a restore unshared since exports existed. Fail-closed, so nothing
leaked — a setting silently lost, which is §8's shape pointed at a restore instead of a save.

### Moved to Phase 5, explicitly

Three things the original Phase 4 named that are **not** done:

1. **`timeline` becoming a level.** Recommended instead: it should NOT become one. It is a master
   switch — "do I publish a timeline at all" — and the audience now lives per activity on
   `chronicle_activities.visibility`. Making it a tier would let somebody widen a
   sitting-by-sitting record past Friends, which the profile editor refuses in writing today and
   which the new cap refuses in SQL. Decide this in Phase 5 rather than inheriting it.
2. **The import side.** `chronicle_import` reads `shared` and ignores `visibility`, so a restore
   recreates a `certain` activity as private and a shared goal as unshared. ⚠️ The goals half is a
   **live** bug — goal sharing is settable today — while the activities half cannot be reached
   until circles exist. Capture was fixed first on purpose: a backup taken from today carries
   everything, so the information is there whenever the restore learns to read it.
3. **The round-trip fixture test.** A fixture where every field differs from its default, each
   field dropped in turn to watch it go red. It is what found the goals gap by hand; it should
   exist as a file in `supabase/tests/` next to the other two.

**Phase 5 — writes clamp, and the UI offers one control.** Every setter routes through
`clamp_visibility`. One shared picker component replaces the five different shapes of control
members see today.

**Phase 6 — the feed gets its scope.** `feed_recent(p_scope)` with `you_and_friends` (the
default) and `all_members`, and a tab in `FeedRoom`.

⚠️ **THE GUARDIAN OPT-IN STAYS. It is not replaced by the Friends cap.** The earlier draft of
this plan said `feed_opt_in` could retire once minors were capped at Friends, and that was
wrong — they answer two different questions:

- the **cap** says how wide a minor may ever choose to be (never past Friends);
- the **opt-in** says whether a guardian has agreed to this child appearing in other people's
  feeds at all.

A minor capped at Friends with no guardian consent still has friends, and would still stream
into every one of their feeds. The cap bounds the audience; it does not establish that anybody
agreed to an audience. Collapsing the two would quietly turn a decision somebody has to make
into a default that happens to them, which is the opposite of what the interim guard was for.

So both survive into the ladder: `age_band` becomes an input to `visibility_ceiling()`, and
`feed_opt_in` stays exactly as it is — admin-set, because for a minor the consent that counts is
a guardian's, and a checkbox the minor can tick themselves is not that.

---

## 5 · Decided

Answered 30 Oct. These are settled; the phases above already reflect them.

| Question                       | Answer                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Who is a minor?                | **List coming separately.** Until then the guard holds and the feed shows each member only their own activity.      |
| The admin bypass               | **Keep the moderation view, make it respect Only me, drop the general friends-tier and ratings bypass.** Phase 3.   |
| jefelegendary's circuit person | **Evan tells him himself.** No silent change.                                                                       |
| Certain friends                | **Reusable named circles**, as proposed.                                                                            |
| `public_page`                  | **Stays separate from the ladder.** Only Evan may publish for now; later it opens to **adults only, never minors**. |

### The one that needs building rather than noting

`public_page` opening to adults later is its own small ceiling, and it is _not_ the same function
as the tier ceiling: publishing a page and choosing a level are the pair this audit found in §1c,
and the whole reason that pair is load-bearing is that they are allowed to disagree. So
`may_publish_a_page(owner)` is a second, one-line check — `age_band = 'adult'` and, for now, also
`is the owner` — rather than a branch inside `visibility_ceiling()`.

Writing it as one function would re-create exactly the bug §1c describes, a year from now, when
somebody simplifies two near-identical checks into one.

---

## 6 · Still open

**Phases 1–4 are done** (Phase 4's import half excepted, above). The ceiling is live on every
read path including the three anonymous ones, the admin's ambient read bypasses are gone, and
chronicle sharing is a capped tier with the old boolean kept in lockstep.

**Phase 5 is next**, and it is the first one that is mostly client work: the circles UI, one
shared picker, every setter routed through `clamp_visibility`, and the three items moved into it
above.

### Was Phase 0's matrix ever stored?

**No — not until 30 Oct.** The plan said "store the matrix" and what actually happened is that it
was recomputed by hand before and after each phase and the hash quoted in commit messages and
migration headers. That is evidence somebody has to go hunting for, in prose. It is a file now:
`supabase/tests/visibility-matrix.sql`, with the query and the recorded numbers.

⚠️ **And writing it down immediately caught a stale figure — mine.** The file first shipped saying
the matrix was unchanged through every phase, copied from the Phase 3 measurement. Running it
said **8,175 → 7,118 activity events**: `get_member_activity` has a rating branch, that branch
calls `movie_visible`, and requiring group membership for a film removed 1,057 rating events.
A recorded number went stale between the measurement and the sentence, inside the very file whose
job is to stop that.

⚠️ The matrix is member-to-member and says nothing about anonymous visitors. Phase 2 was a no-op
in it and still removed a person from the signed-out board. A clean matrix is not a clean site.

One other thing to decide before Phase 5, noted while building Phase 1 and not urgent:
`clamp_visibility` silently narrows a request rather than refusing it. For a setter driven by a
picker that only ever offers reachable levels, silent is right. For an import, a restore, or any
path that replays a level chosen under an older ceiling, silent is how somebody's setting changes
without them being told. The write paths will need to decide which of the two they are — the same
question `chronicle_import` had to answer about span rules.
