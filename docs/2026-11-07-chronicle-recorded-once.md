# Recorded once, seen in both places — the workout model, proposed

Second pass of the Chronicle thread, 7 Nov 2026. The first
(`2026-11-07-chronicle-the-daily-flow.md`) was the inventory and two connectors. This one is the
discoverability pass plus **two proposals, neither applied to any database**.

Evan settled three directions before this started, so they are decisions rather than questions
below:

1. a weekday schedule change affects **future occurrences, not past completion history**;
2. a standalone dated note is **private by default, in the export, never automatically on
   anybody's timeline**;
3. **Circuit supplies exercise definitions; Chronicle owns workout sessions and progress.**

And one requirement: _"record once, see it in both places"_ — reps logged through Chronicle
should appear against the relevant Circuit exercise, and a workout logged from Circuit should
appear in Chronicle's feed and count toward applicable goals **exactly once**.

---

## 1 · What already connects, read before proposing anything

**Circuit → Chronicle exists and is one-way and read-only.** `chronicle_moments` joins
`circuit_logs` to `circuit_people` where `owner_user_id = auth.uid()`, unpacks the day's
`entries` jsonb and renders them as one line in the day log — `🏋 Quad Curl 12 reps · Bench 8
reps`, cut at four with a count of how many there were. It carries the **day and no hour**, on
purpose: `circuit_logs.date` is a DATE and the only timestamp beside it is `updated_at`, which on
this account is a sync artefact (682 logs over 355 workout days, 15 distinct `updated_at` days).

**And it deliberately counts towards nothing.** A moment is an instant, never written to
`chronicle_entries`, specifically so no fabricated duration reaches the totals, the grids or any
goal. That decision is right and is the reason half of Evan's requirement is already unmet:
a workout logged in Circuit shows in the feed and moves no goal.

**Chronicle → Circuit does not exist at all.**

**And the counter cannot identify an exercise.** `chronicle_entries.amount` is ONE number against
the activity's ONE `metric`. "Gym · 60 reps" does not say that it was 12 Quad Curl and 8 Bench —
there is nowhere for it to say so. This is exactly the thing not to assume away: wiring today's
amount into `circuit_logs` would have to invent which exercise it was.

|              | Circuit                                                                               | Chronicle                                                                      |
| ------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| an exercise  | `circuit_people.exercises` — a jsonb array of `{id, name, unit, mult, cat, col, row}` | —                                                                              |
| a day's work | `circuit_logs` — one row per person per DATE, `entries: [{eid, val}]`                 | a sitting, with a start, an end, one `amount`, a rating, a journal and a photo |
| a timer      | —                                                                                     | the whole stopwatch, with `+1 / +5 / +10`                                      |
| goals        | 100 points a day, scored by `mult`                                                    | five cadences, windows, repeats, streaks                                       |

## 2 · Proposed: one canonical set

**Not applied. No SQL in this section has been run.**

### 2a. The model

One table, and it is the canonical row for a quantity of one exercise on one day — whichever
interface it was typed into.

```sql
create table if not exists public.chronicle_sets (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references public.profiles(user_id) on delete cascade,
  -- whose grid the exercise is defined on; the owner's own circuit_people row
  person_id   text not null references public.circuit_people(id) on delete cascade,
  -- an id inside that person's `exercises` jsonb. There is no FK to be had: the
  -- exercises are a blob, which is §2d's open question rather than an oversight.
  exercise_id text not null,
  -- the sitting it was counted during, or null for one typed into the Circuit's grid
  entry       uuid references public.chronicle_entries(id) on delete cascade,
  -- the day it counts for, carried rather than derived: an amount does not split at
  -- midnight (see record.ts), and a set typed into the grid has only ever had a day
  -- ⚠️ REFINED 8 Nov (OPEN-DECISIONS §16e): for a set WITH a sitting this must follow the
  -- sitting — editing its start across midnight moves the sets' day in the same call
  on_day      date not null,
  value       numeric not null check (value > 0 and value <= 1e9),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index chronicle_sets_mine on public.chronicle_sets (owner, on_day);
create index chronicle_sets_by_entry on public.chronicle_sets (entry) where entry is not null;
```

**`entry` is nullable and that is the whole trick.** A set typed into the Circuit grid has no
sitting; a set counted by Chronicle's `+5` has one. Same row either way, which is what makes this
one record rather than two stores agreeing with each other.

### 2b. Which Chronicle activity a Circuit exercise counts toward

The missing half, and the reason this cannot be inferred. One decision per exercise, the way an
activity's sharing is one decision per activity rather than one per sitting:

```sql
create table if not exists public.chronicle_exercise_activity (
  owner       uuid not null references public.profiles(user_id) on delete cascade,
  person_id   text not null references public.circuit_people(id) on delete cascade,
  exercise_id text not null,
  activity    uuid not null references public.chronicle_activities(id) on delete cascade,
  primary key (owner, person_id, exercise_id)
);
```

"Quad Curl counts as Gym." **Unmapped is the default and must stay cheap**: an unmapped
exercise's sets appear in the feed and count toward no goal, which is today's behaviour exactly.

With it, both directions work from one row:

- Chronicle's running header, on an activity that has exercises mapped to it, offers those
  exercises instead of a bare number — so `+5` writes a set naming Quad Curl, and the Circuit's
  grid shows 5 against Quad Curl because the grid is reading sets;
- a set typed into the Circuit grid counts toward any Chronicle goal whose activity the exercise
  maps to, **once**, because there is one row and one reader.

### 2c. The three places double-counting would come from, and the rule for each

| where                     | the rule                                                                                                                                                                                                                                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **the feed**              | `chronicle_moments`' workout branch reads `chronicle_sets`, not `circuit_logs`. The old branch is deleted in the same migration that migrates the logs, never left running beside it                                                                                                           |
| **a sitting's amount**    | `chronicle_sum` reads `coalesce((select sum(value) from chronicle_sets where entry = e.id), e.amount)` — derived at read time, never a copy written into `amount`. A sitting with sets has no separately writable amount, and `chronicle_entry_amount` refuses one                             |
| **a set with no sitting** | the tally's amount branch unions set rows where `entry is null`, mapped to an activity by §2b. A set WITH a sitting is already counted through that sitting and must not appear in both halves of the union — the `entry is null` predicate is the whole of that rule and belongs in one place |

**Corrections and deletions.** `entry` cascades, so deleting a sitting deletes its sets and the
Circuit grid loses exactly what that sitting put there. Editing a set is one `update` to one row
and both readings move together, because both are reading it. Moving a sitting to another
activity (`chronicle_entry_move`) does **not** move its sets — the exercise is still the exercise
— which means a goal's number changes and the Circuit's does not. That is correct and is the kind
of thing that needs saying on screen rather than discovering.

### 2d. Permissions

Both tables follow the house pattern in CLAUDE.md §3: **RLS on, zero policies, no grants**,
reached only through `SECURITY DEFINER` functions that check `auth.uid()`.

⚠️ **The revoke has to name `anon` explicitly**, because `pg_default_acl` on `public` hands
`arwdDxtm` to `anon` and `authenticated` on every new table and a revoke aimed at `PUBLIC` leaves
`anon` untouched:

```sql
alter table public.chronicle_sets enable row level security;
revoke all on table public.chronicle_sets from public, anon, authenticated;
-- and the same two lines for chronicle_exercise_activity
```

⚠️ **And the writer must check the person_id by hand.** `circuit_people` keeps its rules in **8
RLS policies**, and a `SECURITY DEFINER` function does not consult them — the same trap
`chronicle_moments` documents. So `chronicle_set_put` checks, on its own first lines, that the
`circuit_people` row is the caller's **and** that the entry, when one is given, is the caller's.
Neither is a belt over a brace; both are the brace.

### 2e. The isolated tests, before anything is believed

In a rolled-back transaction (wrapped in a `raise` so it rolls back even in autocommit — the
trick `chronicle_goal_window`'s probe needed), with a simulated session, as two different
members:

```sql
-- the tables are unreachable directly, which is the claim the whole pattern rests on
select has_table_privilege('anon','public.chronicle_sets','select')  as anon_select,   -- false
       has_table_privilege('anon','public.chronicle_sets','insert')  as anon_insert,   -- false
       has_table_privilege('anon','public.chronicle_sets','truncate') as anon_truncate, -- false
       has_table_privilege('authenticated','public.chronicle_sets','truncate') as auth_truncate; -- false
```

⚠️ `truncate` is in that list deliberately: there is no TRUNCATE policy type, so RLS never
applies to it, and the "RLS makes the grant inert" reasoning in CLAUDE.md §3 is a per-privilege
claim that does not cover it.

Then, each proved by the refusal rather than by reading the code:

| asked                                                             | expected                          |
| ----------------------------------------------------------------- | --------------------------------- |
| a member writes a set on **another member's** `person_id`         | refused                           |
| a member writes a set on **another member's** entry               | refused                           |
| a member reads another member's sets through every new function   | 0 rows                            |
| `anon` executes any new function                                  | `permission denied for function`  |
| a goal's tally, **before and after** the same 12 reps are written | moves by 12, once                 |
| the same reps read through the Circuit grid                       | 12, the same row                  |
| delete the sitting                                                | both readings drop by 12 together |
| `chronicle_entry_amount` on a sitting that has sets               | refused                           |
| an exercise with no mapping                                       | in the feed, 0 against every goal |

And the standing check this project runs on every new function:

```sql
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute');
```

### 2f. Release, in three steps that are each inert alone

1. **The tables and functions**, nothing reading them. Changes no behaviour; rollback is `drop
table`, and there is nothing in them to lose.
2. **The readers**, one at a time — the Circuit grid reads sets unioned with `circuit_logs`
   (which is still canonical), then the tally, then `chronicle_moments`. Each is a
   `create or replace` and each is individually revertible to the version in git.
3. **The migration of `circuit_logs`**, one set row per `{eid, val}`, after which the old
   `chronicle_moments` branch is deleted and `circuit_logs.entries` is **frozen rather than
   dropped** — the two-step the `note` column got, so the rollback for a fortnight is "point the
   readers back".

⚠️ **707 logs and other people's data.** `circuit_logs` holds rows for people who are not Evan,
and `circuit_people` rows that belong to nobody's login. Step 3 migrates **only** rows whose
person is owned by a real account, and the rest keep working through the old path — which is why
step 3 cannot delete `circuit_logs` and this plan does not propose it.

## 3 · Proposed: a dated note with no sitting

**Not applied.** Smaller than it looked last pass, because `chronicle_notes` **already carries
`owner uuid not null`** — the ownership rule is a column, not something derived from the entry.
The table is RLS-on with zero policies and grants to `service_role` only, so it is already
deny-all.

```sql
alter table public.chronicle_notes alter column entry drop not null;
alter table public.chronicle_notes add column on_day date;
alter table public.chronicle_notes add constraint chronicle_note_placed
  check ((entry is not null and on_day is null) or (entry is null and on_day is not null));
```

The constraint is an exclusive or on purpose: a note either belongs to a sitting, which places it
in time, or to a day. One carrying both would have two answers to "when".

Against Evan's three directions:

- **private by default** — unchanged, and needs no new switch: the table is deny-all and every
  reader is a function scoped to `auth.uid()`;
- **in the export** — `chronicle_export` gains the standalone notes as their own list, and
  `chronicle_import` takes them under the same add-never-replace rule as everything else;
- **never automatically on anybody's timeline** — `chronicle_friends_log` carries **no note at
  all** today, so this needs no change. It needs a **test**, because "it happens not to" and "it
  is guaranteed not to" are different claims and only one of them survives the next edit.

The one reader that needs a decision is the day log, and it is §4 of OPEN-DECISIONS rather than
here: a list whose every row is a span with a length, being asked to hold a row with neither.

## 4 · What this pass actually changed

No schema. Two changes, both reversible:

**The room opens on Aims.** The flow asked for is _open Chronicle → see what's due → check it off
or start its timer_, and Day is about what you are DOING — so the first step of the flow was a tap
nothing suggested taking. The stopwatch is in neither half, so opening here still shows the clock,
what is running, the switch tiles and ＋ Activity, with the horizon strip and today's goals under
them. **Every step of the daily flow is on one screen for the first time.** What moves a tab away
is the sitting-down half: the day log, the totals, the week strip, the rail, plans, routines and
the activity list.

**✎ Note on the running sitting**, and the journal drawn first inside the dialog while a sitting
is open. The note box beside Stop was removed in October for a good reason — it asked what a
sitting was worth before it was over — but the consequence nobody wrote down is that writing
something became "press ✎ on the row in the day log with no end on it", two taps into a list on
the other half, with nothing saying it was there. This is the door, not a second write path: it
sets `fixEnt`, which is what that ✎ sets. A box here with its own `addNote` would be the **third**
place a note has been written from in this file, and the first two both lost one.

The button carries the count of what is already written, so the journal is visible without being
opened.

## 5 · What was checked, and how

**Mocked (the preview double, `#chronicle` with `dev_preview_member`):**

- the room opens on Aims with the clock, ✎ Note, Stop, the switch tiles, the horizon strip and
  today's three goals on one screen at 375;
- ✎ Note opened the editor on the running sitting with **Journal first** (field order read back
  as `Journal, What it was, From, Photograph`), typed a note, pressed Add — it appeared in the
  list, and the button then read `✎ Note 1`;
- **the note stayed where it was typed.** Switched to Dishes immediately afterwards: the new
  sitting's button read "nothing written yet", and the Drawing row in the day log carried
  _"the hands again, finally"_. That is the exact failure the old 700ms autosave had, and it
  cannot happen here because the note is written on an explicit press against a captured id;
- `mobileAudit` at 375, both halves: `sideways 0, tooSmall 0, offEdge 0, clipped 0, insideOut 0,
spills 0, unbounded 0, wordless 0`, over **41 in-room controls** on Aims and **27** on Day.

**Real signed-in: none.** Everything above is the double. `pvStart` and `pvNoteAdd` are pinned
against their server counterparts by the double's own tests, but a double agreeing with a room is
one source, not two.

**Real device: none.** 375 in the pane is Chromium with touch emulation. Firefox and Safari are
untested as always.

**Exact-head CI** on `191f4e7` (PR #33's head when this pass started): `db guards`, `Test` and
`Build` all success, five jobs, nothing pending.
