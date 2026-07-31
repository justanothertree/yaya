# Visibility tiers — design for approval

**Status:** proposed, nothing applied. Per the standing agreement, the schema gets Evan's
approval before it touches prod.

**Goal:** replace four hand-rolled privacy mechanisms with one. Today "who can see this row?"
is answered differently in four places — `circuit_people.is_public`, circuit group membership,
`are_friends()` for the Snake name reveal, and an about-to-land `profiles.lounge_opt_in`. Every new
module re-solves it, and three of this month's privacy bugs came from exactly that.

---

## 1. The model

Evan's spec: **public / friends / account-members / private, default private.**

```sql
create type visibility_tier as enum ('private', 'friends', 'members', 'public');
```

### ⚠️ The four tiers do not cover the Circuit

Circuit visibility today is _owner OR same-group member OR admin_. "My circuit-mates" is none of
private / friends / members / public — a crew can contain someone you haven't friended, and
"members" would expose your board to every account on the site.

**Recommendation: keep group sharing as a separate axis rather than adding a fifth tier.**

Sharing a board into a circuit is an explicit act ("put me in The Crew"). The tier is a _floor_
that applies to everyone else. A row is visible when **either** applies:

```
visible = shared_into_a_group_you_are_in   OR   tier_allows_you
```

Why not a fifth `circle` tier: an enum forces one choice, so Evan could have "my crew sees this"
_or_ "my friends see this", never both. The two-axis version also means the migration is purely
additive — today's group behaviour keeps working untouched while tiers layer on top.

### One predicate, used everywhere

```sql
create function can_see(p_owner uuid, p_tier visibility_tier) returns boolean as $$
  select case
    when p_owner = auth.uid()          then true          -- always see your own
    when public.is_admin()             then true          -- caretaker access
    when p_tier = 'public'             then true
    when p_tier = 'members'            then exists (select 1 from profiles
                                          where user_id = auth.uid()
                                            and coalesce(suspended,false) = false)
    when p_tier = 'friends'            then public.are_friends(auth.uid(), p_owner)
    else false                                            -- 'private'
  end;
$$ language sql stable security definer;
```

Every policy calls this. Change the rule once, it changes everywhere — which is the whole point.

---

## 2. Where tiers live (slice 1)

Not all 25 tables. Only the three surfaces that have actually caused problems:

| Table             | Column       | Replaces                                              |
| ----------------- | ------------ | ----------------------------------------------------- |
| `circuit_people`  | `visibility` | `is_public` boolean                                   |
| `chat_rooms`      | `visibility` | the hardcoded `kind` logic in `chat_room_member()`    |
| `player_registry` | `visibility` | the friends-only Snake reveal in `snake_friend_names` |

**`circuit_logs`, `circuit_movies`, `circuit_watchlist` inherit** — a log is visible if its person
is. They get no column, so there's nothing to keep in sync.

### Snake needs a note

`score_history`, `leaderboard`, `trophies` and `round_results` have **no `user_id` at all** —
Snake identity is name-keyed, and only `player_registry.user_id` links a handle to an account
(10 of 108 handles are linked). So the tier belongs on **the handle, not the score**: "who may
learn that Krazay is me." That is what Evan actually asked for. Per-score tiers would be a lot of
machinery for a question nobody has asked.

---

## 3. Backfill — existing exposure carries

Evan said both "default private" and "existing exposure carries". Those reconcile cleanly:
**the column defaults to `private` so every new row is private**, while the one-time backfill
sets existing rows to what they already are in practice. Nothing changes on the day it lands.

| Table             | Rows                      | Backfill                                                                    |
| ----------------- | ------------------------- | --------------------------------------------------------------------------- |
| `circuit_people`  | 8 (1 public, 6 owned)     | `is_public` → `public`; rest → `private` (group sharing still carries them) |
| `chat_rooms`      | 2 circuit, 1 lounge, 1 dm | circuit + dm → `private` (membership governs); lounge → `members`           |
| `player_registry` | 108 (10 linked)           | linked → `friends` (matches shipped behaviour); unlinked → `private`        |

Then `is_public` gets dropped only after the client stops reading it — two steps, not one.

---

## 4. Client changes

- One shared `<VisibilityPicker>` — four options in plain words, not enum names:
  _Only me · Friends · Anyone with an account · Anyone_
- Circuit: replace the existing public toggle in CircuitsPanel with the picker.
- Chat: per-room setting for rooms you own.
- Account settings: your Snake handle's tier.
- `circuit_public()` switches from `is_public` to `can_see`, so the signed-out board keeps working.

---

## 5. Rollout

1. Type + `can_see()` + columns, all defaulting to `private`. Additive, nothing enforced.
2. Backfill, then verify every row of all 8 people / 4 rooms / 108 handles by hand — the dataset
   is small enough to check exhaustively rather than sample.
3. Flip policies to use `can_see`, one table at a time, verifying each with simulated-JWT sessions
   as Evan, a friend, a non-friend member, and anon.
4. Client picker.
5. Drop `is_public`.

Steps 1–3 are the risky ones and are individually revertible.

---

## Decisions (Evan, 2026-07-31)

1. **Two switches, not a fifth tier.** ✅ Group sharing stays separate from the tier, so a board can
   be visible to your crew _and_ your friends without choosing between them.
2. **`friends` means literal friends.** ✅ It does not extend to friends-of-circuit-mates.
3. **Admin override stops at `private`.** ✅ See below.

### Why admin override stops at `private`

Evan is and will remain the only admin, and wants to moderate for everyone's safety and his own
interest as the site owner. That is unaffected by this decision, because **the app's RLS policies
were never what gave him access**: he owns the tables and the service role bypasses row security,
so he can read any row from the Supabase dashboard whether or not a policy says so.

So the only question this setting answers is whether _the website_ hands him private rows while he
is browsing normally. Making it stop at `private` costs no real capability, and buys the ability to
tell members "private means private" and have it be true in the product. Industry norm is the same
shape: operators _can_ reach everything, but access is reactive — triggered by a report — rather
than ambient.

Admin override still applies at `friends`, `members` and `public`, so caretaking unclaimed boards
and fixing imports all keep working.

**Follow-on, not in this slice:** a **Report** button that puts flagged content in an admin queue.
That is how moderation should reach private content — the reported item surfaces, not everything.
Worth deciding deliberately (and telling members) whether DMs are readable for safety reasons,
rather than letting a policy default decide it.
