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

> ⚠️ **THIS TABLE ASSUMES EVERY MEMBER IS AN ESTABLISHED ADULT, AND TODAY NONE OF THEM IS.**
> Added after Phase 1 was built, because building it made the table above conditional.
> `visibility_ceiling` caps anyone whose `age_band` is not `adult` at **Friends** — minors and
> unknowns alike, deliberately, since a cap that assumes adulthood protects nobody. Measured on
> the live data the moment the function existed: **13 of 14 members sit at a `friends` ceiling**,
> because nobody's age has been set yet.
>
> So the mapping below is what happens _once the adult/minor list is in_. Run Phase 2 before
> that and it does not narrow three rows, it narrows almost everything to Friends. **Phase 2 is
> gated on the list**, and that is now written into the phase itself.

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

**Phase 2 — apply the ceiling on READ. ⚠️ GATED ON THE ADULT/MINOR LIST.** Change `can_see` to
clamp by the owner's ceiling. With ages established this narrows exactly the rows in §3 —
Josh's three blocks and jefelegendary's person. **Without them it narrows 13 of 14 members to
Friends**, because the ceiling treats an unestablished age as a minor's. The list is not a
nice-to-have for this phase; it is the input that decides whether the phase does what §3 says.

A phase that cannot state what it will change before it runs does not run. Re-measure the
ceiling distribution immediately before applying, and compare it to §3.

**Phase 3 — Only me stops meaning "only me and Evan", and the general bypass goes.** Decided:
the admin moderation view stays, but it must **respect Only me**, and the blanket bypasses go —
`is_admin()` comes out of `can_see`'s friends branch and out of `movie_visible` entirely.

So the admin keeps a named, deliberate path for moderation and loses the ambient ability to read
every friends-tier block and every rating on the site. ⚠️ **Enumerate what breaks before
changing it**: `grep` for `is_admin` is only the start, because the real list is "which admin
views read member content", and some of them read it through functions that do not mention
`is_admin` themselves. The moderation path should be explicit enough that reading somebody's
content is a thing you can see in the code, not a side effect of who you are.

⚠️ And Only me must mean Only me **through the moderation path too** — an admin view that
respects the tier everywhere except its own queries has not implemented the rule, it has moved
it.

**Phase 4 — the booleans become levels.** `shared`, `timeline` → a tier column, migrating
`true → friends` and `false → private`. Both directions tested with the round-trip discipline:
a fixture where every field differs from its default, each field dropped in turn to watch it go
red.

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

**Phase 1 is built and inert.** The only thing standing between here and Phase 2 is the
adult/minor list — and it is a harder gate than it looked when this plan was written, because
the ceiling treats "age not established" exactly as it treats "minor". That is the right
default and it means Phase 2 cannot be a quiet step.

One other thing to decide before Phase 5, noted while building Phase 1 and not urgent:
`clamp_visibility` silently narrows a request rather than refusing it. For a setter driven by a
picker that only ever offers reachable levels, silent is right. For an import, a restore, or any
path that replays a level chosen under an older ceiling, silent is how somebody's setting changes
without them being told. The write paths will need to decide which of the two they are — the same
question `chronicle_import` had to answer about span rules.
