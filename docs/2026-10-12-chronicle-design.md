# Chronicle — a design, before any of it is built

**Status: ✅ STEPS 1–4 APPLIED plus looking back, editing and routines, 12–13 Oct 2026.** Migrations `chronicle_goals`, `chronicle_goal_rpcs` and
`chronicle_goal_window_excludes_life`. The client half is in `src/chronicle/` and
`src/sections/Chronicle.tsx`. Steps 2–5 in §4 are not started.

⚠️ **AND THE CONSTRAINT IN §5 WAS WRONG WHEN IT WAS WRITTEN, which a probe found and reading would
not have.** `chronicle_goal_window` has three clauses — "life has no window", "a repeating goal has
no single anchor", "a one-off has one" — and the third did not exclude `life`. So a lifetime goal
carrying a date satisfied the clause written to catch one-offs and sailed straight past the clause
written to stop it. Found by inserting the four rows the table is supposed to refuse and reading
which ones it took: three refused, `life` with an anchor accepted. Fixed by adding
`scope <> 'life'` to the two non-life clauses; the SQL below is the corrected version, and the
whole probe was wrapped in a `raise` so it rolled back and left the table empty.

**What else was proven rather than assumed**, all of it rolled back:

- As `authenticated`, a direct `select` on `chronicle_goals` is `permission denied for table` —
  the table is unreachable except through the four functions.
- From the browser with no session, `chronicle_goal_save` returns `401 permission denied for
function`, so `anon` cannot execute it.
- Impersonating a member: both goals come back, the title and unit are trimmed, `progress` reads
  as a number, the repeating goal keeps `every = 1` with no anchor, and a bogus scope is refused.
- **Impersonating a different member holding a valid goal id**: cannot move it, cannot delete it,
  and their own list comes back empty.

Asked for in these words: _"i want to make a chronicle module - but more than that i want to make a
goal tracker/to do list (similar concept to how i have the circuit goal of 100 points but it doesnt
have to be points just planning goal oriented, and i can imagine the circuit and checklist working
on top of chronicle) to facilitate looking ahead today/tomorrow/daily/weekly/monthly/yearly/years.
we had made an html chronicle app that was about 60% done in my eyes so i want to remake the app as
an all time tracking tool on my website."_

Source: `time_journal_12.html`, 3,476 lines, 224KB, one file, `localStorage` under `chr7_`.

---

## 1 · What the HTML app already is

Read rather than guessed at. Seven panels — dash, routines, log, cal, goals, money, lib — over nine
stores:

| Store                                  | Shape                                                                                                | What it is                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------- |
| `A` activity                           | `{name, cat: locked\|free\|life, color, goal, dailyGoal, sessionGoal, metrics[], metricGoalTarget…}` | a thing you spend time on   |
| `E` entry                              | `{name, cat, ai, start, end, note, quality, metricValues}`                                           | a finished span of time     |
| `AS`                                   | the same, with no `end`                                                                              | the timer that is running   |
| `TD` todo                              | `{name, est, due, priority, done}`                                                                   | a flat task list            |
| `planned`                              | `{name, cat, ai, start, end}`                                                                        | a future span on a calendar |
| `EV`, `routines`, `alarms`, `MA/MT/BH` | events, routines, alarms, money                                                                      |

**The heart of it is a timer over categorised activities**, and the categories are the good idea:
`locked` (committed), `free` (yours), `life` (upkeep). Activities already carry three kinds of goal
— total, per-day, per-session — plus arbitrary named metrics with targets.

⚠️ **The 40% that is missing is precisely what was asked for.** "Looking ahead" in the HTML app is
`planned` (a block on a calendar) and `TD.due` (a date on a task). There is no notion of a horizon:
nothing expresses "weekly", "this year", or "over the next few years", and nothing can be asked
"what am I aiming at this month". That is the thing to build, and it is not a port.

---

## 2 · Three decisions, taken 12 Oct 2026

1. **Its own Supabase tables**, following the house pattern — RLS on, zero policies, no grants,
   reached only through `SECURITY DEFINER` RPCs that check `auth.uid()`. This is a record of
   somebody's life: it has to survive a cleared browser and follow them between phone and desktop,
   and a time series is the wrong shape for `member_library`, which is a 400-item document store.
2. **Money stays out.** Investments already exists, is backed by Supabase and holds the real
   accounts. Porting the HTML ledger would make two homes for one thing, which §5 of CLAUDE.md names
   as the bug class behind "the song plays but the editor says it's empty". Chronicle links across.
3. **Chronicle and the Circuit stay separate for now, sharing one vocabulary of a goal.** The
   Circuit works, has an adapter and 707 logs in it. Its "100 points" must be _expressible_ in
   chronicle's model from day one — but rebuilding a module eight people use on top of an unproven
   substrate is a trade to make after chronicle has earned it, not before.

---

## 3 · The model, and the one idea it turns on

The list in the ask — _today / tomorrow / daily / weekly / monthly / yearly / years_ — is three
different things wearing one coat, and conflating them is how an app like this becomes confusing:

- **a date**: today, tomorrow
- **a rhythm**: daily, weekly, monthly, yearly
- **a scale**: years

⚠️ **So a goal carries a SCOPE — the window it is judged over — and optionally a REPEAT.** That one
move covers the whole list with no special cases:

| What you say                  | scope   | anchor     | repeat | target |
| ----------------------------- | ------- | ---------- | ------ | ------ |
| "today: finish the doc"       | `day`   | 2026-10-12 | —      | —      |
| "tomorrow: call the dentist"  | `day`   | 2026-10-13 | —      | —      |
| "daily: 30 min drawing"       | `day`   | —          | 1      | 30 min |
| "weekly: ship something"      | `week`  | —          | 1      | —      |
| "this month: four map pieces" | `month` | 2026-10-01 | —      | 4      |
| "this year: 100 points"       | `year`  | 2026-01-01 | —      | 100    |
| "learn to animate"            | `life`  | —          | —      | —      |

**Looking ahead is then one question**: _which goals have a window overlapping this range_. Today,
Tomorrow, This week, This month, This year and Years are the same list with a different range — which
is the whole reason the window lives on the goal rather than in the view.

⚠️ **A target is optional, which is what makes it "not necessarily points".** No target is a
tick-box. A target plus a unit is a quantity — `100 points`, `30 min`, `12 books`, `3 maps` — and
the Circuit's hundred points is then simply `scope: year, target: 100, unit: points`, expressible
without the Circuit having to change at all.

⚠️ **AND PROGRESS HAS TWO SOURCES, WHICH IS WHY CHRONICLE SITS UNDERNEATH.** Either you say so
(tick it, add to the count), or it is **derived from the record** — minutes logged against an
activity, rolled up over the goal's window. The second is the reason this is one module rather than
two: a goal that reads the time you actually spent is the thing a to-do list cannot do.

---

## 4 · What gets built, in order, each step worth having alone

1. **Goals and horizons.** The table in §5, the RPCs, a `#chronicle` room with the six windows, and
   goals you can add, tick and count up by hand. No timer, no entries. Shippable alone and it is the
   half that was missing from the HTML app.
2. ~~**The record.**~~ ✅ APPLIED 12 Oct 2026 — see §6.
3. ~~**Derived progress.**~~ ✅ APPLIED 12 Oct 2026 — see §6b.
4. ✅ **Time on the site** — asked for on 12 Oct, applied the same day; see §6c. (Routines and
   intention-vs-actual move to step 6.)
5. **Only then**, the question of whether the Circuit wants to sit on this.

---

## 5 · Step 1 — the SQL, not yet applied

Copied from `member_library` and `park_maps` deliberately: zero policies, FK to
`profiles(user_id) on delete cascade`, every bound a check constraint, and **no grants to `anon` or
`authenticated`** — those two tables grant only `postgres` and `service_role`, which is the clean
version of the pattern. (`profile_notes` still carries leftover `anon`/`authenticated` grants it
cannot use; worth a separate tidy, not copied here.)

```sql
-- ── chronicle_goals ─────────────────────────────────────────────────────────────
create table if not exists public.chronicle_goals (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references public.profiles(user_id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  -- the window the goal is judged over
  scope       text not null check (scope in ('day','week','month','quarter','year','life')),
  -- the start of that window, normalised by the caller; null for a repeating goal or for 'life'
  anchor      date,
  -- repeats every N windows; null is a one-off
  repeat_every int check (repeat_every is null or repeat_every between 1 and 52),
  -- null target = a tick-box; a target needs a unit so the number means something
  target      numeric check (target is null or (target > 0 and target <= 1e9)),
  unit        text check (unit is null or char_length(btrim(unit)) between 1 and 16),
  progress    numeric not null default 0 check (progress >= 0 and progress <= 1e9),
  done_at     timestamptz,
  note        text check (note is null or char_length(note) <= 2000),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ⚠️ a target without a unit is a bare number nobody can read six months later
  constraint chronicle_goal_unit_with_target check ((target is null) = (unit is null)),
  -- ⚠️ a repeating goal has no single anchor, and a one-off outside 'life' needs one
  -- ⚠️ CORRECTED: the two non-life clauses must EXCLUDE life, or a lifetime goal carrying a
  -- date satisfies the third one and never reaches the first. See the status note at the top.
  constraint chronicle_goal_window check (
    (scope = 'life' and anchor is null and repeat_every is null)
    or (scope <> 'life' and repeat_every is not null and anchor is null)
    or (scope <> 'life' and repeat_every is null and anchor is not null)
  )
);

alter table public.chronicle_goals enable row level security;
revoke all on public.chronicle_goals from public, anon, authenticated;

create index if not exists chronicle_goals_owner_scope
  on public.chronicle_goals (owner, scope, anchor);
```

⚠️ **`revoke … from public, anon, authenticated`, not just `public`.** CLAUDE.md records why: `anon`
holds execute and select grants directly in this project, so a revoke aimed at `PUBLIC` leaves it
untouched. The standing check to run afterwards is in `docs/rpc-inventory.md`.

### The RPCs

Same shape as `library_put` / `library_list`, line for line: `SECURITY DEFINER`,
`SET search_path TO 'public','pg_temp'`, and `auth.uid()` checked on the first line.

```sql
-- ⚠️ A CEILING PER PERSON, enforced here and nowhere else — the same decision member_library
-- makes. 500 goals is a decade of a goal a week; the free tier is 500MB and 26MB is in use.
create or replace function public.chronicle_goal_save(
  p_id uuid, p_title text, p_scope text, p_anchor date,
  p_repeat int, p_target numeric, p_unit text, p_note text, p_sort int
) returns uuid language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_id uuid; v_count int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_id is null then
    select count(*) into v_count from public.chronicle_goals where owner = auth.uid();
    if v_count >= 500 then raise exception 'that is 500 goals — finish or delete one'; end if;
    insert into public.chronicle_goals (owner, title, scope, anchor, repeat_every, target, unit, note, sort)
    values (auth.uid(), btrim(p_title), p_scope, p_anchor, p_repeat, p_target, nullif(btrim(coalesce(p_unit,'')),''), p_note, coalesce(p_sort,0))
    returning id into v_id;
  else
    update public.chronicle_goals
       set title = btrim(p_title), scope = p_scope, anchor = p_anchor, repeat_every = p_repeat,
           target = p_target, unit = nullif(btrim(coalesce(p_unit,'')),''), note = p_note,
           sort = coalesce(p_sort,0), updated_at = now()
     where id = p_id and owner = auth.uid()
    returning id into v_id;
    -- ⚠️ a row that is not yours and a row that does not exist return the same nothing
    if v_id is null then raise exception 'no such goal'; end if;
  end if;
  return v_id;
end $$;

-- ⚠️ ONE CALL FOR THE WHOLE BOARD rather than one per window. Six windows on screen is six
-- round trips if the view asks per window, and the rows are small — a person's entire goal list
-- is a few kilobytes. The client slices it by window; the server does not need to know the view.
create or replace function public.chronicle_goals_mine()
returns jsonb language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'title', g.title, 'scope', g.scope, 'anchor', g.anchor,
             'every', g.repeat_every, 'target', g.target, 'unit', g.unit,
             'progress', g.progress, 'done', g.done_at is not null,
             'note', g.note, 'sort', g.sort,
             'at', extract(epoch from g.updated_at) * 1000
           ) order by g.sort, g.created_at)
      from public.chronicle_goals g where g.owner = auth.uid()
  ), '[]'::jsonb);
end $$;

create or replace function public.chronicle_goal_progress(p_id uuid, p_progress numeric, p_done boolean)
returns void language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.chronicle_goals
     set progress = greatest(0, least(coalesce(p_progress, progress), 1e9)),
         done_at = case when p_done then coalesce(done_at, now()) else null end,
         updated_at = now()
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such goal'; end if;
end $$;

create or replace function public.chronicle_goal_drop(p_id uuid)
returns void language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.chronicle_goals where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such goal'; end if;
end $$;

revoke all on function public.chronicle_goal_save(uuid,text,text,date,int,numeric,text,text,int) from public, anon;
revoke all on function public.chronicle_goals_mine() from public, anon;
revoke all on function public.chronicle_goal_progress(uuid,numeric,boolean) from public, anon;
revoke all on function public.chronicle_goal_drop(uuid) from public, anon;
grant execute on function public.chronicle_goal_save(uuid,text,text,date,int,numeric,text,text,int) to authenticated;
grant execute on function public.chronicle_goals_mine() to authenticated;
grant execute on function public.chronicle_goal_progress(uuid,numeric,boolean) to authenticated;
grant execute on function public.chronicle_goal_drop(uuid) to authenticated;
```

---

## 6 · Step 2 — ✅ APPLIED, and two things the probe changed

**Migrations `chronicle_record`, `chronicle_record_rpcs`, `chronicle_timer_uses_wall_clock`,
`chronicle_mispress_threshold`.** Client: `src/chronicle/record.ts`, `src/chronicle/Timer.tsx`.

⚠️ **THE RUNNING TIMER IS THE OPEN ENTRY**, not a piece of client state — that is what lets it
survive a closed tab and turn up on a phone. So "one timer at a time" is a database invariant
rather than a client convention:

```sql
create unique index chronicle_one_running
  on public.chronicle_entries (owner) where ended_at is null;
```

Proven by direct insert: a second open row raises `unique_violation`, and a closed row alongside it
is still fine, so the index is not too broad. Two devices pressing start at the same moment cannot
produce two answers to "what am I doing right now".

⚠️ **`now()` WAS THE WRONG CLOCK, and a probe found it.** `now()` is the TRANSACTION's start time
and does not advance while a transaction runs — so two timer calls batched into one transaction
stamp a start and an end identically, the span check refuses the zero length, and the entry is
silently discarded. Expected three spans, got two. A single RPC call per transaction, which is how
the client sends these, cannot tell the two functions apart; that is exactly why it was worth
fixing, because a behaviour that depends on how calls happen to be grouped is one that breaks the
first time anything batches them. Everything timing-related now uses `clock_timestamp()`.

⚠️ **AND THAT EXPOSED A SECOND THING I HAD FUDGED.** With `now()`, "zero length" and "abandoned"
happened to be the same row, so leaning on timestamp equality worked by accident. With a real
clock an instant switch is a few microseconds long, passes the span check, and lands in the log as
a 0-minute entry. So the rule is stated instead of implied: **a run under one second is a
mis-press and is discarded; anything longer is kept exactly as long as it was.** Verified both
ways round — switching twice leaves one span, and a session over a second keeps its real length.

### The shape

```
chronicle_activities (id, owner, name, cat in (locked|free|life), colour, archived_at)
chronicle_entries    (id, owner, activity, started_at, ended_at, note)
```

Both deny-all like the goals table: RLS on, zero policies, grants only to `postgres` and
`service_role`, reached through eight `SECURITY DEFINER` functions. Checked: no `chronicle_%`
function is callable by `anon`, and as `authenticated` a direct `select` on any of the three tables
is `permission denied for table`.

⚠️ **The pure half is where the real difficulty lives**, and it is not the timer. Attributing a
span to a day is exact arithmetic that goes quietly wrong: a session from 23:00 to 01:00 belongs to
two days, an hour each. `overlapMs` in `record.ts` answers it, and the test asserts the property
rather than an hour — the overlaps across any windows that tile a range sum to the span's length
inside that range, never twice and never none. Attributing to the start day was perturbed in and
turns it red.

### The one cost worth checking

```
chronicle_activities (id, owner, name, cat in (locked|free|life), colour, archived_at, …)
chronicle_entries    (id, owner, activity, started_at, ended_at, note, quality, …)
```

⚠️ **This is the only part with a volume question, and it is answerable now.** An entry row is on
the order of 120 bytes. Ten entries a day is 3,650 a year — about 440KB a person a year. Eight
people over five years is roughly 17MB against a 500MB free tier currently holding 26MB. It fits
with room to spare, and the thing to watch is not the row count but anyone logging a timer that
never stops; a `check (ended_at is null or ended_at > started_at)` and an index on
`(owner, started_at)` are the whole of it.

---

## 6b · Step 3 — ✅ APPLIED: goals that read the record

**Migrations `chronicle_goal_sources`, `chronicle_tally`, `chronicle_goal_save_takes_a_source`.**

A goal can now name **one activity, or one category, or neither** — neither being every goal that
existed before today, moved by hand. So `30 min drawing, daily` counts itself.

⚠️ **THE WINDOW IS WORKED OUT IN THE CLIENT AND SENT TO THE SERVER**, and this is the decision the
whole step turns on. Postgres's `date_trunc('week', …)` starts a week on **Monday**; this site
starts it on **Sunday**, because the Circuit's calendar does and `goal.ts` matches it. A tally that
computed its own windows would put a second, disagreeing answer to "which days are this week" one
layer below the first, and they would differ for one day in seven forever. `chronicle_tally` takes
ranges and does only arithmetic it cannot have an opinion about.

⚠️ **BUT WHAT TO COUNT IS READ FROM THE GOAL'S OWN ROW, NEVER FROM THE REQUEST.** A caller able to
name an activity is a caller able to name somebody else's. Proven: passing a different activity id
in the request changes the answer not at all.

⚠️ **AND THE OVERLAP SUM NOW EXISTS TWICE** — `overlapMs` in `record.ts` and the `least/greatest`
sum inside `chronicle_tally`. That is a real duplication, taken knowingly: the alternative is
sending a year of entries to the client to add up one number for a yearly goal. What makes it safe
is that the probe asserts the two agree where it matters — a span crossing midnight gives 150
minutes to today and 60 to yesterday, summing to exactly the 210 that was logged.

**Three constraints keep the shape honest**, all proven to refuse: at most one source, a source
requires a target (a derived tick-box would tick itself the moment you did a minute of anything),
and an activity that is not yours is dropped to null rather than stored. `on delete set null` on
the activity reference, so tidying an activity list turns a goal back into a hand-moved one rather
than deleting the intention.

⚠️ **AND THE ONE MISTAKE WORTH RECORDING**: the columns were added in a migration with no way to
set them. `chronicle_goal_save` still took nine arguments, so nothing could aim a goal at anything
— found because the deny-all refused my probe's direct `update`, which was the table telling me
the door was missing. Fixed by **dropping and recreating** the function rather than replacing it:
`create or replace` with two more parameters makes an _overload_, leaving the nine-argument version
alive beside it, and two functions of one name with different ideas of what a goal is is worse
than a migration that has to be ordered.

The client side refuses to lie while the tally is in flight: a derived goal's `progress` column is
never written, so `reached()` returns **zero** rather than that column when the tally is missing.
A stale number wearing the authority of a reading is the failure that would have survived review,
because the fallback reads as defensive. It is perturbed in and turns a test red.

## 6c · Step 4 — ✅ time on the site, recorded without being asked

**Migrations `chronicle_auto_visits`, `chronicle_visit_reads_the_clock_once`.** Client:
`src/chronicle/useVisits.ts`, called once from `App.tsx` where the room is known.

Asked for as _"the online/offline time of when i am logged in viewing the site and maybe even over
time what module i am in and at what times"_. Those are one thing: the time you were online **is**
the union of the time you were in rooms, so recording the rooms gives both and nothing has to be
reconciled with anything.

⚠️ **THEY ARE ORDINARY ACTIVITIES**, flagged `auto`, one per room. That means the whole machine
already works on them — the day's log lists them, the category totals include them, and a goal can
point at "my time in Paint" exactly as it points at "Drawing". A separate table would have needed
its own log, its own totals and its own tally.

⚠️ **AND A VISIT NEVER OPENS AN ENTRY, which is the collision this design exists to avoid.**
`chronicle_one_running` allows exactly one entry with no end per person, and that one **is** the
hand-started timer. A visit that opened a row would fight it for the slot, so pressing Start on
Drawing would either fail or silently close the visit. A visit is a **finished** span that each
heartbeat extends. Proven: with a hand timer running, a visit still leaves exactly one open row.

**The rules, each proven to hold:**

- Nothing shorter than thirty seconds is recorded — tabbing through five rooms looking for one
  writes nothing. Measured in the browser: three hops of under a second reported nothing at all,
  then sitting in one room for 34 seconds reported `Games:34`.
- A duration is clamped to ten minutes, so a sleeping or lying client cannot claim an afternoon.
  Exactly `00:10:00`, which took a second fix — see below.
- A heartbeat every two minutes inside a three-minute extend window, so one slow beat cannot split
  a sitting into two rows.
- **Hidden is not viewing.** The clock stops when the tab goes away and reports what accrued;
  `pagehide` as well as `visibilitychange`, because a phone putting the browser away does not fire
  `beforeunload`.
- Signed out writes nothing: measured zero calls across room changes with no session.

⚠️ **AND THE CLOCK MUST BE READ ONCE.** The first version called `clock_timestamp()` twice in one
insert — once for the start, once for the end — which are two instants a few microseconds apart, so
a span clamped to "ten minutes" came out fractionally longer. Found by asserting the clamp and
watching it fail by microseconds. The same mistake as the `now()` one in kind: a single logical
moment read more than once stops being single, and a bound that is only nearly true is one somebody
will eventually compare against and disbelieve.

### ⚠️ And the gap in steps 1–3 closed itself

Every write I attempted in the Browser pane returned `401`, because the harness has no Supabase
session — so the join between `supabase-js` and these functions was the one thing I could only
infer. On 12 Oct, while this was being built, Evan signed in and used the room: an activity
("Claude maxing", Locked In) and a goal ("Make my website better") are in the tables, written
through `chronicle_activity_save` and `chronicle_goal_save` by a real browser with a real token.

⚠️ **Those two rows are HIS and must never be cleaned up.** I found them while checking for probe
residue and nearly treated them as mine; the only reason I did not is that I read them first.

What that leaves untested is the **timer**: `chronicle_entries` is still empty, so Start/Stop has
not been exercised by a real session.

## 6d · ✅ Looking back — the biggest hole, closed

**Migration `chronicle_minutes_one_home`.** Client: `src/chronicle/Looking.tsx`.

Chronicle recorded a life and could not show it back: the log listed today and nothing summed a
week, a month or a year, which for a thing asked for as an all-time tracking tool is most of the
point missing. The windows already existed — the plan half has used them since step 1 — so looking
back is the same windows pointed at the record instead of at the intentions.

⚠️ **AND THE OVERLAP RULE WAS ABOUT TO EXIST THREE TIMES.** It was in `record.ts` (TypeScript,
tested) and inside `chronicle_tally` (SQL) — a duplication taken knowingly, because the alternative
is shipping a year of entries to a browser. A totals function would have written it a third time,
and three copies is how a day's figure comes to depend on which panel you read it from. So the SQL
side now has **one** function, `chronicle_minutes`, and both callers ask it: `chronicle_tally` was
rewritten to use it and the old probe re-run to prove the answers did not move — 150, 20 and 60,
unchanged. The helper is revoked from `authenticated` entirely, reachable only from inside the two
`SECURITY DEFINER` functions above it, which a refused member call proves.

⚠️ **THE SAME THING HAPPENED IN TYPESCRIPT TEN MINUTES LATER.** `localMidnight` — build a local date
rather than parse one — was written separately in `record.ts`, `goal.ts` and the new panel, and in
the third copy I wrote a comment pointing out that it was the third copy instead of fixing it. It
now lives once, in `record.ts`, the leaf nothing else in chronicle imports from.

Totals come back one row per activity, busiest first, including the ones with nothing in the range
— a list that silently omits what you did not do is not a record of a week. Site-written rows are
marked "on the site", because "Paint 4h" meaning the room was open is a different claim from having
painted for four hours.

Shown only for windows longer than a day: Today and Tomorrow already have the Timer's own log,
entry by entry with times, which is strictly more than a total. Not shown for Years, which has no
window — all-time is a different question and the range cap is 400 days, so pretending would mean
showing a year and calling it everything.

## 6e · ✅ Routines — the last named feature the HTML app had

**Migration `chronicle_routines`.** Client: `src/chronicle/Routines.tsx`.

A morning you run through, a shutdown list, the three things you always do before drawing.

⚠️ **ONE ROW WITH A JSONB LIST, NOT A SECOND TABLE OF STEPS.** A routine is edited as a whole — you
reorder it, drop a step, add one — so a steps table would mean an ordering column, an RPC to move a
step up, and two writes that can half-succeed. The house pattern for a small document edited whole
is already jsonb: `member_library` and `park_maps` both do it.

⚠️ **AND THERE IS NO "RUNNING ROUTINE"**, which is the HTML app's `activeRoutine` deliberately left
out. The useful 80% of a routine is a saved list you tap down in order, and the timer already knows
what is running — a second idea of "where am I in the routine" would be a second answer to that,
kept in step by hope. **Which step you are up to is derived**: the first one with fewer minutes
against it today than it asked for. So a routine resumes itself after a reload, after a day, and on
another device, with nothing stored about where you were.

⚠️ **A STEP IS A SUGGESTION, NOT A LIMIT.** "10m" says how long you meant it to take; nothing stops
it or nags. A routine that enforced its own timings would be a schedule, which is a different thing
from a list and a much easier thing to abandon.

Ten probes, all rolled back. The one that matters: **a step naming somebody else's activity is
dropped rather than stored**, because a routine is a list of ids a request can type, and a tap on
such a step would try to start it. Also proven: the steps keep their order, minutes clamp at 600,
junk minutes become null rather than breaking the row, a non-list is refused, a blank or duplicate
name is refused, an edit keeps the id and may empty the list, and another member can neither read
nor delete one.

## 6f · ✅ Metrics — a thing to count besides time

**Migrations `chronicle_metrics`, `chronicle_metric_write_paths`.**

The HTML app's `metricLabel` / `metricGoalTarget` on an activity and `metricValues` on an entry.
Pages, reps, miles, words. **Time is the only universal measure and a poor one for anything whose
point is a quantity** — half an hour of writing is not the achievement, four pages is.

An activity may name one metric. A session may record an amount of it. And a goal with one activity
as its source may count **either** the minutes or the metric, which is what makes "100 pages this
month" sayable where before only "100 minutes" was.

⚠️ **MINUTES SPLIT ACROSS MIDNIGHT; AN AMOUNT DOES NOT.** This is the one place the two behave
differently and it is written beside both. A session from 23:00 to 01:00 gives an hour to each day
because time genuinely elapsed in both. Five pages written across midnight are not two and a half
pages each side — the quantity is indivisible, so it counts against the day the session **started**.
Proven: minutes 120 today, amount 4 today and the whole 10 yesterday, summing to the 14 written.

⚠️ **COUNTING AN AMOUNT NEEDS ONE ACTIVITY, NOT A CATEGORY.** A category's activities have different
metrics, and adding pages to reps to miles gives a number with no unit. A check constraint refuses
the pair and `chronicle_goal_save` corrects it to minutes rather than raising — the goal is still a
goal, it just measures time. The picker never offers the combination.

⚠️ **AND THE AMOUNT GOT ITS OWN FUNCTION** rather than a parameter on stop, add and edit. Those
three would each have needed a new signature — three drops and recreates, since an extra parameter
makes `create or replace` build an overload — and an amount is something you remember afterwards at
least as often as at the time. `chronicle_entry_amount` is one door, usable whenever.

`chronicle_minutes` became `chronicle_sum`, because the right function with a name that says
"minutes" would have started lying the moment it summed pages. Still one home for the rule.

Ten probes. The first one returned a single `<NULL>` because a subquery in my own probe found no
row and `||` nulled the whole message — the probe's bug, not the product's, fixed with `coalesce`.

## 6g · ✅ Streaks, and the two bugs that finding them required

Streaks were the plan for this step: a run of windows behind a repeating goal, which the HTML app
had no concept of. They took twenty minutes. The rest of the step was the reason they could not be
seen, and the live bug that was hiding behind the same blind spot.

### The streak itself

`streakAsks` asks about `STREAK_BACK = 30` windows per repeating derived goal; `streakOf` counts
the run. Two rules worth keeping written down:

- **The window you are in cannot break a streak.** A five-day run at nine in the morning on the
  sixth day is still five — today is unfinished, not failed. Counting it as a miss would make every
  streak read zero every morning, which is the opposite of what a streak is for.
- **Thirty windows back is thirty calendar steps, not thirty day-lengths.** A month back from 31
  March is not 31 days and a year back across a leap day is not 365; `setMonth`/`setDate` are the
  only arithmetic that knows that.

The chip appears from **two** in a row. A streak of one is just "done", and a badge that shows up
the first time you do anything teaches nobody that it means anything.

### ⚠️ The room could not be seen at all, and a whole tick was spent not noticing

Chronicle keeps **no local copy** — §6's decision, and the right one. The consequence nobody wrote
down: `dev/previewMember.ts` flips the UI gates but **never creates a Supabase session**, so in the
preview every chronicle RPC answers nothing and the room renders its empty state and only its
empty state.

So the streak chip was "verified" on the strength of the module exporting the function that makes
it, and a 375px audit of the room reported **0 undersized, 0 off-edge, 0 clipped** — against a room
containing a paragraph and two buttons. `scripts/mobile-audit.js` has a warning at the top of the
file about exactly that reading. It is the same shape as `.park-field` always being rendered: the
room being there does not mean anything is in it.

**`src/dev/chroniclePreview.ts`** is the fix, and it is the analogue of `#dev-park` one room over.
It is careful about what it claims:

- **What it proves**: the room renders. Every state a goal and an entry can be in, at every
  viewport, with the editors drivable and the empty states reachable.
- **What it cannot prove**: any number. The sums are the _browser's_ arithmetic, so a figure that
  looks right there says nothing about what `chronicle_minutes` returns for the same window. That
  question already has two homes and neither is that file — vitest over `goal.ts`/`record.ts`, and
  a simulated session in SQL.
- The seed is **chosen to light up every branch**, not to look like a plausible week: a goal at
  zero, one part way, one exactly met, one past its target, a tick ticked and one not, a hand-moved
  number, a goal on a category, a goal counting an amount, an archived activity, an auto one, a
  span across midnight, and a timer running now.
- **The drawing days have a hole in them** — 0, 1, 2, 3 then 5, 6. So the streak is **four** while
  six windows that week were met, which is the one seed shape that can tell a run from a count.
  Seven unbroken days agrees with both and distinguishes neither.
- It borrows `overlapMs` rather than writing a second opinion about what a span is worth. An
  unfaithful double looks exactly like a product bug.

### ⚠️ And then the room showed a live bug on its first load

`30 minutes drawing` read **0 / 30** with `Drawing 35m` in the day's totals two inches above it.
Every repeating derived goal on the site did, and had since they existed.

One load asks about a repeating goal **twice** — today's window for the Today list, tomorrow's for
the Tomorrow list, because the window strip has to count unfinished work in both. The asks were
keyed by **goal id**, so both answers were the same entry, `jsonb_object_agg` kept the last, and
tomorrow's window — zero every time, because tomorrow has not happened — overwrote the reading.

It is the **same mistake as `chronicle_tally`'s own**, found the day before and fixed one layer
down so a streak could ask about thirty windows. The caller that had been colliding all along was
never looked at, because the room it renders in could not be seen without a session.

The fix is `windowKey(id, fromISO)`: say which window you are asking about, and read the answer to
that question rather than to the goal. `reached`, `share` and `finished` now take the day as a
**required** argument — four callers, each of which already had it in hand. A default of "today"
would have let the Tomorrow view keep asking a question it cannot name and keep getting a number
with a plausible shape.

Three perturbations, each red for its own reason:

| perturbation                                              | result                                     |
| --------------------------------------------------------- | ------------------------------------------ |
| `tallyAsks` keys by goal id                               | 3 red — asker and reader disagree          |
| `reached` reads `tally[g.id]`                             | 3 red — same, from the other side          |
| key coarsened to the year, so only today/tomorrow collide | **1 red**, the duplicate-window test alone |

The third is the one that matters: it proves the test is sensitive to the actual collision rather
than to a changed string, and the one-off test stayed green because a one-off does not collide.

On screen afterwards, from one `got` map: `30 minutes drawing` reads **35 / 30 in Today** and
**0 / 30 in Tomorrow**, and the Today badge fell from 3 to 1.

### ⚠️ And the harness was shipping to real users

Measured, not assumed: `grep` the built bundle for a string only that file contains. The whole
seed was in `index.js` as unreachable dead weight — 2.78 kB — while `dev/previewMember.ts`, which
makes the same DEV-only claim, does not leak at all.

The difference is not the `import.meta.env.DEV` guard and not the namespace import, both of which
were tried and measured as making no difference (identical bundle hash). It is `let S = seed()`: a
**statement-level call at module scope**, which rollup cannot prove pure, so it keeps the module
for its side effect. `previewMember.ts` is all plain literals assigned to exports nobody reaches.
Behind a function — `const db = () => (S ??= …)` — there is nothing to run at import time and the
module drops out entirely. 375.22 kB → 372.44 kB.

**A DEV-only comment is a claim about the bundle, and the bundle is greppable.** Worth doing for
any future harness here.

### What this leaves

- `dev/chroniclePreview.ts` is now the way to look at chronicle. `window.__chron.empty()` and
  `.seed()` switch between the full room and a first visit; both reload, because the room reads
  its data once on mount.
- Verified at 375, 820 and 1440: 49 controls examined, none under 36px, nothing off-edge, clipped
  or scrolling sideways. The write path is drivable end to end — a real checkbox click moved a row
  to `is-done` and the Today badge to zero unfinished.
- Still only reachable with a session: the production path on :4173, which has no harness because
  the harness is DEV-only. Unchanged, and the reason the empty states are worth a trip there.

## 6h · ✅ The sweep — six features looked at for the first time

§6g built the harness. This is what it found when the six features that had shipped against an
unobservable room were finally driven. Four of eleven paths were broken, and three of the four were
things no amount of reading would have shown, because each was correct in the code and wrong on
the screen.

| path                                              | verdict                            |
| ------------------------------------------------- | ---------------------------------- |
| Day stepper (`‹ ›`, "Yesterday", "back to today") | ✅                                 |
| **An amount on a session that crosses midnight**  | 🐛 shown on both days              |
| **Deleting a straddling session**                 | 🐛 the confirmation understated it |
| Entry editor — both ends and the metric           | ✅ and it propagates to the goal   |
| **Fill a gap, with a timer running**              | 🐛 a dead end                      |
| **Fill a gap, the two datetime fields**           | 🐛 opened empty                    |
| Routines fold — run, edit, "2 of 3"               | ✅                                 |
| Activities fold — metric, time today, archive     | ✅                                 |
| Looking back — week / month / quarter / year      | ✅                                 |
| Goal form, source picker, counts picker           | ✅                                 |
| 375px audit of the populated room                 | ✅ 43 controls, nothing under 36px |

### ⚠️ A quantity does not split at midnight, and the day list split it anyway

One session of Writing, 23:00 to 00:30, four pages. The day list showed `1h · 4 pages` on the ninth
and `30m · 4 pages` on the tenth. The **minutes were right both times** — that is what `overlapMs`
is for, and the hour and the half-hour are both real. The pages were not: five pages written across
midnight are not two and a half pages each side, so the quantity belongs to the **session**, and
counts once, against the day it started.

`chronicle_sum` and `chronicle_totals` have had that rule since the column existed. The entry row
asked only whether `e.amount` was non-null. **A rule enforced in two places out of three is a rule
the third place contradicts** — so anybody reading two days counted eight pages from a session that
produced four, and the list disagreed with the totals beside it and with every goal counting that
metric.

`amountIn(e, fromMs, toMs)` now lives next to `overlapMs`, deliberately adjacent, because the two
rules can only be read as a pair. The test sweeps a **tiling** rather than two fixtures, the same
shape as the overlap test above it: over any set of windows that tile the range, the minutes sum to
the session's length and the quantity appears exactly once. Two hand-picked days would agree with a
rule saying "the first day wins" and with one saying "whichever day I happened to open".

Perturbed back to the shipped behaviour — the amount shown whenever the session touches the day —
two tests go red, including the running-session one.

### ⚠️ And the confirmation for deleting it was answering a different question

The day list shows a straddling session's **overlap** with the day you are on, so the prompt read
`Delete the 30m of Writing?` and then removed all ninety minutes, including the hour sitting on
yesterday's screen. A confirmation that understates what it does is worse than none: it is the one
moment somebody is deciding. It now names the whole span and says how much of it is here, with a
minute of slack so a session that pokes a few seconds past midnight does not get a sentence about
nothing.

### ⚠️ Fill a gap was a dead end whenever a timer was running

The form's button read `Add to the picked activity`, took the activity from the **top picker** — and
while a timer runs the top picker is not there, because it is replaced by the name of what you are
doing. So the button could not say which activity it meant, and pressing it answered
`pick an activity first`: an instruction you cannot follow, because the room has removed the means.
Same shape as `.park-field`, one layer up — **when a thing does not happen, check that the room is
letting you ask.**

A form that needs a thing has to carry the control for it, so the gap has its own activity select
now, defaulting to the picked activity, else what is running, else the first unarchived one — never
blank, because a select nobody notices is the dead end again.

### ⚠️ And it opened completely empty, which is four typed fields on a phone

Repairing the commonest hole in any log — "I did that and forgot to press Start" — meant typing two
full datetimes on a touch keyboard. It opens filled in now, from the two halves of what a gap
actually is:

- **the end** is now, when you are looking at today, because that is when you noticed. On a past day
  there is no "now" in it, so it is that day's last session, or midday if the day is bare.
- **the start** is the end of the last session before that — the gap _is_ the unlogged stretch — and
  an hour back when there is nothing to butt against.

Both clamped into the day on screen. Observed: today at 00:42 opens `00:00 → 00:42`; a past day with
sessions opens `09:31 → 14:50`, which is exactly the unlogged stretch between two of them; a bare
day opens `11:00 → 12:00`.

Two of my own mistakes in that one function, both caught before pushing and worth recording because
neither is specific to this room:

- **`Math.max(...ends, -Infinity)` returns `-Infinity` for an empty day, and `-Infinity` is
  truthy** — so a `||` fallback behind it never fires, and `new Date(-Infinity).toISOString()`
  **throws**. An empty past day would have opened the form by crashing the room. `ends.length ? …`
  instead.
- **`from < to` is not a guard against a degenerate span.** Four seconds satisfies it, and when the
  last session ended moments ago that is what came out — the form opened with both ends reading
  `00:41`. The rule needs a minimum length, not a direction.

### A note on the fixture itself

The seed placed today's sessions at fixed hours, and "today at 19:00" is in the **future** for most
of the day — which is not a product bug but reads as several, including making the gap defaults look
wrong. Today's sessions are pulled back to fit before now. The honest trade is that read in the
small hours today is cramped: at 00:41 there are only forty-one minutes for it to have happened in,
so sessions pile up against midnight and overlap. Everything still falls on the right day, which is
what the streaks and tallies need; anything being judged on how a _normal_ day lays out wants
reading later, or on one of the earlier days, which sit at their stated hours.

## 6i · ✅ Planned — intention against record

**Migrations `chronicle_plans` and `chronicle_plan_rpcs`, both applied 13 Oct 2026 — reasoning in
`docs/2026-10-13-chronicle-plans.sql`.** Client: `src/chronicle/plan.ts`,
`src/chronicle/Plans.tsx`, mounted in the Timer's day.

The HTML app's `planned` store, and the biggest remaining item on the parity list. §1 called it out:
"looking ahead" in the HTML app is `planned` plus a date on a task, with no notion of a horizon. The
horizons were the thing to build and they are built — this is the other half, and the two are
different questions. **A goal says what you are aiming at over a window; a plan says where in
tomorrow it goes.**

### A plan is never work done

That is the one thing this must not get wrong, and it is enforced a layer below the UI: a separate
table, not a `planned` flag on `chronicle_entries`. The flag is the smaller diff and the wrong
answer — it would need `where not planned` adding to five live functions, and forgetting it in **one**
of them means an intention counts as time spent. Goals filling themselves in from what somebody
_meant_ to do is the worst available failure. A separate table cannot be read by accident by
anything that already exists.

### The comparison, which is the "and more"

`against(plans, entries, …)` gives one row per activity **appearing in either list**, and that is the
whole claim:

```
Writing    1h 30m  →  not yet
Drawing    1h      →  35m
Gym        unplanned → 45m
Dishes     unplanned → 12m
```

⚠️ **There are two opposite ways a day misses its plan**, and the easy one to leave out is the
second. Walking the plans and looking up each one's actual minutes is the natural way to write this,
and it can only ever report things planned-and-skipped — so an afternoon that vanished into
something nobody planned comes back from that version reporting a day that went exactly to plan.
The test is named for that failure and the plans-only implementation turns it red.

⚠️ **Both columns go through `overlapMs`.** A plan from 23:00 to 01:00 is an hour of each day exactly
as the session would be, because it is the same arithmetic asked twice — so the two columns cannot
drift and report one evening as planned-but-not-done on Monday and done-but-unplanned on Tuesday.
`overlapMs` was widened to take `Span = { start, end }` rather than an `Entry`, which is what it had
always read.

⚠️ **A plan in the future still counts as planned.** Three hours blocked out for this evening reads
`planned 3h · did 0` at breakfast — a forecast, not a failure. Anything else would mean the readout
only became true at midnight, which is far too late for the one thing it is for.

### Decisions worth keeping written down

- **`✓` on a plan writes the entry and keeps the plan.** `chronicle_plan_did` calls
  `chronicle_entry_add` rather than inserting itself, so the span check, the day ceiling and the
  activity-is-mine check stay in one place. And the plan survives, or the comparison would read
  "planned nothing, did an hour" the moment you agreed with yourself.
- **`chronicle_plans_between` is ascending**, unlike `chronicle_entries_between`. A log is read
  backwards and a plan is read forwards.
- **It is a fold, and it opens itself** when the day on screen has plans and nothing done against
  them — which is the start of a day you have already decided about, and the one moment it is the
  most useful thing in the room. Verified: shut on today (work already logged against the plans),
  open on Tomorrow.
- **Every day, not just today**, unlike Routines — the day planning is most wanted for is tomorrow,
  and the stepper already goes there and already says "Tomorrow".
- **The adder opens on the next free hour**, after the last thing already planned for that day, or
  the next whole hour if nothing is, an hour long, never past midnight. The same lesson Fill a gap
  taught one commit ago.

### ⚠️ And a layout bug of my own, measured rather than eyeballed

The three new buttons on a plan row sat **45px past the list's right edge** — `scrollWidth 347` in a
`clientWidth 302` track. Worth recording precisely, because the instinct ("add `overflow: hidden`")
is wrong: **a grid item whose min-content exceeds its track does not shrink, it overflows**, and
clipping it would leave an unreachable button, which is worse than a second line. Two real fixes:

- The row **wraps** rather than overflows. Wrapping degrades; overflow breaks.
- The time label says the meridiem **once** — `7:00–7:45 AM`, not `7:00 AM–7:45 AM`. That was 112px
  of a 302px row before the activity or any button got a say, and it reads better. A plan row cannot
  answer crowding by hiding its time the way a log entry does, because for a plan the time _is_ the
  content.

Afterwards: row 302 = list 302, no overflow, buttons inside the card, 42 controls examined at 375
with none under 36px and nothing off-edge or clipped. Clean at 820 and 1440 too.

One smaller note: the meridiem-stripping regex matches \*\*`\p{L}+# Chronicle — a design, before any of it is built

**Status: ✅ STEPS 1–4 APPLIED plus looking back, editing and routines, 12–13 Oct 2026.** Migrations `chronicle_goals`, `chronicle_goal_rpcs` and
`chronicle_goal_window_excludes_life`. The client half is in `src/chronicle/` and
`src/sections/Chronicle.tsx`. Steps 2–5 in §4 are not started.

⚠️ **AND THE CONSTRAINT IN §5 WAS WRONG WHEN IT WAS WRITTEN, which a probe found and reading would
not have.** `chronicle_goal_window` has three clauses — "life has no window", "a repeating goal has
no single anchor", "a one-off has one" — and the third did not exclude `life`. So a lifetime goal
carrying a date satisfied the clause written to catch one-offs and sailed straight past the clause
written to stop it. Found by inserting the four rows the table is supposed to refuse and reading
which ones it took: three refused, `life` with an anchor accepted. Fixed by adding
`scope <> 'life'` to the two non-life clauses; the SQL below is the corrected version, and the
whole probe was wrapped in a `raise` so it rolled back and left the table empty.

**What else was proven rather than assumed**, all of it rolled back:

- As `authenticated`, a direct `select` on `chronicle_goals` is `permission denied for table` —
  the table is unreachable except through the four functions.
- From the browser with no session, `chronicle_goal_save` returns `401 permission denied for
function`, so `anon` cannot execute it.
- Impersonating a member: both goals come back, the title and unit are trimmed, `progress` reads
  as a number, the repeating goal keeps `every = 1` with no anchor, and a bogus scope is refused.
- **Impersonating a different member holding a valid goal id**: cannot move it, cannot delete it,
  and their own list comes back empty.

Asked for in these words: _"i want to make a chronicle module - but more than that i want to make a
goal tracker/to do list (similar concept to how i have the circuit goal of 100 points but it doesnt
have to be points just planning goal oriented, and i can imagine the circuit and checklist working
on top of chronicle) to facilitate looking ahead today/tomorrow/daily/weekly/monthly/yearly/years.
we had made an html chronicle app that was about 60% done in my eyes so i want to remake the app as
an all time tracking tool on my website."_

Source: `time_journal_12.html`, 3,476 lines, 224KB, one file, `localStorage` under `chr7_`.

---

## 1 · What the HTML app already is

Read rather than guessed at. Seven panels — dash, routines, log, cal, goals, money, lib — over nine
stores:

| Store                                  | Shape                                                                                                | What it is                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------- |
| `A` activity                           | `{name, cat: locked\|free\|life, color, goal, dailyGoal, sessionGoal, metrics[], metricGoalTarget…}` | a thing you spend time on   |
| `E` entry                              | `{name, cat, ai, start, end, note, quality, metricValues}`                                           | a finished span of time     |
| `AS`                                   | the same, with no `end`                                                                              | the timer that is running   |
| `TD` todo                              | `{name, est, due, priority, done}`                                                                   | a flat task list            |
| `planned`                              | `{name, cat, ai, start, end}`                                                                        | a future span on a calendar |
| `EV`, `routines`, `alarms`, `MA/MT/BH` | events, routines, alarms, money                                                                      |

**The heart of it is a timer over categorised activities**, and the categories are the good idea:
`locked` (committed), `free` (yours), `life` (upkeep). Activities already carry three kinds of goal
— total, per-day, per-session — plus arbitrary named metrics with targets.

⚠️ **The 40% that is missing is precisely what was asked for.** "Looking ahead" in the HTML app is
`planned` (a block on a calendar) and `TD.due` (a date on a task). There is no notion of a horizon:
nothing expresses "weekly", "this year", or "over the next few years", and nothing can be asked
"what am I aiming at this month". That is the thing to build, and it is not a port.

---

## 2 · Three decisions, taken 12 Oct 2026

1. **Its own Supabase tables**, following the house pattern — RLS on, zero policies, no grants,
   reached only through `SECURITY DEFINER` RPCs that check `auth.uid()`. This is a record of
   somebody's life: it has to survive a cleared browser and follow them between phone and desktop,
   and a time series is the wrong shape for `member_library`, which is a 400-item document store.
2. **Money stays out.** Investments already exists, is backed by Supabase and holds the real
   accounts. Porting the HTML ledger would make two homes for one thing, which §5 of CLAUDE.md names
   as the bug class behind "the song plays but the editor says it's empty". Chronicle links across.
3. **Chronicle and the Circuit stay separate for now, sharing one vocabulary of a goal.** The
   Circuit works, has an adapter and 707 logs in it. Its "100 points" must be _expressible_ in
   chronicle's model from day one — but rebuilding a module eight people use on top of an unproven
   substrate is a trade to make after chronicle has earned it, not before.

---

## 3 · The model, and the one idea it turns on

The list in the ask — _today / tomorrow / daily / weekly / monthly / yearly / years_ — is three
different things wearing one coat, and conflating them is how an app like this becomes confusing:

- **a date**: today, tomorrow
- **a rhythm**: daily, weekly, monthly, yearly
- **a scale**: years

⚠️ **So a goal carries a SCOPE — the window it is judged over — and optionally a REPEAT.** That one
move covers the whole list with no special cases:

| What you say                  | scope   | anchor     | repeat | target |
| ----------------------------- | ------- | ---------- | ------ | ------ |
| "today: finish the doc"       | `day`   | 2026-10-12 | —      | —      |
| "tomorrow: call the dentist"  | `day`   | 2026-10-13 | —      | —      |
| "daily: 30 min drawing"       | `day`   | —          | 1      | 30 min |
| "weekly: ship something"      | `week`  | —          | 1      | —      |
| "this month: four map pieces" | `month` | 2026-10-01 | —      | 4      |
| "this year: 100 points"       | `year`  | 2026-01-01 | —      | 100    |
| "learn to animate"            | `life`  | —          | —      | —      |

**Looking ahead is then one question**: _which goals have a window overlapping this range_. Today,
Tomorrow, This week, This month, This year and Years are the same list with a different range — which
is the whole reason the window lives on the goal rather than in the view.

⚠️ **A target is optional, which is what makes it "not necessarily points".** No target is a
tick-box. A target plus a unit is a quantity — `100 points`, `30 min`, `12 books`, `3 maps` — and
the Circuit's hundred points is then simply `scope: year, target: 100, unit: points`, expressible
without the Circuit having to change at all.

⚠️ **AND PROGRESS HAS TWO SOURCES, WHICH IS WHY CHRONICLE SITS UNDERNEATH.** Either you say so
(tick it, add to the count), or it is **derived from the record** — minutes logged against an
activity, rolled up over the goal's window. The second is the reason this is one module rather than
two: a goal that reads the time you actually spent is the thing a to-do list cannot do.

---

## 4 · What gets built, in order, each step worth having alone

1. **Goals and horizons.** The table in §5, the RPCs, a `#chronicle` room with the six windows, and
   goals you can add, tick and count up by hand. No timer, no entries. Shippable alone and it is the
   half that was missing from the HTML app.
2. ~~**The record.**~~ ✅ APPLIED 12 Oct 2026 — see §6.
3. ~~**Derived progress.**~~ ✅ APPLIED 12 Oct 2026 — see §6b.
4. ✅ **Time on the site** — asked for on 12 Oct, applied the same day; see §6c. (Routines and
   intention-vs-actual move to step 6.)
5. **Only then**, the question of whether the Circuit wants to sit on this.

---

## 5 · Step 1 — the SQL, not yet applied

Copied from `member_library` and `park_maps` deliberately: zero policies, FK to
`profiles(user_id) on delete cascade`, every bound a check constraint, and **no grants to `anon` or
`authenticated`** — those two tables grant only `postgres` and `service_role`, which is the clean
version of the pattern. (`profile_notes` still carries leftover `anon`/`authenticated` grants it
cannot use; worth a separate tidy, not copied here.)

```sql
-- ── chronicle_goals ─────────────────────────────────────────────────────────────
create table if not exists public.chronicle_goals (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references public.profiles(user_id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  -- the window the goal is judged over
  scope       text not null check (scope in ('day','week','month','quarter','year','life')),
  -- the start of that window, normalised by the caller; null for a repeating goal or for 'life'
  anchor      date,
  -- repeats every N windows; null is a one-off
  repeat_every int check (repeat_every is null or repeat_every between 1 and 52),
  -- null target = a tick-box; a target needs a unit so the number means something
  target      numeric check (target is null or (target > 0 and target <= 1e9)),
  unit        text check (unit is null or char_length(btrim(unit)) between 1 and 16),
  progress    numeric not null default 0 check (progress >= 0 and progress <= 1e9),
  done_at     timestamptz,
  note        text check (note is null or char_length(note) <= 2000),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ⚠️ a target without a unit is a bare number nobody can read six months later
  constraint chronicle_goal_unit_with_target check ((target is null) = (unit is null)),
  -- ⚠️ a repeating goal has no single anchor, and a one-off outside 'life' needs one
  -- ⚠️ CORRECTED: the two non-life clauses must EXCLUDE life, or a lifetime goal carrying a
  -- date satisfies the third one and never reaches the first. See the status note at the top.
  constraint chronicle_goal_window check (
    (scope = 'life' and anchor is null and repeat_every is null)
    or (scope <> 'life' and repeat_every is not null and anchor is null)
    or (scope <> 'life' and repeat_every is null and anchor is not null)
  )
);

alter table public.chronicle_goals enable row level security;
revoke all on public.chronicle_goals from public, anon, authenticated;

create index if not exists chronicle_goals_owner_scope
  on public.chronicle_goals (owner, scope, anchor);
```

⚠️ **`revoke … from public, anon, authenticated`, not just `public`.** CLAUDE.md records why: `anon`
holds execute and select grants directly in this project, so a revoke aimed at `PUBLIC` leaves it
untouched. The standing check to run afterwards is in `docs/rpc-inventory.md`.

### The RPCs

Same shape as `library_put` / `library_list`, line for line: `SECURITY DEFINER`,
`SET search_path TO 'public','pg_temp'`, and `auth.uid()` checked on the first line.

```sql
-- ⚠️ A CEILING PER PERSON, enforced here and nowhere else — the same decision member_library
-- makes. 500 goals is a decade of a goal a week; the free tier is 500MB and 26MB is in use.
create or replace function public.chronicle_goal_save(
  p_id uuid, p_title text, p_scope text, p_anchor date,
  p_repeat int, p_target numeric, p_unit text, p_note text, p_sort int
) returns uuid language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare v_id uuid; v_count int;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_id is null then
    select count(*) into v_count from public.chronicle_goals where owner = auth.uid();
    if v_count >= 500 then raise exception 'that is 500 goals — finish or delete one'; end if;
    insert into public.chronicle_goals (owner, title, scope, anchor, repeat_every, target, unit, note, sort)
    values (auth.uid(), btrim(p_title), p_scope, p_anchor, p_repeat, p_target, nullif(btrim(coalesce(p_unit,'')),''), p_note, coalesce(p_sort,0))
    returning id into v_id;
  else
    update public.chronicle_goals
       set title = btrim(p_title), scope = p_scope, anchor = p_anchor, repeat_every = p_repeat,
           target = p_target, unit = nullif(btrim(coalesce(p_unit,'')),''), note = p_note,
           sort = coalesce(p_sort,0), updated_at = now()
     where id = p_id and owner = auth.uid()
    returning id into v_id;
    -- ⚠️ a row that is not yours and a row that does not exist return the same nothing
    if v_id is null then raise exception 'no such goal'; end if;
  end if;
  return v_id;
end $$;

-- ⚠️ ONE CALL FOR THE WHOLE BOARD rather than one per window. Six windows on screen is six
-- round trips if the view asks per window, and the rows are small — a person's entire goal list
-- is a few kilobytes. The client slices it by window; the server does not need to know the view.
create or replace function public.chronicle_goals_mine()
returns jsonb language plpgsql stable security definer
set search_path to 'public','pg_temp' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', g.id, 'title', g.title, 'scope', g.scope, 'anchor', g.anchor,
             'every', g.repeat_every, 'target', g.target, 'unit', g.unit,
             'progress', g.progress, 'done', g.done_at is not null,
             'note', g.note, 'sort', g.sort,
             'at', extract(epoch from g.updated_at) * 1000
           ) order by g.sort, g.created_at)
      from public.chronicle_goals g where g.owner = auth.uid()
  ), '[]'::jsonb);
end $$;

create or replace function public.chronicle_goal_progress(p_id uuid, p_progress numeric, p_done boolean)
returns void language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update public.chronicle_goals
     set progress = greatest(0, least(coalesce(p_progress, progress), 1e9)),
         done_at = case when p_done then coalesce(done_at, now()) else null end,
         updated_at = now()
   where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such goal'; end if;
end $$;

create or replace function public.chronicle_goal_drop(p_id uuid)
returns void language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.chronicle_goals where id = p_id and owner = auth.uid();
  if not found then raise exception 'no such goal'; end if;
end $$;

revoke all on function public.chronicle_goal_save(uuid,text,text,date,int,numeric,text,text,int) from public, anon;
revoke all on function public.chronicle_goals_mine() from public, anon;
revoke all on function public.chronicle_goal_progress(uuid,numeric,boolean) from public, anon;
revoke all on function public.chronicle_goal_drop(uuid) from public, anon;
grant execute on function public.chronicle_goal_save(uuid,text,text,date,int,numeric,text,text,int) to authenticated;
grant execute on function public.chronicle_goals_mine() to authenticated;
grant execute on function public.chronicle_goal_progress(uuid,numeric,boolean) to authenticated;
grant execute on function public.chronicle_goal_drop(uuid) to authenticated;
```

---

## 6 · Step 2 — ✅ APPLIED, and two things the probe changed

**Migrations `chronicle_record`, `chronicle_record_rpcs`, `chronicle_timer_uses_wall_clock`,
`chronicle_mispress_threshold`.** Client: `src/chronicle/record.ts`, `src/chronicle/Timer.tsx`.

⚠️ **THE RUNNING TIMER IS THE OPEN ENTRY**, not a piece of client state — that is what lets it
survive a closed tab and turn up on a phone. So "one timer at a time" is a database invariant
rather than a client convention:

```sql
create unique index chronicle_one_running
  on public.chronicle_entries (owner) where ended_at is null;
```

Proven by direct insert: a second open row raises `unique_violation`, and a closed row alongside it
is still fine, so the index is not too broad. Two devices pressing start at the same moment cannot
produce two answers to "what am I doing right now".

⚠️ **`now()` WAS THE WRONG CLOCK, and a probe found it.** `now()` is the TRANSACTION's start time
and does not advance while a transaction runs — so two timer calls batched into one transaction
stamp a start and an end identically, the span check refuses the zero length, and the entry is
silently discarded. Expected three spans, got two. A single RPC call per transaction, which is how
the client sends these, cannot tell the two functions apart; that is exactly why it was worth
fixing, because a behaviour that depends on how calls happen to be grouped is one that breaks the
first time anything batches them. Everything timing-related now uses `clock_timestamp()`.

⚠️ **AND THAT EXPOSED A SECOND THING I HAD FUDGED.** With `now()`, "zero length" and "abandoned"
happened to be the same row, so leaning on timestamp equality worked by accident. With a real
clock an instant switch is a few microseconds long, passes the span check, and lands in the log as
a 0-minute entry. So the rule is stated instead of implied: **a run under one second is a
mis-press and is discarded; anything longer is kept exactly as long as it was.** Verified both
ways round — switching twice leaves one span, and a session over a second keeps its real length.

### The shape

```
chronicle_activities (id, owner, name, cat in (locked|free|life), colour, archived_at)
chronicle_entries    (id, owner, activity, started_at, ended_at, note)
```

Both deny-all like the goals table: RLS on, zero policies, grants only to `postgres` and
`service_role`, reached through eight `SECURITY DEFINER` functions. Checked: no `chronicle_%`
function is callable by `anon`, and as `authenticated` a direct `select` on any of the three tables
is `permission denied for table`.

⚠️ **The pure half is where the real difficulty lives**, and it is not the timer. Attributing a
span to a day is exact arithmetic that goes quietly wrong: a session from 23:00 to 01:00 belongs to
two days, an hour each. `overlapMs` in `record.ts` answers it, and the test asserts the property
rather than an hour — the overlaps across any windows that tile a range sum to the span's length
inside that range, never twice and never none. Attributing to the start day was perturbed in and
turns it red.

### The one cost worth checking

```
chronicle_activities (id, owner, name, cat in (locked|free|life), colour, archived_at, …)
chronicle_entries    (id, owner, activity, started_at, ended_at, note, quality, …)
```

⚠️ **This is the only part with a volume question, and it is answerable now.** An entry row is on
the order of 120 bytes. Ten entries a day is 3,650 a year — about 440KB a person a year. Eight
people over five years is roughly 17MB against a 500MB free tier currently holding 26MB. It fits
with room to spare, and the thing to watch is not the row count but anyone logging a timer that
never stops; a `check (ended_at is null or ended_at > started_at)` and an index on
`(owner, started_at)` are the whole of it.

---

## 6b · Step 3 — ✅ APPLIED: goals that read the record

**Migrations `chronicle_goal_sources`, `chronicle_tally`, `chronicle_goal_save_takes_a_source`.**

A goal can now name **one activity, or one category, or neither** — neither being every goal that
existed before today, moved by hand. So `30 min drawing, daily` counts itself.

⚠️ **THE WINDOW IS WORKED OUT IN THE CLIENT AND SENT TO THE SERVER**, and this is the decision the
whole step turns on. Postgres's `date_trunc('week', …)` starts a week on **Monday**; this site
starts it on **Sunday**, because the Circuit's calendar does and `goal.ts` matches it. A tally that
computed its own windows would put a second, disagreeing answer to "which days are this week" one
layer below the first, and they would differ for one day in seven forever. `chronicle_tally` takes
ranges and does only arithmetic it cannot have an opinion about.

⚠️ **BUT WHAT TO COUNT IS READ FROM THE GOAL'S OWN ROW, NEVER FROM THE REQUEST.** A caller able to
name an activity is a caller able to name somebody else's. Proven: passing a different activity id
in the request changes the answer not at all.

⚠️ **AND THE OVERLAP SUM NOW EXISTS TWICE** — `overlapMs` in `record.ts` and the `least/greatest`
sum inside `chronicle_tally`. That is a real duplication, taken knowingly: the alternative is
sending a year of entries to the client to add up one number for a yearly goal. What makes it safe
is that the probe asserts the two agree where it matters — a span crossing midnight gives 150
minutes to today and 60 to yesterday, summing to exactly the 210 that was logged.

**Three constraints keep the shape honest**, all proven to refuse: at most one source, a source
requires a target (a derived tick-box would tick itself the moment you did a minute of anything),
and an activity that is not yours is dropped to null rather than stored. `on delete set null` on
the activity reference, so tidying an activity list turns a goal back into a hand-moved one rather
than deleting the intention.

⚠️ **AND THE ONE MISTAKE WORTH RECORDING**: the columns were added in a migration with no way to
set them. `chronicle_goal_save` still took nine arguments, so nothing could aim a goal at anything
— found because the deny-all refused my probe's direct `update`, which was the table telling me
the door was missing. Fixed by **dropping and recreating** the function rather than replacing it:
`create or replace` with two more parameters makes an _overload_, leaving the nine-argument version
alive beside it, and two functions of one name with different ideas of what a goal is is worse
than a migration that has to be ordered.

The client side refuses to lie while the tally is in flight: a derived goal's `progress` column is
never written, so `reached()` returns **zero** rather than that column when the tally is missing.
A stale number wearing the authority of a reading is the failure that would have survived review,
because the fallback reads as defensive. It is perturbed in and turns a test red.

## 6c · Step 4 — ✅ time on the site, recorded without being asked

**Migrations `chronicle_auto_visits`, `chronicle_visit_reads_the_clock_once`.** Client:
`src/chronicle/useVisits.ts`, called once from `App.tsx` where the room is known.

Asked for as _"the online/offline time of when i am logged in viewing the site and maybe even over
time what module i am in and at what times"_. Those are one thing: the time you were online **is**
the union of the time you were in rooms, so recording the rooms gives both and nothing has to be
reconciled with anything.

⚠️ **THEY ARE ORDINARY ACTIVITIES**, flagged `auto`, one per room. That means the whole machine
already works on them — the day's log lists them, the category totals include them, and a goal can
point at "my time in Paint" exactly as it points at "Drawing". A separate table would have needed
its own log, its own totals and its own tally.

⚠️ **AND A VISIT NEVER OPENS AN ENTRY, which is the collision this design exists to avoid.**
`chronicle_one_running` allows exactly one entry with no end per person, and that one **is** the
hand-started timer. A visit that opened a row would fight it for the slot, so pressing Start on
Drawing would either fail or silently close the visit. A visit is a **finished** span that each
heartbeat extends. Proven: with a hand timer running, a visit still leaves exactly one open row.

**The rules, each proven to hold:**

- Nothing shorter than thirty seconds is recorded — tabbing through five rooms looking for one
  writes nothing. Measured in the browser: three hops of under a second reported nothing at all,
  then sitting in one room for 34 seconds reported `Games:34`.
- A duration is clamped to ten minutes, so a sleeping or lying client cannot claim an afternoon.
  Exactly `00:10:00`, which took a second fix — see below.
- A heartbeat every two minutes inside a three-minute extend window, so one slow beat cannot split
  a sitting into two rows.
- **Hidden is not viewing.** The clock stops when the tab goes away and reports what accrued;
  `pagehide` as well as `visibilitychange`, because a phone putting the browser away does not fire
  `beforeunload`.
- Signed out writes nothing: measured zero calls across room changes with no session.

⚠️ **AND THE CLOCK MUST BE READ ONCE.** The first version called `clock_timestamp()` twice in one
insert — once for the start, once for the end — which are two instants a few microseconds apart, so
a span clamped to "ten minutes" came out fractionally longer. Found by asserting the clamp and
watching it fail by microseconds. The same mistake as the `now()` one in kind: a single logical
moment read more than once stops being single, and a bound that is only nearly true is one somebody
will eventually compare against and disbelieve.

### ⚠️ And the gap in steps 1–3 closed itself

Every write I attempted in the Browser pane returned `401`, because the harness has no Supabase
session — so the join between `supabase-js` and these functions was the one thing I could only
infer. On 12 Oct, while this was being built, Evan signed in and used the room: an activity
("Claude maxing", Locked In) and a goal ("Make my website better") are in the tables, written
through `chronicle_activity_save` and `chronicle_goal_save` by a real browser with a real token.

⚠️ **Those two rows are HIS and must never be cleaned up.** I found them while checking for probe
residue and nearly treated them as mine; the only reason I did not is that I read them first.

What that leaves untested is the **timer**: `chronicle_entries` is still empty, so Start/Stop has
not been exercised by a real session.

## 6d · ✅ Looking back — the biggest hole, closed

**Migration `chronicle_minutes_one_home`.** Client: `src/chronicle/Looking.tsx`.

Chronicle recorded a life and could not show it back: the log listed today and nothing summed a
week, a month or a year, which for a thing asked for as an all-time tracking tool is most of the
point missing. The windows already existed — the plan half has used them since step 1 — so looking
back is the same windows pointed at the record instead of at the intentions.

⚠️ **AND THE OVERLAP RULE WAS ABOUT TO EXIST THREE TIMES.** It was in `record.ts` (TypeScript,
tested) and inside `chronicle_tally` (SQL) — a duplication taken knowingly, because the alternative
is shipping a year of entries to a browser. A totals function would have written it a third time,
and three copies is how a day's figure comes to depend on which panel you read it from. So the SQL
side now has **one** function, `chronicle_minutes`, and both callers ask it: `chronicle_tally` was
rewritten to use it and the old probe re-run to prove the answers did not move — 150, 20 and 60,
unchanged. The helper is revoked from `authenticated` entirely, reachable only from inside the two
`SECURITY DEFINER` functions above it, which a refused member call proves.

⚠️ **THE SAME THING HAPPENED IN TYPESCRIPT TEN MINUTES LATER.** `localMidnight` — build a local date
rather than parse one — was written separately in `record.ts`, `goal.ts` and the new panel, and in
the third copy I wrote a comment pointing out that it was the third copy instead of fixing it. It
now lives once, in `record.ts`, the leaf nothing else in chronicle imports from.

Totals come back one row per activity, busiest first, including the ones with nothing in the range
— a list that silently omits what you did not do is not a record of a week. Site-written rows are
marked "on the site", because "Paint 4h" meaning the room was open is a different claim from having
painted for four hours.

Shown only for windows longer than a day: Today and Tomorrow already have the Timer's own log,
entry by entry with times, which is strictly more than a total. Not shown for Years, which has no
window — all-time is a different question and the range cap is 400 days, so pretending would mean
showing a year and calling it everything.

## 6e · ✅ Routines — the last named feature the HTML app had

**Migration `chronicle_routines`.** Client: `src/chronicle/Routines.tsx`.

A morning you run through, a shutdown list, the three things you always do before drawing.

⚠️ **ONE ROW WITH A JSONB LIST, NOT A SECOND TABLE OF STEPS.** A routine is edited as a whole — you
reorder it, drop a step, add one — so a steps table would mean an ordering column, an RPC to move a
step up, and two writes that can half-succeed. The house pattern for a small document edited whole
is already jsonb: `member_library` and `park_maps` both do it.

⚠️ **AND THERE IS NO "RUNNING ROUTINE"**, which is the HTML app's `activeRoutine` deliberately left
out. The useful 80% of a routine is a saved list you tap down in order, and the timer already knows
what is running — a second idea of "where am I in the routine" would be a second answer to that,
kept in step by hope. **Which step you are up to is derived**: the first one with fewer minutes
against it today than it asked for. So a routine resumes itself after a reload, after a day, and on
another device, with nothing stored about where you were.

⚠️ **A STEP IS A SUGGESTION, NOT A LIMIT.** "10m" says how long you meant it to take; nothing stops
it or nags. A routine that enforced its own timings would be a schedule, which is a different thing
from a list and a much easier thing to abandon.

Ten probes, all rolled back. The one that matters: **a step naming somebody else's activity is
dropped rather than stored**, because a routine is a list of ids a request can type, and a tap on
such a step would try to start it. Also proven: the steps keep their order, minutes clamp at 600,
junk minutes become null rather than breaking the row, a non-list is refused, a blank or duplicate
name is refused, an edit keeps the id and may empty the list, and another member can neither read
nor delete one.

## 6f · ✅ Metrics — a thing to count besides time

**Migrations `chronicle_metrics`, `chronicle_metric_write_paths`.**

The HTML app's `metricLabel` / `metricGoalTarget` on an activity and `metricValues` on an entry.
Pages, reps, miles, words. **Time is the only universal measure and a poor one for anything whose
point is a quantity** — half an hour of writing is not the achievement, four pages is.

An activity may name one metric. A session may record an amount of it. And a goal with one activity
as its source may count **either** the minutes or the metric, which is what makes "100 pages this
month" sayable where before only "100 minutes" was.

⚠️ **MINUTES SPLIT ACROSS MIDNIGHT; AN AMOUNT DOES NOT.** This is the one place the two behave
differently and it is written beside both. A session from 23:00 to 01:00 gives an hour to each day
because time genuinely elapsed in both. Five pages written across midnight are not two and a half
pages each side — the quantity is indivisible, so it counts against the day the session **started**.
Proven: minutes 120 today, amount 4 today and the whole 10 yesterday, summing to the 14 written.

⚠️ **COUNTING AN AMOUNT NEEDS ONE ACTIVITY, NOT A CATEGORY.** A category's activities have different
metrics, and adding pages to reps to miles gives a number with no unit. A check constraint refuses
the pair and `chronicle_goal_save` corrects it to minutes rather than raising — the goal is still a
goal, it just measures time. The picker never offers the combination.

⚠️ **AND THE AMOUNT GOT ITS OWN FUNCTION** rather than a parameter on stop, add and edit. Those
three would each have needed a new signature — three drops and recreates, since an extra parameter
makes `create or replace` build an overload — and an amount is something you remember afterwards at
least as often as at the time. `chronicle_entry_amount` is one door, usable whenever.

`chronicle_minutes` became `chronicle_sum`, because the right function with a name that says
"minutes" would have started lying the moment it summed pages. Still one home for the rule.

Ten probes. The first one returned a single `<NULL>` because a subquery in my own probe found no
row and `||` nulled the whole message — the probe's bug, not the product's, fixed with `coalesce`.

## 6g · ✅ Streaks, and the two bugs that finding them required

Streaks were the plan for this step: a run of windows behind a repeating goal, which the HTML app
had no concept of. They took twenty minutes. The rest of the step was the reason they could not be
seen, and the live bug that was hiding behind the same blind spot.

### The streak itself

`streakAsks` asks about `STREAK_BACK = 30` windows per repeating derived goal; `streakOf` counts
the run. Two rules worth keeping written down:

- **The window you are in cannot break a streak.** A five-day run at nine in the morning on the
  sixth day is still five — today is unfinished, not failed. Counting it as a miss would make every
  streak read zero every morning, which is the opposite of what a streak is for.
- **Thirty windows back is thirty calendar steps, not thirty day-lengths.** A month back from 31
  March is not 31 days and a year back across a leap day is not 365; `setMonth`/`setDate` are the
  only arithmetic that knows that.

The chip appears from **two** in a row. A streak of one is just "done", and a badge that shows up
the first time you do anything teaches nobody that it means anything.

### ⚠️ The room could not be seen at all, and a whole tick was spent not noticing

Chronicle keeps **no local copy** — §6's decision, and the right one. The consequence nobody wrote
down: `dev/previewMember.ts` flips the UI gates but **never creates a Supabase session**, so in the
preview every chronicle RPC answers nothing and the room renders its empty state and only its
empty state.

So the streak chip was "verified" on the strength of the module exporting the function that makes
it, and a 375px audit of the room reported **0 undersized, 0 off-edge, 0 clipped** — against a room
containing a paragraph and two buttons. `scripts/mobile-audit.js` has a warning at the top of the
file about exactly that reading. It is the same shape as `.park-field` always being rendered: the
room being there does not mean anything is in it.

**`src/dev/chroniclePreview.ts`** is the fix, and it is the analogue of `#dev-park` one room over.
It is careful about what it claims:

- **What it proves**: the room renders. Every state a goal and an entry can be in, at every
  viewport, with the editors drivable and the empty states reachable.
- **What it cannot prove**: any number. The sums are the _browser's_ arithmetic, so a figure that
  looks right there says nothing about what `chronicle_minutes` returns for the same window. That
  question already has two homes and neither is that file — vitest over `goal.ts`/`record.ts`, and
  a simulated session in SQL.
- The seed is **chosen to light up every branch**, not to look like a plausible week: a goal at
  zero, one part way, one exactly met, one past its target, a tick ticked and one not, a hand-moved
  number, a goal on a category, a goal counting an amount, an archived activity, an auto one, a
  span across midnight, and a timer running now.
- **The drawing days have a hole in them** — 0, 1, 2, 3 then 5, 6. So the streak is **four** while
  six windows that week were met, which is the one seed shape that can tell a run from a count.
  Seven unbroken days agrees with both and distinguishes neither.
- It borrows `overlapMs` rather than writing a second opinion about what a span is worth. An
  unfaithful double looks exactly like a product bug.

### ⚠️ And then the room showed a live bug on its first load

`30 minutes drawing` read **0 / 30** with `Drawing 35m` in the day's totals two inches above it.
Every repeating derived goal on the site did, and had since they existed.

One load asks about a repeating goal **twice** — today's window for the Today list, tomorrow's for
the Tomorrow list, because the window strip has to count unfinished work in both. The asks were
keyed by **goal id**, so both answers were the same entry, `jsonb_object_agg` kept the last, and
tomorrow's window — zero every time, because tomorrow has not happened — overwrote the reading.

It is the **same mistake as `chronicle_tally`'s own**, found the day before and fixed one layer
down so a streak could ask about thirty windows. The caller that had been colliding all along was
never looked at, because the room it renders in could not be seen without a session.

The fix is `windowKey(id, fromISO)`: say which window you are asking about, and read the answer to
that question rather than to the goal. `reached`, `share` and `finished` now take the day as a
**required** argument — four callers, each of which already had it in hand. A default of "today"
would have let the Tomorrow view keep asking a question it cannot name and keep getting a number
with a plausible shape.

Three perturbations, each red for its own reason:

| perturbation                                              | result                                     |
| --------------------------------------------------------- | ------------------------------------------ |
| `tallyAsks` keys by goal id                               | 3 red — asker and reader disagree          |
| `reached` reads `tally[g.id]`                             | 3 red — same, from the other side          |
| key coarsened to the year, so only today/tomorrow collide | **1 red**, the duplicate-window test alone |

The third is the one that matters: it proves the test is sensitive to the actual collision rather
than to a changed string, and the one-off test stayed green because a one-off does not collide.

On screen afterwards, from one `got` map: `30 minutes drawing` reads **35 / 30 in Today** and
**0 / 30 in Tomorrow**, and the Today badge fell from 3 to 1.

### ⚠️ And the harness was shipping to real users

Measured, not assumed: `grep` the built bundle for a string only that file contains. The whole
seed was in `index.js` as unreachable dead weight — 2.78 kB — while `dev/previewMember.ts`, which
makes the same DEV-only claim, does not leak at all.

The difference is not the `import.meta.env.DEV` guard and not the namespace import, both of which
were tried and measured as making no difference (identical bundle hash). It is `let S = seed()`: a
**statement-level call at module scope**, which rollup cannot prove pure, so it keeps the module
for its side effect. `previewMember.ts` is all plain literals assigned to exports nobody reaches.
Behind a function — `const db = () => (S ??= …)` — there is nothing to run at import time and the
module drops out entirely. 375.22 kB → 372.44 kB.

**A DEV-only comment is a claim about the bundle, and the bundle is greppable.** Worth doing for
any future harness here.

### What this leaves

- `dev/chroniclePreview.ts` is now the way to look at chronicle. `window.__chron.empty()` and
  `.seed()` switch between the full room and a first visit; both reload, because the room reads
  its data once on mount.
- Verified at 375, 820 and 1440: 49 controls examined, none under 36px, nothing off-edge, clipped
  or scrolling sideways. The write path is drivable end to end — a real checkbox click moved a row
  to `is-done` and the Today badge to zero unfinished.
- Still only reachable with a session: the production path on :4173, which has no harness because
  the harness is DEV-only. Unchanged, and the reason the empty states are worth a trip there.

## 6h · ✅ The sweep — six features looked at for the first time

§6g built the harness. This is what it found when the six features that had shipped against an
unobservable room were finally driven. Four of eleven paths were broken, and three of the four were
things no amount of reading would have shown, because each was correct in the code and wrong on
the screen.

| path                                              | verdict                            |
| ------------------------------------------------- | ---------------------------------- |
| Day stepper (`‹ ›`, "Yesterday", "back to today") | ✅                                 |
| **An amount on a session that crosses midnight**  | 🐛 shown on both days              |
| **Deleting a straddling session**                 | 🐛 the confirmation understated it |
| Entry editor — both ends and the metric           | ✅ and it propagates to the goal   |
| **Fill a gap, with a timer running**              | 🐛 a dead end                      |
| **Fill a gap, the two datetime fields**           | 🐛 opened empty                    |
| Routines fold — run, edit, "2 of 3"               | ✅                                 |
| Activities fold — metric, time today, archive     | ✅                                 |
| Looking back — week / month / quarter / year      | ✅                                 |
| Goal form, source picker, counts picker           | ✅                                 |
| 375px audit of the populated room                 | ✅ 43 controls, nothing under 36px |

### ⚠️ A quantity does not split at midnight, and the day list split it anyway

One session of Writing, 23:00 to 00:30, four pages. The day list showed `1h · 4 pages` on the ninth
and `30m · 4 pages` on the tenth. The **minutes were right both times** — that is what `overlapMs`
is for, and the hour and the half-hour are both real. The pages were not: five pages written across
midnight are not two and a half pages each side, so the quantity belongs to the **session**, and
counts once, against the day it started.

`chronicle_sum` and `chronicle_totals` have had that rule since the column existed. The entry row
asked only whether `e.amount` was non-null. **A rule enforced in two places out of three is a rule
the third place contradicts** — so anybody reading two days counted eight pages from a session that
produced four, and the list disagreed with the totals beside it and with every goal counting that
metric.

`amountIn(e, fromMs, toMs)` now lives next to `overlapMs`, deliberately adjacent, because the two
rules can only be read as a pair. The test sweeps a **tiling** rather than two fixtures, the same
shape as the overlap test above it: over any set of windows that tile the range, the minutes sum to
the session's length and the quantity appears exactly once. Two hand-picked days would agree with a
rule saying "the first day wins" and with one saying "whichever day I happened to open".

Perturbed back to the shipped behaviour — the amount shown whenever the session touches the day —
two tests go red, including the running-session one.

### ⚠️ And the confirmation for deleting it was answering a different question

The day list shows a straddling session's **overlap** with the day you are on, so the prompt read
`Delete the 30m of Writing?` and then removed all ninety minutes, including the hour sitting on
yesterday's screen. A confirmation that understates what it does is worse than none: it is the one
moment somebody is deciding. It now names the whole span and says how much of it is here, with a
minute of slack so a session that pokes a few seconds past midnight does not get a sentence about
nothing.

### ⚠️ Fill a gap was a dead end whenever a timer was running

The form's button read `Add to the picked activity`, took the activity from the **top picker** — and
while a timer runs the top picker is not there, because it is replaced by the name of what you are
doing. So the button could not say which activity it meant, and pressing it answered
`pick an activity first`: an instruction you cannot follow, because the room has removed the means.
Same shape as `.park-field`, one layer up — **when a thing does not happen, check that the room is
letting you ask.**

A form that needs a thing has to carry the control for it, so the gap has its own activity select
now, defaulting to the picked activity, else what is running, else the first unarchived one — never
blank, because a select nobody notices is the dead end again.

### ⚠️ And it opened completely empty, which is four typed fields on a phone

Repairing the commonest hole in any log — "I did that and forgot to press Start" — meant typing two
full datetimes on a touch keyboard. It opens filled in now, from the two halves of what a gap
actually is:

- **the end** is now, when you are looking at today, because that is when you noticed. On a past day
  there is no "now" in it, so it is that day's last session, or midday if the day is bare.
- **the start** is the end of the last session before that — the gap _is_ the unlogged stretch — and
  an hour back when there is nothing to butt against.

Both clamped into the day on screen. Observed: today at 00:42 opens `00:00 → 00:42`; a past day with
sessions opens `09:31 → 14:50`, which is exactly the unlogged stretch between two of them; a bare
day opens `11:00 → 12:00`.

Two of my own mistakes in that one function, both caught before pushing and worth recording because
neither is specific to this room:

- **`Math.max(...ends, -Infinity)` returns `-Infinity` for an empty day, and `-Infinity` is
  truthy** — so a `||` fallback behind it never fires, and `new Date(-Infinity).toISOString()`
  **throws**. An empty past day would have opened the form by crashing the room. `ends.length ? …`
  instead.
- **`from < to` is not a guard against a degenerate span.** Four seconds satisfies it, and when the
  last session ended moments ago that is what came out — the form opened with both ends reading
  `00:41`. The rule needs a minimum length, not a direction.

### A note on the fixture itself

The seed placed today's sessions at fixed hours, and "today at 19:00" is in the **future** for most
of the day — which is not a product bug but reads as several, including making the gap defaults look
wrong. Today's sessions are pulled back to fit before now. The honest trade is that read in the
small hours today is cramped: at 00:41 there are only forty-one minutes for it to have happened in,
so sessions pile up against midnight and overlap. Everything still falls on the right day, which is
what the streaks and tallies need; anything being judged on how a _normal_ day lays out wants
reading later, or on one of the earlier days, which sit at their stated hours.

\** — the trailing run of letters —
rather than excluding separators. Chrome puts a *narrow no-break space\* (U+202F) before AM/PM, and a
class that had to exclude it either carries the character literally (an eslint error under
`no-irregular-whitespace`, and invisible in a diff) or in an escape. Asking for letters sidesteps it
and is correct in a 24-hour locale, where there is simply nothing to strip.

### What this leaves on the parity list

`TD`'s `est` and `priority` (a goal cannot yet say how long it should take or how much it matters),
`quality` on an entry, `sessionGoal` (a per-session rather than per-window target), and the `dash`
panel of stat tiles. Money, alarms, presence and `lib` stay out — §7.

## 6j · ✅ An estimate and a priority — the to-do half of the ask

**Migrations `chronicle_goal_est_and_priority` and `chronicle_goal_save_takes_est_and_priority`,
both applied 13 Oct 2026 — reasoning in `docs/2026-10-13-chronicle-est-and-priority.sql`.**

The two things the HTML app's `TD` store had that a chronicle goal did not: how long you think a
thing will take, and how much it matters. The ask was "a goal tracker/to do list", and a to-do list
that can say neither is thinner than the thing being replaced.

### Priority is the order, and that is free rather than a compromise

`sort` has been the server's order key since the table existed **and the room has never set it** —
every row is 0, so the list has really been ordered by creation all along. That left priority free
to become the first key of _one_ ordering, with `sort` and `created_at` behind it, instead of a
rival ordering that can disagree with a manual one. `sort` is kept rather than dropped: it is the
hook a hand-reordering would use, and dropping a column is not recoverable the way a
`create or replace` is.

Observed: `urgent/2 > silly/2 > important/1 > (old goal)/0 > (new goal)/0` — priority descending,
creation order within a band.

### ⚠️ The sum is a floor, and it has to say so

`weight(goals, tally, scope, on)` returns `{ left, mins, vague }` and **deliberately has no single
figure in it**. An estimate is optional, so summing the ones that exist and showing the total as
"the day's work" understates it by however many were never guessed — _silently_, which is the bad
part, because the number looks complete. Five things of which two are guessed at twenty minutes
each is not a forty-minute day.

So the line reads three ways, all three seen on screen:

| window   | line                               |
| -------- | ---------------------------------- |
| Today    | `1 left · about 10m`               |
| Tomorrow | `3 left · about 40m · 2 unguessed` |
| Years    | `1 left · none of them guessed at` |

And it counts through `finished` rather than `done`, so a derived goal the record has already
satisfied drops out too — otherwise the weight of a day would go **up** as the day went well.
Perturbed: dropping `vague` reddens three tests, counting by the tick-box alone reddens exactly the
derived one.

### ⚠️ The numbers said fixed and the screen said broken

This is the one worth keeping. Adding two chips to the goal row pushed its content past the list,
so the row got `flex-wrap` and the title got `min-width: 0`. Every measurement then read clean —
`listOver: 0`, `cardOver: 0`, `mainOver: 0`, `sideways: 0`, the audit reporting nothing undersized,
off-edge or clipped. **A screenshot showed every title in the room crushed to a single character
wide**: `30 minutes drawing` was rendering as a 3px column reading ":". The overflow numbers were
zero _because_ the titles had been destroyed.

Three things came out of it, all general:

- **`min-width: 0` without a floor is not "let it shrink", it is "let it vanish."** The chips were
  rigid and the title was not, so the title paid the whole bill. Both title paths now carry
  `flex: 1 1 150px; min-width: 150px`, in **pixels** — `rem` is unreliable here because the root
  size is fluid (§6).
- **There were TWO title paths and it is easy to fix one.** A goal you tick renders its title inside
  the `<label>`; a goal the record answers for has no tick-box, so its title is a bare span one
  level up. Fixing only the label left every _derived_ goal crushed while the tick-box ones read
  fine — which looks like a bug in the chips rather than in the title.
- **A to-do wraps, it does not ellipse.** `Ring the dentist about the thi…` is worse than two lines,
  and an ellipsis needs `nowrap` to do anything at all, which is what crushed them in the first
  place.

### ⚠️ And `mobileAudit` called the original overflow clean

Measured with a null control: hiding the two **newest** chips changed nothing, hiding **all** chips
fixed it. So the goal row had been 32px wider than its list since the chips existed, and the audit
never said so — the overflow is swallowed by an ancestor that manages its own scrolling, so the
document-level check reads `sideways: 0` and nothing is technically past the viewport edge. **Ask
the container, not the page.** Every viewport check in this section reports
`list / card / main` separately for that reason.

Two more things only the screenshot could have found: `~10m` rendered as `~10M` (the chip style
uppercases, and this is the first chip whose text carries a unit — megabytes? ten months?), and the
Planned fold's summary read `Planned2h 30m planned` because the name and the figures are separate
elements in a flex with no gap.

### What this leaves on the parity list

`quality` on an entry, `sessionGoal` (a per-session rather than per-window target), and the `dash`
panel of stat tiles. Money, alarms, presence and `lib` stay out — §7.

## 6k · ✅ How a session went — the last of the HTML's entry shape

**Migration `chronicle_entry_quality`, applied 13 Oct 2026 — reasoning in
`docs/2026-10-13-chronicle-quality.sql`.** Client: `moodOf` / `moodWord` in `record.ts`, the picker
in `Timer.tsx`, the aggregate in `Looking.tsx`.

`quality` was the last field on the HTML app's entry that this one did not have. It makes "I spent
three hours and it was rubbish" sayable, which three hours alone cannot say.

### ⚠️ Unrated is the normal state, so every reading says how much it skipped

Nearly all time goes unrated. `2h good` over a month with thirty unrated hours in it reads as a
verdict on the month and is a verdict on two hours of it — the same trap an optional estimate on a
goal sets, answered the same way: **the gap goes beside the figure, never instead of it.**

```
1h 20m good · 50m fine · 42m rough · 50m unrated
```

And the line is absent entirely until something is rated, because `32h unrated` on a window nobody
has rated is a reproach for not using a feature.

### ⚠️ Minutes, not sessions — so it is not an average

Averaging the ratings weights a five-minute session the same as a three-hour one, and an afternoon
that went badly gets cancelled out by two good five-minute ones. Time is what was actually spent.

### ⚠️ And unlike an amount, a rating DOES split at midnight

A quantity belongs to the session — five pages across midnight are not two and a half each side —
but a rating is a property _of_ the minutes, so an hour either side is an hour of rated time on
each day. `chronicle_moods` sums the overlap for exactly that reason, and the probe shows a
23:00→01:00 session rated 4 contributing only its 60 minutes inside the window.

### The property, and three perturbations

`moodOf` buckets 4–5 good, 3 fine, 1–2 rough — and the test asserts a **tiling** rather than
particular numbers: `good + fine + rough + unrated` is the whole window, for any input. A bucket
rule with a gap in it loses time _silently_, which is how a reading of your own month goes quietly
wrong. Forgetting that 3 is a rating reddens three tests; dropping 2 reddens three; making the
row's word disagree with the aggregate's bucket reddens exactly the test named for that.

Confirmed live, in all four windows, through two **different** queries: the mood line sums to
exactly what `chronicle_totals` reports for the same window — 222 = 222 for the week, 513 = 513 for
the month, quarter and year. And the tiling survived a write: rating a 12-minute session moved
rough +12 and unrated −12 with the total unchanged.

### ⚠️ A second copy of the overlap arithmetic, detected rather than prevented

`chronicle_moods` needs a `GROUP BY` and `chronicle_sum` returns a scalar, so the overlap
expression is written twice. Contorting `chronicle_sum` into answering both would have meant a
drop-and-recreate of a function three live callers depend on, for a sentinel parameter. The
duplication is **checked** instead — the SQL doc holds a probe asserting the two agree, to be run
after touching either. Two copies that are checked against each other beat one contorted into
answering both questions.

### The row says the word, the editor holds the number

Five words in a log row is a legend somebody has to learn; three is a thing you can read. The
precision is kept where it is being _set_ rather than where it is being skimmed — and `moodWord`'s
test asserts the row's word and the month's buckets are the same rule, because a row saying "good"
beside a month counting that session as fine is two answers to one question.

The picker is **one select, not five buttons** — a row of stars is five targets on a line already
carrying two datetimes and a number, and this room has just been through what crowding does to it.

### ⚠️ And the same min-width trap again, one row over

The plan row's activity name was ellipsed to `Dr…`, because `min-width: 0` let the three buttons
keep the line. Found by **looking**, not measuring — every overflow number read zero. Fixed the
same way as the goal row (a pixel floor), plus the three buttons are now a group so they wrap
together: as loose siblings the `✓` kept the first line while `✎` and `✕` dropped to the second,
which reads as a broken layout rather than a deliberate one.

Verified at 375, 820 and 1440: 56 controls, nothing undersized, off-edge or clipped, and zero
overflow measured on the log, the goal list, the plan list, the card **and** the container
separately — see the §6 note about asking the container rather than the page.

### What this leaves on the parity list

`sessionGoal` (a per-session rather than per-window target) and the `dash` panel of stat tiles.
Money, alarms, presence and `lib` stay out — §7.

## 6l · ✅ The dash, answered as a comparison

The HTML app's last unported surface was `dash`, a panel of stat tiles. **The horizon tabs already
are chronicle's dashboard** — they hold the totals, the categories, the bars and now the moods — so
porting tiles would have meant a second home for numbers the room already shows, which §5 of
CLAUDE.md names as a bug class. What tiles have that the tabs did not is **comparison**: this week
against last week. That is what was built, folded into Looking back rather than added beside it.

No new SQL. `chronicle_totals` already takes an arbitrary range.

### ⚠️ The same stretch, not the whole previous window

This is the whole feature and it is the thing a naive version gets wrong **every single morning**.
On Tuesday "this week" is two and a bit days old and last week was seven, so comparing them reports
the calendar as a collapse in effort: `4h less than last week` is arithmetically true and useless.
Every Monday would open with bad news.

`likeForLike(scope, on, nowMs)` returns two stretches of **equal length** — this window so far, and
the same number of hours into the one before it — plus `part`, saying the window is still running
so the sentence can read "this point last week".

Observed on screen, and the seed is built to prove it: a session sits in last week but _after_
today's hour, so it is inside the previous window and outside the compared stretch. The reading is
`1h 37m more than this point last week`; counting the whole previous window would have said `47m`.

```
3h 42m recorded this week   Locked In 2h 38m · Free Time 52m · Life 12m
1h 37m more than this point last week
1h 20m good · 50m fine · 42m rough · 50m unrated
```

### ⚠️ Only the difference is shown, never the earlier total

The headline is the **whole** window; the comparison is over the **elapsed** stretch. Both are
honest and they are not the same number, so putting both on screen would be one block disagreeing
with itself. Showing only the delta means there is never a second number to contradict the first.

### ⚠️ And the clamp, which the first test could not see

The earlier range is clamped to its own window's end, or a stretch longer than the previous window
bleeds forward into the current one and a period is partly compared against itself — flattering
every reading by exactly the overlap.

The first version of the test swept a mid-October date, where every window is the same length as
the one before it, so **removing the clamp changed nothing and the test stayed green**. A
perturbation found it. The case that bites is the end of a long month after a short one: 31 March
has thirty-one days elapsed and February had twenty-eight, so without the clamp the "before" range
runs three days into March. The test now uses that date and the perturbation reddens it alone.

All three perturbations, each red for its own reason:

| perturbation                                        | result                               |
| --------------------------------------------------- | ------------------------------------ |
| compare against the whole previous window           | 2 red                                |
| drop the clamp                                      | **1 red**, the long-month test alone |
| step back thirty days instead of one calendar month | 2 red                                |

Both directions exercised in the room rather than reasoned about: deleting 122 minutes of this week
turned `1h 37m more` into `24m less`, with the arithmetic agreeing to the minute once the running
timer is counted.

### A smaller one found by looking

`Chronicle (on the site)` was cut mid-word in the bar list — the name **had** `text-overflow:
ellipsis` and it did nothing, because the element carrying it is a flex container and the text is
an anonymous flex item. Ellipsis applies to a block container's inline content, so the name needed
to be a real element of its own. Measured after: `scrollWidth 136` in `clientWidth 55`, ellipsed
true.

### What this leaves

`sessionGoal` — a per-session rather than per-window target, "when I draw, draw at least thirty
minutes" — is the last named thing on the HTML list. Money, alarms, presence and `lib` stay out
(§7), and `dash` is answered above rather than ported.

## 6m · ✅ How long one sitting ought to be — and the parity list closes

**Migration `chronicle_activity_session_target`, applied 13 Oct 2026 — reasoning in
`docs/2026-10-13-chronicle-session-target.sql`.**

The HTML app's `sessionGoal`, and the last of its named features this one did not have. **With this
the parity list is closed**: everything in §1's table is either built, deliberately not ported
(§7), or answered differently and said so (`dash`, §6l).

### ⚠️ Why it is a column and not a goal pointing at the activity

A goal counts a **window**: thirty minutes of drawing today is met by six five-minute sessions.
This counts each **sitting**, and six five-minute sessions is the exact thing somebody setting one
is trying to stop doing. Same number, opposite question — so `chronicle_goals` cannot express it.

### ⚠️ A running session is never short

Five minutes into a thirty-minute target you have not failed, you are five minutes in. `false`
there would put a reproach on screen for the whole first half of every sitting, which is the
opposite of what the target is for. `metSession` returns **null** until the line is passed, then
**true**, and can only return **false** once the session has actually stopped.

Verified in the room rather than reasoned about: a session seven minutes into a two-hour target
carried no marker, and gained one the instant Stop was pressed — along with
`7m — under the 2h you aim for on Chronicle (on the site).`

The nudge is said **after** the fact and is not a confirmation beforehand: somebody who wants to
stop at twelve minutes is allowed to, and being asked to justify it would make this a feature to
turn off.

### ⚠️ And the whole span, not the overlap with the day on screen

A session's length belongs to the session, the way its `amount` does. A sitting from 23:00 to 00:30
is an hour and a half seen from either day; judging it by the overlap would call it long enough on
the evening you did it and too short the next morning. One sitting, two verdicts, decided by which
day you opened.

**The first version of that test could not see the difference.** It built the fixture from
`23:00Z → 00:30Z`, which crosses UTC midnight and — in this machine's timezone — is an evening
entirely inside one local day. So it crossed nothing, and swapping the whole span for a day overlap
left the test green. A perturbation caught it. **The day a session belongs to is a LOCAL question,
so a fixture about midnight has to be built from local midnight.** Rebuilt that way, the
perturbation reddens it.

### ⚠️ Row wrapping is a standing rule now, not a third fix

The `short` marker pushed the log row past its list — `log: 28, acts: 37, card: 12` — and
`mobileAudit` reported `offEdge: 0, sideways: 0` **again**, because the overflow is swallowed by an
ancestor that scrolls.

That is three separate fixes for one shape: the goal row with five chips, the plan row with three
buttons, and now the log row with one word. A row in this room is a name plus an **open-ended run
of small facts** — a length, an amount, a rating, a short marker, a category, a metric, a sitting
target — and then its buttons. Every new fact grows the min-content again. So the shared
`.chron-ent, .chron-acts li` rule now carries `flex-wrap: wrap` and a 130px pixel floor on whatever
holds the name, and the buttons are a group (`.chron-ent-do`, sharing `.chron-plan-do`'s style) so
they wrap together instead of one dropping alone onto the next line.

Verified at 375, 820 and 1440 with zero overflow on the log, the activities list, the goal list,
the plan list, the card **and** the container separately — and with a screenshot, because the
numbers have read clean through two broken layouts now.

### Where chronicle stands

Everything the HTML app had, plus: seven horizons rather than a flat list, goals that read the
record, streaks, routines derived from the day rather than kept in step by hope, plans against
actual, an estimate and a priority, a time-weighted reading of how the hours went, and this week
against the same point in the last one. The next tick has no parity list to work from — it goes to
depth: what is thin, what is unexplained, and what a person who has never seen it would do first.

## 6n · ✅ The first visit, from outside the door and in

With the parity list closed there is no list to work from, so this step was the trip CLAUDE.md §2
keeps recommending and ten steps of building never took: the **production build on :4173**, where
the dev harness does not exist and the room is seen signed out, and then the room walked cold as a
member with nothing in it.

Three things, none of them features, all of them things only this trip finds.

### ⚠️ The pitch outside the door described step 1

```
A planner for what you are aiming at — today, tomorrow, this week, this month,
this year, and the things that take years. … Sign in to use it.
```

That was written when the room really was only the horizons, and it stayed while the stopwatch,
the record, the routines, the plans, the ratings and the rest were built on top of it. **The room's
own blurb three lines below says "Two halves"; the pitch outside said one.** A sentence describing
a feature is a thing a later feature can make untrue, and nothing fails when it does — the same
shape as the Account card still saying the library lived "in this browser only".

### ⚠️ And "Sign in to use it." was not a link

Every other members-only room pairs that sentence with the house's `<a href="#signin"
className="btn">` — the Circuit and Investments both do. Chronicle told somebody to do something
and gave them no way to do it, on the one page that cannot otherwise help them.

Both fixed; the card now describes both halves and carries the door.

**What was NOT done, and why:** a demo, the way the Circuit and Investments have one. `places.ts`
already argues this out — "a fabricated one would be a page of pretend goals teaching nobody
anything" — and chronicle keeping **no local copy** is §2's deliberate decision, so a sandbox would
contradict the architecture on purpose. `dev/chroniclePreview.ts` could technically serve as one
now, and shipping it would reverse the measured decision in §6g to keep it out of the bundle. The
signed-out card is a description and a door, and that is the whole of it.

### ⚠️ Then, walked cold as a new member: a form that could never be submitted

On a fresh account `⏱ Fill a gap` opened a form with an **empty activity picker** and an "Add it"
that could never enable. `▶ Start` beside it has always been disabled for exactly that reason; this
was not. A dead form that explains nothing, on the one screen where somebody has the least idea
what to do.

And the Planned fold's `＋ Plan a span` was correctly disabled with no activities and **said nothing
about why** — a greyed-out button with its reason in a `title` is a reason that does not exist on a
phone (§6). The empty sentence now carries it: _"Name an activity with ＋ Activity first — a plan is
a stretch of a day set aside for one of them."_

The rest of the first run is sound, and was walked end to end rather than assumed: name an activity
→ it is pre-selected and Start lights up → Start → Stop → the record appears with its category total
→ `＋ Add to today` → the source picker offers the new activity → a goal reading `0 / 30 minutes`.
The three-step scaffold goes away for good once anything exists, as its comment promises.

Audited at 375 on the **first-visit** layout, which had never been looked at: 16 controls, nothing
undersized, off-edge, clipped or wordless, and no overflow on the card or the container.

### Two notes rather than changes

- **Chronicle is `nav: member`**, so a signed-out visitor reaches that card only by a shared link.
  That is consistent with Chat and People and argued in `places.ts`. Worth knowing rather than
  changing — but it does mean the card matters more, not less, since everybody who sees it arrived
  deliberately.
- **`.chron-src` dresses three different selects** — the goal's source, its priority, and what it
  counts. Harmless for CSS and it made a probe in this very step grab the wrong control; worth a
  rename if that class is touched again.

## 6o · ✅ The long view — 180ms to 2.8ms, and two checks that were passing by luck

Everything in chronicle had been exercised against a week of fixture data. This step seeded a year
of a heavy user — **2,196 sessions over 19 activities**, inside `begin/rollback` so nothing landed
— and timed what the room actually calls.

| call                            | before       |
| ------------------------------- | ------------ |
| one day's entries               | 1.1 ms       |
| `chronicle_activities_mine`     | 2.1 ms       |
| `chronicle_moods`, a year       | 5.7 ms       |
| **`chronicle_totals`, a year**  | **180.7 ms** |
| **`chronicle_totals`, a month** | **177.9 ms** |

**A month costing the same as a year is the tell**: the range was never the cost. `chronicle_totals`
called the scalar `chronicle_sum` once per activity for the minutes, again for the amount, **and
again in its own ORDER BY** — roughly forty scans of the window where one would do. Looking back
makes that call on every horizon tab, beside `chronicle_moods`, which was already doing it right.

### One shared pass

A third copy of the overlap expression inside `chronicle_totals` would have been the duplication
CLAUDE.md warns about, three ways. So the grouped scan is lifted into `chronicle_spread(from, to)`
— one row per (activity, rating), carrying seconds and amount — and both readers aggregate from it.
One copy of the arithmetic, one scan each. It is granted to **nobody**, like `chronicle_sum` beside
it, which still serves `chronicle_minutes` and the goal tally.

| call                                  | after            |
| ------------------------------------- | ---------------- |
| `chronicle_totals`, a year            | **2.8 ms** (65×) |
| `chronicle_totals`, a month           | 1.6 ms           |
| `chronicle_moods`, a year             | 2.6 ms           |
| both, which is what Looking back does | 5.0 ms           |

### ⚠️ Divide last — and the md5 baseline is the only reason it was visible

The first version divided by 60 **inside** the grouped scan, so each group's quotient was rounded
to numeric's scale and the caller summed _rounded_ quotients. Against the real rows `chronicle_moods`
then returned `86.9048353499999999` where it had returned `86.9048353500000000` — 1e-16 of a
minute, which matters not at all on screen and entirely to the claim that the change was a no-op.
Summing numerics is exact and associative, so `chronicle_spread` returns **seconds** and each
reader divides once at the end. Taking a behavioural baseline before replacing a live function (§4)
is the whole reason this surfaced.

One difference remains and it is **text rather than value**: the output now carries more decimal
places — `68.8468066833333333` where the old gave `68.84680668333333`, and `0.00000000000000000000`
where it gave `0` — because the old value passed through `chronicle_sum`'s `CASE`, which scaled it.
Proven row by row against a reconstruction of the old expression: **4 of 4 exactly equal, biggest
difference 0**. The client does `Number(x)` and renders whole minutes. Recorded because an md5 that
no longer matches should never be waved past.

### ⚠️ And the cross-check was passing by luck

§6k's probe asserts that `chronicle_moods` and `chronicle_totals` agree about a window — the
detection that justified keeping two copies of the overlap arithmetic. It compared them for
**exact** equality and passed on four fixture rows. At a year of real volume it **failed**: by
0.0000000000000001 of a minute out of 143,566, six femtoseconds, because the two divide by 60 at
different groupings and summing separately-divided numerics in two groupings is not exactly equal.
The probe now compares to a tolerance and says why.

**A check that only passes on small fixtures is a check that has not been run.** That is the second
time in this step that a test looked green for a reason unrelated to the thing it was testing.

### What was not verified here

The room's rendering of these numbers. The preview harness answers from its own `pvTotals` and
`pvMoods`, so the real functions are reachable only with a session — this step's evidence is the
SQL above and nothing on screen. No client code changed.

## 6p · ✅ The streak batch cost 2.75 seconds — measured, mitigated, and now fixed in §6x

Same volume as §6o — 2,196 sessions over 19 activities — pointed at the other half of what the room
calls.

A streak asks about **thirty-one windows per repeating goal**, so ten repeating goals is **310
questions in one `chronicle_tally` call**, and the function answers each with its own
`chronicle_sum`, which is its own scan.

| asks    | time         |
| ------- | ------------ |
| 20      | 186 ms       |
| **310** | **2,750 ms** |

The same shape as §6o's `chronicle_totals` problem, and roughly fifteen times worse.

### What was done

`load()` no longer **awaits** the streak call. That matters more than it sounds: `load()` is what
every write waits on — ticking a goal, stopping a timer, editing a span all call `after()` which
calls it — so awaiting 2.75s of streak arithmetic froze the room after every tap, for a number that
decorates a chip. The fetch lands on its own now, guarded by a generation counter so a slow answer
cannot paint runs over goals a later load has already replaced.

**That hides the latency from the person. It does not fix it** — the database does the same work.

### ⚠️ What was NOT done, and why

The one-pass rewrite. It was written and **compared against the live function rather than
deployed**:

| case                                         | result                                     |
| -------------------------------------------- | ------------------------------------------ |
| one activity goal, session crossing midnight | old 150, new 150 ✅                        |
| one category goal over three activities      | old 133.85, new 133.85 ✅                  |
| 310 asks over a year, ten mixed goals        | **94 of 310 disagree**, biggest gap 1440 ✗ |

1440 is a whole day in minutes, and 94 is almost exactly the 93 asks belonging to that fixture's
three **category** goals — so the category path is the suspect, even though the targeted category
test passes. An earlier attempt was worse still (248 of 310, totals 80× too large) because an
unguarded join multiplied every ask by every activity.

**It is not shipped because it is not understood.** `chronicle_tally` is what tells somebody their
streak; a replacement that is right twice and wrong ninety-four times is not worth 2.5 seconds. The
evidence and a suggested starting point are in `docs/2026-10-13-chronicle-tally-cost.sql`.

This is the second time in two steps that comparing against the live function before deploying
caught something — §6o's 1e-16 drift, and now an 80× join blowup followed by a subtler one. The
baseline is not ceremony.

### The other direction, if the rewrite stays hard

`STREAK_BACK = 30` is a product decision — "long enough that nobody's daily streak is silently
truncated in the first month". Asking lazily (only for goals on screen) or shortening it are
client-only changes with no correctness risk. Neither was done because both trade a real feature
for a problem that belongs in one SQL function.

## 6q · ✅ The tally, finished — and `greatest()` ignores NULLs

§6p left this measured and unfixed: 310 streak asks took **2,750 ms**, and two attempts at a
one-pass rewrite were wrong in ways I had not isolated. This finishes it.

|              | before       | after      |
| ------------ | ------------ | ---------- |
| twenty asks  | 186 ms       | 42 ms      |
| **310 asks** | **2,750 ms** | **617 ms** |

### ⚠️ The bug, and it is a Postgres fact worth carrying

**`greatest()` and `least()` ignore NULLs.** On a `LEFT JOIN` the no-match row has `e.*` null — and
`greatest(null, a.f)` is _not_ null, it is `a.f`. So the overlap expression quietly computed
`a.t - a.f` for a row that matched **nothing**, and every ask whose source had no sessions in that
window came back with the whole window: **1440 minutes for a day**, where the old function
correctly said 0.

That is why `case when e.id is null then 0` is the first branch and not a tidy-up.

### How it was actually found, after a day of guessing

§6p ended with a confident guess: _"94 is almost exactly the 93 category-goal asks, so the category
path is the suspect."_ **That was exactly backwards.** Every category ask agreed; every _activity_
ask disagreed, except on the one day that activity had a session.

The thing that found it was not more reasoning. It was shrinking the comparison to two goals over
five days and **printing the rows side by side**:

```
g-act|0   old 0.00     new 791.74    gap 791.74
g-act|1   old 0.00     new 1440.00   gap 1440.00
g-act|2   old 97.00    new 97.00     gap 0.00      ← the only day it had a session
g-cat|0   old 177.85   new 177.85    gap 0.00
```

Five minutes of printing beat an hour of thinking, and the hour of thinking had produced a
confident wrong answer that went into a commit message. **A plausible explanation for a failure
is not a diagnosis.**

The first attempt was differently wrong — an unguarded join to `chronicle_activities` multiplied
every ask by every activity, 80× too large. Hence `exists` rather than a join for the category
test: a category covering five activities must not multiply the entries it matches.

### Verified before and after deploying

Against the live function, 310 asks over a year with ten mixed goals — activity goals, category
goals, and goals counting an amount: **310 of 310 keys, 0 disagreements, biggest difference 0,
totals equal to six decimals.** Then on the deployed function, three hand-checkable cases: 150 for
three sessions including one crossing midnight, **0** for an activity with no sessions at all, and
**0** for a day that activity did nothing — the last two being precisely the case that returned 1440.

Security re-checked because the rewrite touched the auth path: A sees their own goal's 60, **B
asking about A's goal gets `{}`**, anon is refused, and 1,300 asks still hit the cap.

### What is still true

617ms is better, not cheap. The remaining cost is one index probe per ask: the predicate is
`started_at < to AND coalesce(ended_at, now) > from`, and the index on `(owner, started_at)` prunes
the top of the range but not the bottom, so each ask still walks backwards. Bounding the lower end
would need a ceiling on how long a session may be, and `chronicle_start`/`stop` imposes none — only
`chronicle_entry_add` does. Not worth inventing one for this.

The client does not wait on it either way (§6p).

## 6r · ✅ The month behind the streak, for free

The chip says `🔥 4`. This says **which** four, and what the month around them looked like:

```
30 minutes drawing     .....................#..##.####     🔥 4
Wash up every evening  ......................#.......#
```

⚠️ **It costs no query.** `streakAsks` has always fetched thirty-one windows for every repeating
goal, and `streakOf` throws all but the run away — the room was paying for a month of history and
rendering one number. `marksOf` reads the same answers instead of discarding them: no fetch, no
state, no load.

And it makes an existing feature honest. "Wash up every evening" has a streak of **1**, which is
below the chip's two-in-a-row floor, so it shows no chip at all — and the row above makes the
difference between "no streak" and "a streak of one" something you can see rather than infer.

### The rules, and the test that binds them together

- **Today is its own kind of mark.** The window you are in is unfinished, not missed — the same
  rule `streakOf` is built on, where a five-day run at nine in the morning is still five. Drawn as
  a gap it would make every morning look like a broken streak. It is outlined rather than filled.
- **Oldest first**, so the row reads left to right and the streak is the run on its right-hand end.
- **A miss is the quiet one** — the default bar colour, never red. A record of your own life has no
  business marking a day you did something else as a fault.
- **It is not a control**: no touch target, nothing to press. A month of history you can tap is a
  month of history somebody taps by accident while scrolling. Thirty-one `<i>`s are also thirty-one
  pieces of nothing to a screen reader, so the row is `aria-hidden` with the count beside it in
  sr-only text.

⚠️ **The marks and the number have to tell the same story**, and one test exists to keep them from
drifting: the run of met marks at the right-hand end must equal `streakOf` exactly. It has two
branches, because today being unfinished does not break a streak — a single tail count would be
wrong every morning. Perturbed: drawing today as a miss reddens it, reversing the order reddens it.

⚠️ **And the first version of that sweep could not see a boundary.** Every fixture value was
comfortably over or well under the target of 30, so a mark requiring the target to be _beaten_
while the streak only required it _reached_ passed straight through. Added `[30, 30, 30, 29, 30]`
and `[29, 30, 30]` and the perturbation reddens. **The boundary is where two readings of one fact
part company** — the same lesson as the band-sweeping note in CLAUDE.md §2.

### ⚠️ And a desktop flaw only looking could find

With `flex: 1 1 0` each mark grew to fill the row — **39.5px apiece at 1440**, which stops being a
month of days and becomes a bar chart of nothing. Every measurement said the layout was clean: no
overflow on the marks, the list, the card or the container, nothing undersized, off-edge or
clipped. `flex: 0 1 10px` shrinks on a phone and holds at 10px on a desk.

That is the third time in this project that the numbers passed a layout the screenshot failed.

## 6s · ✅ The shape of a day, also for free

Same thread as §6r. The day's entries are already in hand **with their exact ends** — the log draws
them as a column of lengths and throws the placement away. So the one thing the record could not
say was the _shape_ of a day: a solid morning, an afternoon that went somewhere else, an evening
that was meant to hold something and did not.

Two lanes, twenty-four hours wide: **what was meant above, what happened below.**

It lives in the Planned fold rather than in the Timer because **here both lanes already exist** —
that block is handed the day's entries for the comparison and holds the plans itself. An
actual-only strip above the log would be prettier and would say less than the log already does;
the gap between the two rows is the whole reason to draw it.

### The rules

- ⚠️ **A fixed twenty-four hours, never scaled to the part of the day that was used.** A strip that
  stretched an hour of work across its full width would make a quiet day look like a full one. The
  axis has to be the day or the shape it shows is a lie. Ticks at 6, 12 and 18, because an
  unlabelled bar is a decoration.
- ⚠️ **The width of every block is `overlapMs`**, not a second subtraction — only the left edge is
  new arithmetic. A strip that disagreed with the minutes printed beside it would be two answers to
  one question, and the strip is the one nobody can check by eye. The test asserts exactly that
  pairing, to the millisecond, rather than any particular pixel.
- ⚠️ **`cut` says a span runs past this day**, drawn as a square edge. A session from 23:00 to 01:00
  is a block hard against the right edge on one day and the left on the next, and without the flag
  both look like sessions that happened to stop at midnight.
- ⚠️ **The now-marker is null on any day that is not today.** Pinned to one end of a past day it
  reads as something that happened at midnight; on a future day it would claim the day had begun.
- A half-hour session is 2% of a day — six pixels on a phone — so blocks carry a 2px floor. A block
  narrower than a pixel is a block that did not happen.

Perturbed: not clipping the left edge reddens two tests, taking the width from the whole span
rather than the overlap reddens three, and a now-marker on every day reddens its own.

### ⚠️ And a class name is a selector, and a selector is global

The strip was called `.chron-strip` — which **was already the horizon tab row** in `Chronicle.tsx`.
Two things happened at once and neither announced itself: the existing rule's `display: flex`
collapsed the new lanes to **zero width** (their children are absolutely positioned, so they have
no intrinsic size), and the new `margin` silently applied to the tabs.

Found with `whoSets()` from `scripts/mobile-audit.js` rather than by reading the stylesheet — it
reported one rule, `.chron-strip { display: flex }`, that I had not written. Renamed to
`.chron-shape`, and the tab row verified unharmed afterwards.

Checked at 375, 820 and 1440: 56 controls, nothing undersized, off-edge, clipped or wordless, and
no overflow on the strip, the marks, the goal list, the plan list, the card or the container.

## 6t · ✅ Where each activity stood last time — and the collision audit

### First, the thing §6s said to check

`.chron-strip` turned out to be the only name collision. A sweep of every `chron-*` class across the
five components found fourteen shared names, and all the rest are deliberate: `chron-chip`,
`chron-x`, `chron-qty`, `chron-add`, `chron-say`, `chron-tidy` and the others are a small design
system, and `chron-bar` — the one that looked most like a repeat — is **scoped on purpose** with
`.chron-bars .chron-bar { … }`. Reuse with an override is not a collision; reuse of a name for a
different _thing_, with no scoping, is. That was `.chron-strip` and only `.chron-strip`.

### Then the same free-reading thread

`Looking` fetches the previous window's totals as a full `Total[]` — one row per activity — and
kept **only the sum**. So the bars can say which activity moved, for nothing: when the headline
says "47m more than this point last week", the obvious next question is _more of what_.

A tick on each bar marks where that activity stood at the same point in the previous window:

```
Drawing   ████████████▏          1h 48m     ← tick inside the bar: ahead
Writing   ████▏   ▏              50m        ← tick beyond the bar: behind
```

- ⚠️ **A tick, not more text.** A row at 375px already carries a name with a 130px floor, a bar, a
  length, a metric total and a rating; a sixth thing in words is the crowding this room keeps
  relearning. The marker costs no horizontal space.
- ⚠️ **The same denominator as the bar**, or the mark would be a lie about its own row — and
  **clamped**, because `most` is the biggest of _this_ window and an activity that was busier last
  time would otherwise put its marker past the end of the bar.
- ⚠️ **Direction is in the position and the colour together.** Inside the bar means more than last
  time; the accent reinforces it. Colour alone is not a signal somebody colourblind reads, and
  position alone needs you to remember which way is good.

### ⚠️ And a chip that had nowhere to live

"ON THE SITE" sat inside the bar's name column, which is a **fixed width so every bar in the list
starts at the same place** — a bar chart whose bars do not line up is a worse chart. Against
"Chronicle (on the site)" that column was never big enough for both: first the chip wrapped to
three lines and made the row three times taller than its neighbours, then `white-space: nowrap`
fixed the height and ate the name instead, leaving **"C."**.

Two wrong answers before the right one, which was to stop it competing: the chip moved **after the
length**, at the end of the row, where it has nothing to fight. Names intact, every row back to
32px.

Checked at 375 and 1440: 48 controls, nothing undersized, off-edge, clipped or wordless, and no
overflow on the bars, the day strip, the goal list, the plan list, the card or the container.

## 6u · ✅ Reading the room's own words

Three steps added three new visual languages — a month of streak marks, a two-lane day strip, and a
tick on every bar — and not one of them said what it was. The rule this project keeps citing is
_check what your own change made untrue_, and it had been applied to code rather than to copy.

Every sentence the room renders was dumped and read against what the room now does. Four findings.

### ⚠️ The day strip had no words on it at all

Two lanes of colour and an hour axis. A reader could see that something was drawn twice and had no
way to learn which row was the plan and which was the day — the one thing in the room that could
only be explained by somebody who already knew.

Now `meant` and `did`, which is also why they are **not** "Planned" and "Actual": the fold is
already called Planned and its summary already says "done", so a third vocabulary for the same
pair is a thing to learn rather than a thing to read. The strip became a two-column grid so both
lanes start at the same x whatever the labels measure — lanes that did not line up would make the
comparison they exist for impossible.

### ⚠️ "Planned · 2h 30m planned · 1h 39m done" said it twice

The fold's own name is the first half of that sentence. Now `Planned · 2h 30m · 1h 39m done`.

### ⚠️ A tick on a bar is the least self-explanatory thing in the room

One line for the whole list rather than a label on every bar — _"The tick on a bar is where that
one stood at this point last week."_ It appears only when there is at least one tick to explain,
and it is absent on a window with no previous data at all (verified on This year, which has none).
The `title` on each tick does not exist on a phone, which is the whole reason the line is needed.

### What was judged and left

**The streak marks row still carries its count in `sr-only` text only.** The `🔥 4` chip above
labels the row when there is a streak; below the two-in-a-row floor there is an unlabelled row of
marks. A visible count would be a line of text per goal in a list that already carries up to five
chips, a meter and two buttons — the crowding this room has fixed three times. Left as a judgement,
not as a thing solved.

**"Two halves" in the top blurb is still true.** Plans, Routines and Activities are folds _within_
the stopwatch half, not a third thing, so the framing holds.

Checked at 375 and 1440: 56 controls, nothing undersized, off-edge, clipped or wordless, no
overflow on the strip, the bars, the goal list, the plan list, the card or the container.

## 6v · ✅ The double, checked against the thing it doubles

`chronicle_totals`, `chronicle_moods` and `chronicle_tally` were all rewritten within a day of each
other for performance. `dev/chroniclePreview.ts` implements the same three contracts and answers
every judgement made by looking at the room — and nobody had checked it still agreed.

Fourteen tests now pin it to the behaviours the SQL docs say those functions keep. **Two had
already drifted.**

### ⚠️ `pvTotals` was omitting activities with no time in the window

It built its rows from the **entries**, so a quiet activity simply was not in the answer — while
`chronicle_totals` selects from the activities and LEFT JOINs the sums _precisely so_ it appears at 0. Nothing on screen was wrong, because `Looking` filters `mins > 0` itself. The double was
answering a different question from the one the server answers, which is how a double starts
producing false bugs rather than how it produces one today.

### ⚠️ `pvTally` was answering goals the server refuses

A goal with neither an activity nor a category came back as `0`. `chronicle_tally`'s own join
requires one or the other and drops the ask entirely — `{}`, which is a different claim from zero.
Again invisible: `tallyAsks` never asks about a hand-moved goal.

Both fixed; both perturbed back in and the tests redden.

### Why this is worth test weight at all

A dev-only harness is worth testing **when it is a double**. This one has already cost real time
twice: once returning goals in seed order while the server sorted them by priority — which looked
exactly like the priority ordering not working, hours after it had been proven in SQL — and once,
in the park, with a roster keyed differently from the relay. CLAUDE.md's line is that an unfaithful
double looks exactly like a product bug, and the rule it implies is that **a double's agreement with
its original is a thing to assert, not to assume.**

The tests are explicit that they check the **rules** and not the numbers: nothing in a browser can
say what `chronicle_minutes` would return, and the harness's own header says so.

### And two of the tests were not testing anything

The first pass at the rating tests could not reach an entry — `pvAddEntry` returns no id — so
rather than find one they asserted that the minutes were still the minutes. `pvEntries` is the same
door the room uses to draw the log; going through it made them about the rating instead. Worth
noticing that a test which cannot reach its subject will happily assert something else and pass.

## 6w · ✅ The one part of chronicle nobody had ever looked at

`useVisits` writes rows automatically, for every member, without anybody pressing anything — and it
was the only file in the module I had never read. Two real problems and one structural one.

### ⚠️ The clock started when the page loaded, not when you signed in

`since` is set at mount, and the page mounts for a signed-out visitor too. So somebody who read the
site for twenty minutes and then signed in had their first beat report twenty-two minutes, twenty
of which were nobody's record. The ask was "the time when I am **logged in** viewing the site".

Worth saying accurately: **`chronicle_visit` clamps every report to between 30 seconds and ten
minutes**, so this was capped rather than unbounded — ten minutes of signed-out time counted as
yours rather than twenty. Reading the function before writing the sentence is the only reason that
is stated correctly.

### ⚠️ Leaving the page could report nothing at all

`pagehide` was wired to the same handler as `visibilitychange`, and that handler's first question is
"can I still be seen". On any browser where the page is still **visible** when `pagehide` fires, the
branch taken resets the clock and reports nothing — and the tail of the visit is lost.

Modern browsers do set visibility to hidden before `pagehide`, so in the common case it happened to
work because `visibilitychange` had already reported. That is relying on an ordering this code
cannot check, for the event that is the commonest way a visit ends on a phone. Going away now
reports unconditionally; reporting twice is harmless, because the server extends the span it already
has and the second report is under the thirty-second floor anyway.

### ⚠️ And it was the one chronicle call with no door in `cloud.ts`

It called `getSupabaseClient().rpc` itself, so in the dev harness it reached for a session that does
not exist, failed, and swallowed the failure. **The one feature that writes rows on its own was also
the only one that could not be watched doing it** — the exact shape of the blind spot §6g was about,
surviving in a corner for sixteen steps.

It goes through `recordVisit` now, with `pvVisit` behind the preview guard, and six tests pin that
double to the three rules `chronicle_visit` keeps: the clamp, the find-or-make of an `auto`
activity, and the **extend** of any finished entry that ended under three minutes ago — which is
why the beat is two minutes and why the client restarts its stretch after each one. Perturbed:
dropping the clamp reddens two, always inserting instead of extending reddens one, failing to mark
the activity `auto` reddens two.

### What this still cannot prove

`useVisits` is a hook; this repo tests pure modules in node and has no React test setup, so the two
fixes above are reasoned from the code and the server function rather than observed firing. What is
now possible — and was not before — is watching a visit accrue in the harness, because the call
finally has a route it can answer.

## 6x · ✅ Two things verified rather than reasoned about

Nothing new on screen this time. Both of these were already written and both were believed on the
strength of the code reading correctly, which §2 of `CLAUDE.md` is explicit about not accepting.

### The `pagehide` fix, now watched doing it

§6w rewired `pagehide` from `flip` to a reporter that always reports, on the reasoning that
`flip`'s first question is "can I still be seen" — so on any browser where the page is still
**visible** when `pagehide` fires, the branch taken resets the clock and reports nothing, and the
tail of the visit is lost. That was shipped on the argument alone.

It is now observed. With the preview harness blank, `document.visibilityState` stood in as
`'visible'` (the pane reports `hidden` while undisplayed, and `useVisits` treats hidden as "not
viewing" by design), a wait of 34 seconds past the thirty-second floor, and then `pagehide`
dispatched **while still visible** — the exact case the old wiring dropped:

| wiring                     | activity           | entry |
| -------------------------- | ------------------ | ----- |
| `pagehide → flip` (before) | —                  | —     |
| `pagehide → away` (after)  | `Chronicle (auto)` | `51s` |

The control is the row that matters. The old wiring was put back, the identical sequence run again,
and **nothing** appeared — so the row above is the fix's doing and not the heartbeat's, or the
room change's, or anything else that was also running. The fix was then restored.

The other half of §6w — that the clock starts at sign-in rather than at page load — **remains
reasoned only**, and this is the honest boundary: `authed` is React state that the harness starts
as `true`, so the false→true transition cannot be reached without a real sign-in. It is one line,
and it is the line somebody who reads the site for twenty minutes before signing in depends on.

### The streak batch, 656ms to 14.8ms

§6p measured the batch at 2.75 seconds and §6q brought it to 617ms by answering all the windows in
one statement. What remained was the shape of that statement: the entries were joined to **every
window**, and the only lower bound was the window's own `coalesce(ended_at, now) > from`, which no
index can serve. So each of a streak's ~190 windows considered every entry the person had ever
made — a cost that is the product of how long they have used the site and how far back a streak
looks.

Bounding the candidates once per **goal**, by the span of that goal's own asks, is lossless: every
window a goal is asked about lies inside `[min(from), max(to))`. Synthesised at three years of
three sittings a day — 3,293 entries, 192 windows — **656ms → 14.8ms**, byte-identical JSON.

The check is the part worth keeping. A differential sweep ran the live function as the oracle
against the candidate over eight rounds of random entries and random windows, including a sitting
that began 400 days before any window and ended inside one, both ends exactly on a day boundary,
the one open entry the table allows, all four goal source shapes, and an id that is not a goal:
**0.0000 minutes apart on every round**.

And then it was perturbed, because a sweep that cannot go red is decoration — the lower bound
changed to ask where the entry **started** rather than whether it had **ended**, which drops that
400-day sitting. It reported agreement on all eight rounds. The fault was in the fixture: it hung a
life-scope window on every goal, which drags `min(from)` back to 1970 and makes any lower bound a
no-op. **The fixture had neutralised the thing under test and still looked thorough.** With the
life window given a goal of its own, the same perturbation is 3,068–4,106 minutes wrong across
21–23 keys, every round — and the candidate is still exact.

Reasoning and the standing privilege check are in `docs/2026-10-13-chronicle-tally-span.sql`,
applied as `chronicle_tally_span_bound`.

## 6y · ✅ The room in the real bundle, and the index that lists it

Everything until now was checked against `npm run dev`. The built bundle is a different program —
`import.meta.env.DEV` strips whole branches, and `:4173` is its own origin, so localStorage is
empty and every room opens the way a first-time visitor finds it.

**The harness is not in it.** `src/dev/chroniclePreview.ts` invents a whole seeded account, and a
module-scope call once shipped 2.78 kB of it to real users (§6g). Grepped against the built
`dist/assets/*.js` for six strings only the harness contains — `pv-a`, `__chron`,
`dev_chron_blank`, `pvVisit` and two seed names — **zero files**, including the `pvVisit` added
last tick.

**The signed-out page, measured at 375 on the real build.** Chronicle is `nav: member`, so what
production actually shows a visitor is the explainer and a Sign in button — that page _is_ the
production surface, and it is clean: `scrollWidth - clientWidth` is **0** at the document, `main`,
the section and the card; nothing clipped, nothing past the right edge, and the one control is
82×40 against the 24px floor. Then looked at it, because §6 of `CLAUDE.md` is explicit that zeroes
can mean the text has been destroyed rather than that the layout is right. It reads correctly.

**What the trip actually turned up was a question about a neighbour.** The footer's "What's here?"
dialog says _"Every room you can open"_, and standing on Chronicle signed out, Chronicle was not in
it. That is the `nav: member` gate working — Chat and People are absent for the same reason, and
the dialog is built from `navFor(viewer)` rather than a typed list, so a member does see it.

But "by construction" was the whole of the evidence. `src/nav/places.ts` exists **because Paint was
missing from the phone for its entire life** — one fact written in six places and one copy wrong —
and it had no test at all. One of its own comments names a decision nothing checked: `#pets` points
at `games` rather than at `minions` so that no alias resolves through another alias, "a chain
nobody wrote and nothing tests".

`src/nav/places.test.ts` now does, in 14 tests that deliberately **do not restate the list** — a
test holding its own array of room ids is the seventh copy, and it rots like the other six. Every
assertion is either a rule quantified over `PLACES` (every members-only room, derived as
`nav(member) && !nav(visitor)`, is withheld from a suspended member and from a build with no
members' side; no place that answers false to everyone is ever offered; every id appears once;
every place has a word, a glyph and a title) or a claim about one named room (Chronicle is offered
to a member, withheld from a visitor, routable and titled; every alias resolves to a real section
and never to another alias; a challenge link's query survives; a Circuit link that means Chat still
does; an unknown hash lands on Home rather than nowhere).

Made to fail, four ways: Chronicle offered to everybody (1 red), `member` forgetting suspension
(2 red), an alias pointed at another alias (1 red), the Circuit-means-Chat rule deleted (1 red) —
each reverted from a scratchpad copy, and the file byte-identical afterwards.

**The honest limit**: the room itself cannot be reached in production without an account, and the
workbench does not exist there by design. What is verified here is the bundle and the signed-out
page; the signed-in room has only ever been exercised against the dev server and the preview
double.

## 6z · ✅ The one thing here nobody could take out

The room's own first decision was that chronicle keeps **no local copy** — a record of your days
has to read the same on a phone and a laptop, so there is one copy and it is the server's. That is
still right, and it had a cost nothing had named: chronicle was the only store on this site a
person could not get out of it.

The Account page has said the other half out loud for months. It offers songs, drawings, looks and
minions as a file, on the grounds that **"a file is the copy that survives losing the account"** —
and chronicle, the thing most likely to be worth years, had no such file. The app this room
replaced kept everything in localStorage, where it was the person's by accident. A "⬇ Save a copy"
at the foot of the room, and `chronicle_export()`, make it theirs on purpose.

**One RPC returning one document, not five calls returning five lists.** The obvious build is
client-side — call the five list RPCs and stitch them. The reason not to is truncation: a set comes
back through PostgREST, which can cap rows, and a cap applied quietly turns "everything you ever
recorded" into "some of it", with the download looking exactly as successful either way. That is
the shape of a local ceiling under the server's, where the person is told it worked. One row cannot
be truncated by a row limit.

Three things the function is careful about: `owner` is **not** in the file (the same uuid on every
row, the caller's own account id, in a file meant to be carried between machines); every list is
**ordered**, so two exports of unchanged data are byte-identical and a diff of last month's file
against this month's shows only what changed; and it is **not bounded**, because an export that
quietly stopped at N rows would be the exact failure it exists to prevent.

Measured: refused with no session; a session owning nothing sees all zeros, which is the
`owner = me` filter doing real work rather than being assumed; the owner's uuid appears nowhere in
the file; three synthetic years export in **45–52ms**, 3,293 rows in and 3,293 out, 931 kB,
ascending, against an 8s statement timeout. End to end in the pane, the button produced a
12,912-byte `application/json` blob named `chronicle-2026-10-13.json`. At 375 the row is clean —
zero overflow at the document, the card and the row itself, the sentence wrapping under the button
rather than being squeezed beside it.

**And the double had to learn a second vocabulary.** `pvExport` is the one place in
`chroniclePreview.ts` that speaks the server's column names — `started_at`, `repeat_every`,
`done_at`, `archived_at` — while every other export in that file speaks the room's: `start`,
`every`, `done`, `archived`. A double that exported its own words would be internally consistent,
would look right in the pane, and would agree about a file nobody will ever receive.

Seven perturbations ran against the six new tests, and **three passed at first**, which is the part
worth keeping:

| what was broken                        | first result | why                                           |
| -------------------------------------- | ------------ | --------------------------------------------- |
| entries exported under the room's keys | ✅ caught    |                                               |
| goals exported under the room's keys   | ✅ caught    |                                               |
| an empty account exporting null        | ✅ caught    |                                               |
| the entries list left unsorted         | ❌ missed    | the fixture inserted them in ascending order  |
| the plans list left unsorted           | ❌ missed    | the test compared two exports — both unsorted |
| a timestamp built from `new Date()`    | ❌ missed    | the two calls landed in the same millisecond  |
| the activities list left unsorted      | ❌ missed    | same as plans                                 |

The fixture now inserts sessions and plans out of order on purpose, each list is asked about its
own key rather than about agreeing with a second copy of itself, and the byte-for-byte comparison
has a few milliseconds between its two calls. All seven go red now.

Reasoning and the standing privilege check are in `docs/2026-10-13-chronicle-export.sql`, applied
as `chronicle_export`.

**Left for Evan**: the Account page's backup card names its four things precisely, so nothing there
has become untrue — but somebody looking for "save my data" would look at Account first and find a
card that does not mention chronicle. Whether that earns a line there is a call about that page.

## 7 · What is deliberately not being ported

- **Money.** Decision 2 above.
- **The alarm clock, the meditation bell and the toast notifications.** A browser tab is not a
  reliable alarm — it must be open and awake — and the site already makes sound in two rooms. If
  alarms are wanted they are a separate decision about notifications, not a panel.
- **`onlinePeriods` / presence.** The site has real presence through the relay and the party; a
  second idea of "online" would be a second answer to the same question.
- **The `lib` panel**, until it is clear what it holds that `member_library` does not.

---

## 8 · Open, for Evan

1. ~~**Apply §5?**~~ Applied 12 Oct 2026.
2. **`quarter` in the scope list**: worth having, or noise? Still unanswered, so the room shows a
   "This quarter" window — because a scope the table accepts and no view shows is a goal somebody
   can create and never see again. Removing the view is one line; narrowing the check constraint
   behind it would not be, which is why the view came first.
3. **Does a goal need a category** (`locked`/`free`/`life`) the way an activity does? It would make
   "what am I aiming at that is actually mine" askable. Left out as something easier to add than to
   remove.
4. **The two feel questions the room raises**, now that it exists: whether ticking should wait for
   the server (it does — there is no local copy, deliberately, see `src/chronicle/cloud.ts`), and
   whether the counts on the window strip should show unfinished work or everything. They show
   unfinished, on the grounds that a total is not news.
5. **`localISO` lives in `src/circuit/dates.ts`** and chronicle imports it from there, which is
   backwards semantically — a time module importing the Circuit's clock. One home for the decision
   beat tidiness while chronicle is the newer of the two; worth moving to a neutral place if a
   third room ever needs it. The Sunday-week rule is likewise duplicated in `Feed.tsx`, and both
   copies now say so.
