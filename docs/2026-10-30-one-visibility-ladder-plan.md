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
2. **Minors are capped at Friends** — they may not choose All members or Public.
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

**Phase 1 — the type and the ceiling, read-only.** Add `certain` to `visibility_tier`, add the
circles tables, add `visibility_ceiling()` and `clamp_visibility()`. Nothing calls them yet.
Zero behaviour change, provable by the Phase 0 matrix being identical.

**Phase 2 — apply the ceiling on READ.** Change `can_see` to clamp by the owner's ceiling. This
is where Josh's three blocks and jefelegendary's person narrow. Expected and listed above: the
matrix changes in exactly those cells and nowhere else.

**Phase 3 — Only me stops meaning "only me and Evan".** Remove `is_admin()` from `can_see`'s
friends branch and from `movie_visible`. ⚠️ **This will break admin screens that rely on it** —
they must be enumerated first (`grep` for `is_admin` is the start, but the real list comes from
asking which admin views read member content). Replace with explicit, narrow admin paths rather
than a blanket bypass.

**Phase 4 — the booleans become levels.** `shared`, `timeline` → a tier column, migrating
`true → friends` and `false → private`. Both directions tested with the round-trip discipline:
a fixture where every field differs from its default, each field dropped in turn to watch it go
red.

**Phase 5 — writes clamp, and the UI offers one control.** Every setter routes through
`clamp_visibility`. One shared picker component replaces the five different shapes of control
members see today.

**Phase 6 — the feed gets its scope.** `feed_recent(p_scope)` with `you_and_friends` (the
default) and `all_members`, and a tab in `FeedRoom`. The interim `age_band` guard folds into the
ladder's minor cap at this point and `feed_opt_in` can retire.

---

## 5 · What I need from you before Phase 1

1. **Who is a minor?** Nothing in the database knows. Until you mark them the feed shows nobody
   but yourself to anyone — that is the guard doing its job, but it also means the feed is quiet
   for everybody right now. One line per person and I can set them.
2. **Phase 3 is the risky one.** Removing the admin bypass is correct for "Only me means no one
   else" but it will change what your own admin screens can see. Do you want that, or do you want
   Only me to exclude the admin while the other levels keep the bypass?
3. **jefelegendary's circuit person** is the one row that genuinely narrows. Tell him, or leave it?
4. **Certain friends** — circles, as proposed? Or per-item lists after all?
