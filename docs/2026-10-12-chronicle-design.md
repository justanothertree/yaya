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

## 6aa · ✅ And back in again — plus two things only pressing it could find

§6z gave the room a file. A copy you cannot put back does not survive anything, so this is the
other half rather than a feature of its own: **⬆ Put one back**, beside the save.

**One rule, two jobs.** `on conflict (id) do nothing` on every insert. It is the promise the
Account page already makes about the other backup — adds what is missing, leaves what you have
alone, so restoring onto a machine used since cannot overwrite the newer thing with the older. And
it is a door: a file can be edited by anybody, so an import naming a row id belonging to **somebody
else** must not write to it. It cannot — the row exists, the insert is skipped, that row's owner is
never consulted or changed. There is no update path in `chronicle_import` at all, which is why
there is no update path that reaches a stranger.

**Row by row, inside its own exception block**, which is slower than one statement and the only
honest option: these tables carry real check constraints, and a set-based insert fails _entirely_
on the first row that breaks one. Restating those constraints in the function would be a second
copy of the rules that drifts from the table. So the table stays the authority, a row it refuses is
counted, and the rest still go in — measured: a goal breaking a constraint is skipped while a valid
goal beside it lands.

**The round trip is the test.** Export, delete exactly those rows, import, export again: the two
documents are identical. Then it was done **again with every column set to a non-default value** —
`archived_at`, `done_at`, `anchor`, `progress`, `priority`, `est_mins`, `amount`, `quality`,
`colour`, `metric`, `session_mins`, routine steps, and `created_at`s dated 2024 — because the first
round trip proved less than it looked: its fixture left all of those at their defaults. That is the
same blindness as §6z's missing sort and §6x's life-scope window, for the **third** time in two
days. The matching harness test uses a file with every field filled, and deleting any one of nine
fields from the put-back now turns it red; before, dropping every rating left all 34 tests green.

A restored row also **keeps the day it was made** — `created_at` defaults to `now()`, so letting it
default would stamp a two-year-old backup with the moment it was restored, losing what the file was
carrying and making a round trip a thing that changes the data. That was a second migration; the
first had it wrong.

### What pressing the button found, that reading the code did not

Both of these look like perfectly ordinary code.

1. **The room did not repaint.** A put-back into an empty account restored 17 sessions and 11
   goals, the file came back byte-identical — and the page still said there was nothing here. The
   room reads once on mount and after its own edits; an import is an edit it did not make. It takes
   an `onPutBack` callback now, the same way `Timer` already took `onChange`.
2. **The room had no toast at all.** `<Toast/>` is mounted per room — the Circuit, Ratings, the
   Instrument and Account each mount their own — and chronicle never did. Every `showToast` the
   room made went nowhere, _including the export's failure messages shipped the day before_.
   Nothing noticed while the room had nothing to say; a put-back does, because a file that is not
   ours or one the account already holds changes nothing on screen, so the sentence is the only
   feedback there is. All five paths were then watched landing in the live region:

   | what was put back          | what it says                                      |
   | -------------------------- | ------------------------------------------------- |
   | the saved file             | `Added 39 — 17 sessions, 6 activities, 11 goals.` |
   | the same file again        | `Everything in that file was already here`        |
   | a songs backup             | `Not a chronicle file`                            |
   | a file from version 9      | `That file is from a newer version`               |
   | something that is not JSON | `That file could not be read`                     |

   Postgres writes exception messages in lower case, so a refusal arrived as "not a chronicle file"
   beside the room's own "That file could not be read"; sentence-cased where it is shown.

At 375 the row holds both buttons on one line, ending at 282px of 375, with the sentence wrapping
beneath — zero overflow at the document, the card and the row. 3,293 entries go back in **454ms**.

Reasoning and the standing privilege check are in `docs/2026-10-13-chronicle-import.sql`.

## 6ab · ✅ The session you started on the wrong thing

Everything about a finished session was editable except the one fact you were least able to get
right at the time: **what it was**. Pressing Start on the wrong activity is the likeliest mistake a
stopwatch allows, and the only remedy was to delete the session and type it in again — losing the
amount, the rating, and the day it was recorded.

`chronicle_entry_edit` takes the activity now, and the editor's first control is a list of your
activities — what it was, then when it was, which is the order the mistake happens in.

**Replacing a live function without breaking the page somebody has open.** `create or replace`
cannot add a parameter, and the overload it would create is worse than useless here: a
four-argument call would match both the old function and the new one's defaulted form, and Postgres
refuses that as _not unique_ — so the room would break for everybody rather than for nobody. The
answer is to drop and recreate with `p_activity uuid default null`, in one migration. PostgREST
matches by name and a defaulted parameter is optional, so the bundle already loaded in somebody's
browser goes on calling four arguments and still means "leave the activity alone". The behavioural
baseline says so rather than the reasoning: that exact call produces md5
`ef8a5486388a59e4c5f312d8e8ec8ae3` before and after, and the four refusals are word for word the
same.

**The check the foreign key would not have made.** A caller who can name one activity can name any
uuid, and somebody else's activity is a real row — so the reference would be _accepted_, leaving
that person with a session of their own pointing into another member's list and their minutes
landing in that member's totals from the other side. The activity is checked against
`auth.uid()`, not against the entry. An archived activity of your own is still allowed: archived
means put away, not gone, and refusing it would make a tidy-up irreversible for anything already
recorded against it.

Verified in the room: a session rated **5** moved from Drawing to Writing, kept its 5, and the
day's totals followed — Drawing left the list, Writing went to 35m. The amount box follows the
_selected_ activity rather than the one the session used to be, so moving a session onto something
that counts nothing takes the box away with it. At 375 the editor wraps to six rows with nothing
overflowing and nothing under 24px.

The pencil said "Change when this was"; it says "Change this session", because it no longer only
changes when.

Reasoning and the standing check are in `docs/2026-10-13-chronicle-entry-move.sql`.

### A sweep this came out of, and one thing it found elsewhere

§6aa ended with chronicle having sent toasts nobody could see, so every `showToast` caller was
traced to the room that renders it. Three of the four non-section senders are fine — `circuit/store`
is used by the Circuit and Ratings, `party/jam` only by the Instrument, `CircuitsPanel` only by the
Circuit, and all of those mount a `<Toast/>`.

The fourth is **`CircuitCanvas`, which App lazy-loads rather than a section**, and which confirms
its layout actions with `▣ Everything, fitted`, `▭ Fit to content` and `⊞ Windows tiled`. Measured
across every room: each has one `aria-live` region — but on Paint and the Visualiser that one is the
route announcer (`Section: Paint`, clipped to a pixel), not a toast host. So those three
confirmations are unseen when the canvas is open over either room.

Left alone deliberately: it is two rooms that are not chronicle's, the actions confirm something
you can watch happen, and whether those rooms want a toast host at all is a decision about them.
Named here rather than fixed.

## 6ac · ✅ The note you could write, never read, and then lost

Looking for other facts fixed at creation after §6ab turned up none — a goal's source and a plan's
activity are both already editable. What it turned up instead, in the handler that had just been
changed, was this:

```
editEntry(fixEnt, from, to, null)   ← the note, hard-coded, on every edit
```

and on the server, `note = nullif(btrim(coalesce(p_note, '')), '')`. Each half is unremarkable.
Together they are a delete: **opening a session's editor and pressing Save, changing nothing,
destroyed whatever you had written about it.** Measured in the harness before touching anything —
`"drafted chapter three"` → `null`, with no other field altered.

**It lasted because it was invisible.** Nothing on the page ever showed a session's note. There has
been a box for one beside Stop since the room was built — _"a note, if you like"_ — and the day list
rendered the activity, the length, the amount, the rating and whether it fell short, but never the
note. A **plan's** note has been rendered beside its plan all along, which is what makes the gap
plain once you look for it. So the field could be written, never read, and then quietly thrown
away: there was no screen on which the loss could show.

**The contract changed, not just the caller.** Fixing only the caller leaves the trap set — four
positional arguments where the fourth silently means "throw away what is there". Null now means
what it already means for `p_activity` one field up: leave it as it is. A caller that forgets the
argument can no longer lose somebody's writing, and clearing one has to be asked for with an empty
string. It also repairs the bundle people already have open, which passes null on every edit: that
stopped destroying notes the moment the migration landed, rather than whenever its owner next
reloads.

So the note is now three things it was not: **kept** through an edit, **shown** in the day list in
italics on its own line, and **editable** in the editor rather than only at Stop.

Verified by doing it: the editor opens holding the note, Save keeps it, rewriting trims
`"  rewrote the ending  "`, emptying the box clears it and the row stops showing one. At 375 the
editor wraps to five rows with no overflow at the row, the list, the card or the document, and
nothing under 24px. Four tests pin the rule; perturbed with the original bug, four go red.

Reasoning and the standing check are in `docs/2026-10-13-chronicle-entry-note.sql`.

## 6ad · ✅ The same erasure twice more, woken up by my own import

§6ac fixed a session's note being destroyed by its own editor. The thing that hid it was a field
written but never drawn, so this was a sweep for others — and it found the identical shape in two
more places:

| column                        | who writes it                                     | what the save function said                        |
| ----------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| `chronicle_activities.colour` | `saveActivity` passes **null** — no colour picker | `colour = nullif(btrim(coalesce(p_colour,'')),'')` |
| `chronicle_goals.note`        | `saveGoal` **omits the field** — no note box      | `note = p_note`                                    |

So every rename deleted an activity's colour, and every goal edit deleted a goal's note.

**They were harmless for the whole life of the room, and stopped being harmless this week.** Nothing
in the room can write either field — erasing a column that is always already null is a no-op. But
`chronicle_export` carries both and `chronicle_import` puts them back, so **from the day the import
shipped (§6aa), a restored file became the one way an activity can have a colour or a goal can have
a note** — and the next ordinary edit deleted it. My own feature is what made two dormant bugs
reachable, which is exactly what §2 of `CLAUDE.md` means by checking what a change made untrue; it
took two more ticks to notice.

Demonstrated before touching either function: import a file carrying `#aabbcc` and
`"because I keep meaning to"`, then make the room's own two calls — a rename and a re-save — and
both read NULL.

The fix is the entry's fix, twice: **null leaves the value alone, `''` clears it.** There is now one
rule for every optional field on every save path in this module — silence means "I am not talking
about this", never "throw it away".

After: the import's values survive a rename and a re-save, and those edits still take (renamed,
recategorised; retitled with a new scope, target and priority). `''` clears a colour, `'   '` clears
a goal note, a new activity still starts with none, and a new goal written _with_ a note keeps it
trimmed. The refusals are unchanged. Through the double, renaming an activity keeps its metric and
editing a goal keeps its tick, its progress and its source. Four tests; perturbed with the original
bugs, two go red each.

**Left for Evan, deliberately.** Both columns are still unreachable from the room — no colour picker
on an activity, no note box on a goal. They exist in the table, the type, the save path, the export
and the import, and nothing on screen writes or shows them. Making either visible is a design
decision about the room rather than a bug fix: a colour per activity would read instantly in a list
of bars, and a goal's note is the obvious home for "why this matters". Named rather than invented.

Reasoning and the standing check are in `docs/2026-10-13-chronicle-silent-erasures.sql`.

## 6ae · ✅ The sitting you are in the middle of

§6ab let you move a finished session to the activity you meant. The one you are _in_ could not be
touched at all — and the comment saying so gave a mechanical reason rather than a principled one:

> only a finished span can be edited: the editor needs both ends, and the running one is closed
> with Stop rather than by typing a time into it

The second half still holds. The first half had a cost: **the two mistakes you notice while
working both had the same remedy, which was to press Stop** — ending the session at a moment you
did not choose and leaving you to start a second one, which is a worse record of the day than the
one you were trying to fix. The two are pressing Start on the wrong activity, and pressing it
twenty minutes after you actually began.

`chronicle_running_fix` takes either, or both. It deliberately has **no `p_to`**: the one open
entry is open _because_ it has no end, typing one in is what Stop is for, and a second way to close
a session would carry none of Stop's own rules about notes and short sittings. The editor hides the
end box, the amount, the rating and the note while a session runs for the same reason — those are
things you say about a sitting once you know how it went.

It keeps the rules the rest of the module keeps: null leaves each field alone; a start cannot be in
the future or more than a day ago; and the activity is checked against `auth.uid()` rather than
against the entry, because a uuid naming somebody else's activity is a real row the foreign key
would happily accept.

Driven through the UI: the running row has a pencil for the first time — four on screen where there
were three — and its editor offers exactly four controls. **"Chronicle (on the site)" begun 7
minutes ago became "Gym" begun 26 minutes ago, and was still running afterwards.** A finished
session's editor is unchanged: two dates, the rating, the note box and the rest. At 375 the running
editor is three rows with no overflow and nothing under 24px.

Six tests, each made to fail — ending the session while correcting it (4 red), a start in the
future (1), somebody else's activity (1), null read as "clear it" (3), and correcting the last
entry rather than the open one (2).

Reasoning and the standing check are in `docs/2026-10-13-chronicle-running-fix.sql`.

### The sweep that opened the tick, and what it did not find

§6ad's rule — _a save that writes every column deletes the ones the caller forgot_ — was worth
asking about the rest of the site, where the save paths are older. Every `update` in a public
function was pulled apart and checked against its callers. The multi-column writers are
`update_my_profile` (10 columns), `set_my_nicknames` (3) and `set_my_profile_look` (4), and all
three are **whole-form saves**: the client holds the complete current state and sends every field,
which is the legitimate version of the pattern. The rest are single-field setters, which cannot
forget anything.

`set_my_profile_look` is the one that could have gone wrong differently — it writes from an effect
rather than from a form — and it already carries a `lookMirrored` guard, with a comment recording
the bug it was added for: _"six hundred milliseconds after signing in, the look on your profile was
replaced by 'dark, no palette, no flair, no backdrop', silently, having chosen nothing."_ An honest
negative result: the three instances were chronicle's own.

## 6af · ✅ The one screen every member sees exactly once

Six ticks of additions later, the room was read end to end in the state nobody had looked at since:
**signed in, with nothing recorded**. Every word on screen was pulled out and checked against what
the code does.

The explainer is still true — "Two halves", the three numbered steps, the signed-out blurb. The day
list says "Nothing recorded for this day yet.", the goal list says "Nothing here yet.", and both
collapsed sections explain themselves when opened. What was wrong was smaller and worse.

**Three controls are dead on a fresh account, and a phone was told nothing about any of them.**
Start, Fill a gap and Plan a span are all correctly disabled — there is nothing to time yet. The
explanations were: `cursor: not-allowed`, which no touch screen has, and a `title` on exactly one
of the three, which is a tooltip and does not exist on a phone either. Measured rather than
eyeballed, because the screenshot misled me first: all three are `opacity: 0.6`, so the bright
green Start **is** dimmed and simply does not look it against a dark card.

| control          | disabled | what said why                 |
| ---------------- | -------- | ----------------------------- |
| `▶ Start`       | yes      | nothing                       |
| `⏱ Fill a gap`  | yes      | a `title` — a desktop tooltip |
| `＋ Plan a span` | yes      | nothing                       |

**The room already knew how to say it, one section down.** The Planned details reads _"Name an
activity with ＋ Activity first — a plan is a stretch of a day set aside for one of them."_ So the
fix is that sentence, where the dead buttons actually are and in the same shape, so the two do not
read as different rules:

> Name an activity with ＋ Activity first — the stopwatch times one of them.

It appears only while there are no activities, and the check that matters is that it **goes**: a
permanent nag would be worse than the gap. Verified by naming one — the line disappears, the picker
fills, Fill a gap enables, and Start's new tooltip correctly vanishes. Start stays disabled until
you pick, which needs no words because the control saying "Pick an activity…" is beside it.

At 375 the line wraps to two lines, 302px wide, unclipped, with no overflow at the card or the
document. Four things do sit past the right edge — "This month" through "Years" — and all four are
inside `.chron-strip`, which is `overflow-x: auto` and genuinely scrolls: the deliberate pattern,
like a piano keyboard, not a defect.

**What this did not find** is worth recording too, because it was the thing I went looking for: six
ticks of additions — the export, the import, a session's note, a moveable session, a correctable
running one — added nothing the explainer now gets wrong. The additions are all corrections and
exits, which is why: none of them changed what the room is **for**.

## 6ag · ✅ Three answers from Evan, and what each one cost

He came back to the open questions. Two were answered outright and one was deferred, which is as
useful as an answer.

### "quarter is not worth a tab"

Gone. It was only ever there because the table allows the scope and §8 could not answer whether it
was useful — and a scope the database accepts with no view to show it is a goal somebody can create
and never see again.

Removing it is safe for a reason worth stating rather than assuming: **a goal takes the scope of the
tab it is added from**, so with no quarter tab the room can no longer make one. There are no
quarter goals in any account — checked, not guessed. The check constraint still accepts the word
deliberately: narrowing it would strand an older file's goal on _import_ rather than merely hiding
it, and widening again if the answer ever changes is one statement where restoring the type and the
window maths would not be. That leaves one door, an imported file that already contains one, and if
it ever opens the row is invisible rather than lost.

### "circuit should sit on chronicle, but I'm not confident yet — don't muddy things"

Not done, deliberately, and recorded here so the next person reading does not take the first half of
that sentence as a go-ahead. The direction he gave alongside it: chronicle should eventually be
**tied to account and profile status if shared**, with a **profile block for the goals or stats**.
Both of those need the visibility story first — which tier a block sits in, and what "anyone" means
for a record of somebody's days — and that is exactly the decision he is not ready to make. Nothing
built here forecloses it: chronicle's data is reached only through `SECURITY DEFINER` RPCs that
check `auth.uid()`, which is the same shape `profile_blocks` already uses.

### "I like things being customizable"

That was the answer to a question I had been holding since §6ad: **an activity's colour and a goal's
note exist in the table, the type, the save path, the export and the import, and nothing on screen
writes or shows either.** Both now do.

**The rule that shaped both:** a way to write a field without a way to read it is what made three
bugs invisible this week, so neither shipped without its other half. The colour is a dot beside the
activity name in **both** places the name is drawn — the day log and the Activities list. The note is
a line under the goal's title.

**The colour is a fixed palette, not a picker**, which is a deliberate narrowing of what the column
allows. `<input type="color">` can return `#000000`, and this site has a near-black card _and_ a
light theme, so a free choice can produce a dot nobody can see with no way to tell you have done it.
Eight mid-luminance colours plus a ✕ for none — nine taps rather than an OS modal with a spectrum in
it. The server does not enforce the list and should not: the column is free text, an imported file
may carry any colour an older row had, and refusing it on the way in would lose data to a
preference.

Three tests guard the palette, because a typo in it is **invisible rather than broken** — `#3d9ae`
hands `background:` something it cannot parse and the dot silently does not render. Perturbed four
ways: a truncated hex, one too dark for the dark card, one too pale for the light page, and a
duplicate. All four go red.

**The goal's box asks "why", not "note"**, because the field is only worth a box if it asks a
question somebody wants to answer. A title says _what_; the thing that goes stale about a goal is
the reason you set it, which is what you want back in March about something written in January.

Driven through the room: picking the blue stores `#3d9ae5` and **two dots appear**; pressing ✕ and
saving clears it and both dots go, with the name, category and sitting length untouched. A goal
saved with `"  because I keep putting it off  "` stores it trimmed, shows it under the title, loads
it back into the editor, and keeps it when the title is changed. At 375 the nine swatches sit on one
line at 28×28 — above the 24px floor, in pixels because the root size is fluid — with no overflow at
the row, the card or the document.

## 6ah · ✅ Tablet, and the colour's third place

### The viewport nobody had checked

§6 of `CLAUDE.md` asks for phone, tablet and desktop. The room had been measured at 375 and 1440
over and over and **never at ~820**, which is its own band: above the 700px single-column collapse,
below the appearance tray's 56rem breakpoint.

Clean, at both 820 and 768, with the room seeded and all three editors open — zero overflow at the
document, `main`, the card, each list and each row; nothing past the right edge; nothing clipped.
The only elements that scroll are `sr-only` spans, which are meant to be clipped to a pixel.

Two things are worth keeping from the method rather than the result. The **smallest control is 28px**
(a colour swatch), above the 24px floor, and the editors wrap to 3–4 lines rather than overflowing.
And 820 **does not emulate touch** — the pane only does that below 768 — so `(pointer: coarse)` rules
do not apply there; checked, and not one of the site's coarse-pointer rules touches chronicle, so
the measurements hold for a real tablet. A side effect of dropping the quarter tab: the horizon
strip now just fits at 768 instead of scrolling.

### The colour, in the third of three places

§6ag gave an activity a colour and drew it in two places: the day log and the Activities fold. The
third is `Looking`'s bars — the week, month and year views — which is where scanning by colour
actually pays, and a feature that appears in two of three places is the "half exists" that
`nav/places.ts` was written about.

The row carries it now rather than the view looking it up: `chronicle_totals` already returns name,
cat, auto and metric for exactly that reason, and a colour is the same kind of fact. **It needed no
drop and breaks nothing** — the function returns a `jsonb` document rather than a table, so the
signature is unchanged and a bundle somebody has open receives one extra key and ignores it.

Checked by stripping the new key back out of the answer: the result is `5c803ef7e77e74cdc7bfdd836dd7f07d`,
the same md5 as before the change, so nothing else moved. Every row carries the key, both refusals
are word for word, and 395 days over 3,293 entries is still **3.0ms**.

The risk in a dot is the name beside it: `.chron-bar-label` ellipsises, so ~13px of dot could push a
name that fitted over the edge. Measured with **every** activity coloured — the holder is 159px, the
longest fitting label 57px, and the set of ellipsised labels is identical with and without dots.
The one that clips, "Chronicle (on the site)", clipped before.

## 6ai · ✅ The week as a grid — and what "parity" was actually checked against

Evan put the two side by side: the HTML app and this room. _"i know its not in html and its now on
my site but even the ui is so much cooler in the html."_ He is right, and the reason I missed it is
the useful part.

**The parity list was checked against the HTML app's STORE.** Every field in it is built, which is
why §6 could honestly say parity was closed. What a store cannot tell you is the SHAPE of the app
around it — and the shape is most of what makes one feel better than another. The HTML app has a
week grid, a right rail with a daily score, top-level nav, a live clock. This room had a card with a
paragraph of prose and some folds. Same data; a settings page.

**A list of "Drawing 35m" and a block sitting at nine in the morning are the same data, and only
one of them shows you your mornings are empty.**

### The grid

Seven columns, hours down, every session a block where it happened. Today is outlined, the clock is
a line across it, a session across midnight appears in both days with square edges saying it
continues, and a block takes the activity's own colour when it has one — the thing §6ag added — and
its category's when it does not.

**It reuses `lane` rather than measuring again.** The day strip already answers "where does this
span sit in this window, as percentages" and has tests that say so; a column is that question
turned ninety degrees, so `left` becomes `top` and `width` becomes `height`. A second copy of the
arithmetic would be a second place for the midnight rule to be wrong.

Twelve tests on `week.ts`, each written from a clock reading rather than from the code: a nine-to-ten
session sits 9/24 down and is 1/24 tall. Perturbed five ways — a Monday-based week, a day measured
from the wrong end, the clock marked on every column, `covered` left unclamped, midnight labelled
"0a" — and all five go red.

### Three things it cost, which is the honest part

**`--good` and `--link` do not exist.** I wrote the block colours against two variables I had
invented, and the computed background came back `rgba(0,0,0,0)` — transparent, on a dark card,
which looks exactly like a block that failed to render. The three category colours were already
literals in **three** places, and this would have been a fourth; they are declared once on `.chron`
now, deliberately NOT as `--accent` (which is themeable, and an orange accent would collide Locked
In with Free Time). The chips, the day strip and the week bars all render identically afterwards —
checked, because a consolidation that changes a colour is not a consolidation.

**`Week.tsx` beside `week.ts` will not compile.** They differ only in casing, and the filesystem
cannot hold both. `Plans.tsx` beside `plan.ts` dodges it by number; this is `WeekGrid.tsx`, which
dodges it by saying what the component draws.

**190px for twenty-four hours is eight pixels an hour**, and a half-hour sitting was a hairline —
in the right place and readable as nothing. 240px makes an hour ten pixels, which is the point at
which this room's commonest session is a mark you can see, without the grid pushing the day's log
off the screen.

### And one number that only a screen reader could hear

Each column knows how much of its day is accounted for; it was in every day button's label and
nowhere else. That is the write-without-read that cost this room three bugs in a week, committed
afresh in the thing I had just built. It says it out loud now — and over **the days that have
started**, not seven, because a Tuesday afternoon measured against a whole week is 29% at best and
reads as failure.

### What is still missing from that screenshot

Named rather than built, so the gap is written down: a right rail (daily score, goals today, alarms,
to-do, upcoming), top-level nav instead of folds, a live clock, the "what's next?" banner, and
quick-start chips with more presence than the current "or just". The grid was the centrepiece and
the one real absence; the rest is arrangement, and arrangement is a decision about the room.

## 6aj · ✅ The rail — and three of its five panels left unbuilt on purpose

The second half of what the screenshot comparison showed. The HTML app's sidebar carries five
things; **two of them are facts chronicle already had and was throwing away**, and the other three
are not, so they are named here rather than faked.

| panel       | built | why                                                                                                                                                         |
| ----------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily score | ✅    | every number in it is already in the day's totals                                                                                                           |
| Upcoming    | ✅    | a plan is already "a span you intend" — this is the ones still ahead                                                                                        |
| Alarms      | ❌    | a new table, a permission, and a delivery mechanism. A notification is not something a page can promise while it is closed — that is a feature, not a panel |
| To-do       | ❌    | the goals half **is** the to-do list. A second list of things to do, beside a list of things to do, is two places for one item to be finished in            |
| Goals today | ❌    | that is the Today tab, four inches below, which already counts itself                                                                                       |

**An empty panel headed "Alarms" is worse than no panel**, which is the whole reason for the second
column of that table.

### The score

The big number is the share of what you wrote down that was Locked In, and the word under it says
which share — _a percentage with no noun is the thing a dashboard does that nobody can read_.
Beside it: focused, written down, and how much of the whole day is accounted for.

`scoreOf` is pure and takes `{cat, mins}` rather than the `Total` rows it will be handed, because
`Total` lives in cloud.ts, cloud.ts imports record.ts, and a scoring module importing cloud.ts
would close that ring. Eight tests; perturbed four ways — **`NaN%` on an empty day**, Free Time
counted as focused, `covered` unclamped, a twelve-hour day — all red. The NaN one is the test that
earns its place: a new member has recorded nothing, so the first screen computes 0/0.

It reads the day's **totals**, not its entries — the same sum the bars and goals are drawn from, so
the rail cannot disagree with the list beside it about how long something took.

### Two things the room told me

**"7:00 AM" read at nine at night is a time that has already gone.** The list looks to the end of
tomorrow, so most of what it shows in an evening is tomorrow's, and a bare clock time says the
opposite of what it means. Days other than today are named now; today's keep the bare time, because
a "Today" on every row is noise.

**A rename that only changes a filename needs the dev server restarted.** After `Week.tsx` became
`WeekGrid.tsx`, Vite went on resolving `week.ts` to the old entry — case-insensitive filesystem —
and served a module with no `columns` export. The whole app rendered blank, the console said
`does not provide an export named 'columns'`, and **`npm run build` passed the entire time**,
because the build starts from a clean graph. A blank page with a passing build is a stale dev
server, not a broken source.

### Where it sits

Beside the timer at 900px and up, under it below — **not** the page's own 700px breakpoint, because
this card is one cell of that grid and a rail beside a stopwatch needs room for both. Measured at
1280 (881px main + 264px rail), 899 (one column, rail full width below) and 375 (327px, no
overflow, nothing past the edge).

## 6ak · ✅ The header — a clock, the hole, and chips that say which

The last of what the screenshot comparison showed, and the one where the HTML app's own copy was
worth disagreeing with.

**A wall clock, in its own component.** If it lived in `Timer` the whole room would redraw once a
second — the day's log, the week grid, the plans, the routines, the activity fold — all to move a
colon, and the grid alone is seven columns of absolutely positioned blocks. A component that owns
its own tick redraws eleven characters. Only on today, because a wall clock beside a day you are
reading back is the time somewhere else. And `hour: 'numeric'`, because "09:37:05 PM" is a 24-hour
habit worn by a 12-hour clock.

**The hole, not the status.** The HTML app's banner says _"Timer stopped — keep every minute
tracked"_ over _"1% better every day starts with awareness"_. The first half is a fact the Start
button two inches away already carries; the second is a voice this site does not use. What neither
says, and what only a time tracker can tell you, is that **it is nine in the evening and nothing has
been written down since lunch**:

> **2h 25m** unaccounted since Dishes.

That is the number `⏱ Fill a gap` exists to close, and the room had never said it. `gapSince` is
pure, with six tests and three perturbations — a running session still reporting a gap, an end in
the future counting, taking the last in the list rather than the latest. It stays quiet under ten
minutes, because a gap of two minutes is the pause between stopping one thing and starting the
next, and a line reporting that on every stop is a room that nags.

**Chips that say which.** The quick row was `or just [Dishes] [Writing]` — the right idea with no
presence. It is a labelled row of pills now, and where an activity has a colour the ▶ becomes its
dot: the triangle says "this starts something", which the row's own label already says, while the
colour says _which_ thing — the same dot the day log, the week grid and the rail all draw.

### And one measurement that looked wrong and was not

The 375 screenshot came back visibly clipped — Start cut off, a chip cut off, the last day column
missing — while every number said clean. The numbers were right. Each element's rect is inside 375
(the card ends at 365, Start at 339), `scrollWidth === clientWidth === 375`, and the only things
past the edge are the horizon tabs in their deliberately-scrolling strip. **The screenshot's own
coordinate frame was 469 for a 375 viewport**: the pane was rendering a window onto the emulation
rather than the whole of it, so the image was a crop.

The existing rule is "measure, then look", written after three layout fixes measured perfectly and
had destroyed the page. This is its mirror: a clipped-looking screenshot at an emulated width is not
evidence of a clipped layout. **When the two disagree, ask the rects for the specific elements that
look wrong** — which is cheap, and settles it either way.

## 6al · ✅ The month as a calendar, and the fourth blind fixture

The HTML app has Calendar as a top-level tab; this room had a month view that could only say
_what_ the month held, in bars. The calendar says **which days**.

**It answers a different question from the week grid**, which is why both exist rather than one
replacing the other. The week shows WHEN inside a day — that the mornings are empty. A month
cannot: twenty-four hours in a cell an inch wide is four pixels an hour, and a block in it would be
a speck. A month shows the shape of a _habit_ rather than the shape of a day, and the seeded month
says it plainly: the run from the 4th to the 13th, the 10th heaviest, nothing since.

`lane` does the arithmetic for the third time — the day strip, the week grid, now this. All three
ask "how much of this window does this span cover", and the one that gets midnight wrong gets it
wrong everywhere.

### Three decisions worth the words

**The padding days are real days.** A month starting on a Thursday has the Sunday to Wednesday
before it in its first row, and those days have time in them. A calendar that drew them blank would
be lying about them to keep its own edges tidy — they are measured like any other and dimmed.

**The fill is a share of the busiest day, not of twenty-four hours.** This room already reached that
answer once: `Looking`'s bars are "a share of the BIGGEST rather than of the total". A calendar has
it worse — nobody records sixteen hours, so against a whole day every cell was a **2px hairline**
(measured: 4–8% of a 34px cell) and the month read as empty whatever was in it. The absolute number
is still the one it _says_, in the label and the title, because "tallest" is not a quantity.

**The cells do not click, deliberately rather than unfinished.** The day this half of the room is
about comes from the horizon view itself, so there is no cursor here to move — where the week grid
sits beside a stopwatch that owns one. A cell that looked pressable and did nothing would be worse
than a cell that does not.

Contrast was measured rather than eyeballed, because on the busiest day the fill rises behind the
whole cell: **5.79** for the number over a full fill and **9.94** over an empty one, against WCAG's
4.5 for small text. At 375 the seven columns are 44×34 with no overflow at the grid, the month, the
card or the document.

### And the fourth blind fixture in a week

Thirteen tests, perturbed four ways. Three went red. **Deleting the trailing-padding line left all
twelve green** — because October 2026 ends on a Saturday, so that month needs no trailing padding,
and the test asserting "nothing follows" is true whether or not the code pads at all. My own test
comment said _"it ends on a Saturday, so nothing follows"_: I noticed the property and then rested
the check on it.

November 2026 runs Sunday the 1st to Monday the 30th, so its last row needs five days of December or
it is ragged. With that test added, the same perturbation is red.

That is the same shape as the life-scope window in `chronicle_tally` and the two round-trip
fixtures sitting on defaults — **the fixture was tidy in exactly the dimension under test**, four
times now. `CLAUDE.md` §2 already carries the rule; what this adds is that "tidy" includes _a
calendar month that happens to end on a Saturday_.

## 6am · ✅ The stock-take, and the half of `DURATION` worth having

### The nav question, answered by measuring

The one structural thing left against the HTML app was its section nav — Dashboard / Log / Calendar
/ Goals / Activities — against this room's single long card. I had been treating that as Evan's
call, and the reason to raise it at all was that the room has grown a lot.

**Measured at 375, with the folds closed: 2,046px — 2.5 screens.** For a room holding a stopwatch, a
day's log, a week grid, a rail and a goals list, that is ordinary. The parts: timer card 867,
goals-and-below 674, week grid 302, rail 270, explainer 110.

So the nav would be **solving a problem the room does not have**, and a second tab row would sit
above the horizon tabs that are already there, on a different axis — sections versus time windows —
which is the arrangement most likely to confuse. Not built, and now not pending either: it is
declined on a number rather than left open.

### What the stock-take did find

The HTML's start form takes **ACTIVITY / CATEGORY / DURATION**. This room has no duration — but it
has known one all along: `session_mins`, set once per activity rather than typed on every start.

What it did with it was the wrong half. `metSession` reads the target to mark a **finished** sitting
SHORT, so the room could tell you that you stopped early and never that you were about to. "Seven
minutes left" is a reason to keep going; "short" is a verdict on something already over.

A running sitting now carries its target: a thin bar and the sentence `16m left of 25m`, or
`25m done` once it is past. Three states verified in the room — under (28.6% of 30, from 8.5
minutes), past (100%, "5m done"), and no target at all, where nothing is drawn.

`sitting()` is pure, six tests, four perturbations: `over` clamped along with the bar, met only
_after_ the target rather than at it, time left going negative, and the bar running past its own
end. All four red. **The clamp is on the bar and not on the fact** — a bar drawn past its end is a
rendering fault, where a sitting that ran long is an ordinary and good thing, so `over` has to
survive where `pct` stops.

## 6an · ✅ Four zeros at a new member, and the bug they uncovered

The empty state was last read at §6af, before the week grid, the rail, the calendar and the sitting
target all landed on top of each other. Read again, cold.

**A brand-new member was told "0%" four times before doing anything.** An empty seven-column grid
with an hour scale beside it, then _"0% of these 4 days is written down"_ — a reproach about days
they had not been a member for — then a rail whose single most prominent element was a large **0%**,
with `Focused 0m`, `Written down 0m` and `0% of the day` under it. The one sentence that mattered,
_"Name an activity with ＋ Activity first"_, was competing with a dashboard of nothing.

The grid and the rail now wait. **The condition is activities, not entries**, and the difference is
the whole argument: an empty week for somebody who HAS activities is a real answer — "you did
nothing this week" is worth seeing — while an empty week for somebody with no activities cannot be
anything else, because an entry needs an activity to point at. Nothing can be hidden that way.

Measured on a fresh account: **1,574px and four zeros → 1,042px and none**, 1.9 screens to 1.3. The
`.chron-body` grid also had to stop reserving the rail's 15rem column when there is no rail, or a
new member got a strip of nothing beside a squeezed stopwatch.

### And then the rail would not come back

Naming an activity made the grid appear and the rail did not — so the gate was checked rather than
trusted, and it was not the gate. **Chronicle's own activity list was stale.** The Timer's picker
had "Drawing" in it; the goals half still thought it had none.

The cause is one word, in a file where the right version sits twelve lines away. `saveAct` — the
EDIT path — ends with `await after()`, which reloads and then calls `onChange`, which is how the
goals half hears about anything. `makeActivity` — the ADD path — ended with `await load()`, which
tells only itself. Archive had the same omission.

**What that actually cost, before any of this week's work existed:** the goal form's source picker
is hidden when the activity list is empty, so after naming your FIRST activity you could not point
a goal at it — the "from Drawing" option simply was not offered until something else reloaded the
page. The first goal a new member sets is exactly the one most likely to want a source.

It was invisible because nothing on screen contradicted it: an empty list that should have had one
thing in it looks like an empty list. The rail is what made it visible, by being a second reader of
the same list that could be seen to be missing. Verified after the fix, through the room's own
controls rather than through cloud calls: grid, rail, and the goal form offering **"Drawing"**.

## 6ao · ✅ Two more readers that could not hear

§6an found one half of the room not telling the other about a new activity. The same question asked
of every component: **which of these fetch their own data, and what tells them it changed?**

Five do. `Rail` takes a counter. `Plans` is handed the day's entries as a prop and fetches only its
own plans, which nothing else writes. `Routines` likewise. The other two could not hear anything:

| component   | fetches                  | told when the record changes |
| ----------- | ------------------------ | ---------------------------- |
| `Rail`      | the day's totals, plans  | yes, `tick`                  |
| `Looking`   | a window's totals, moods | **no**                       |
| `MonthGrid` | a month's entries        | **no**                       |

It is structural rather than incidental: neither is handed anything that changes when a timer
stops, so no re-render could refresh them — their `useCallback` dependencies are the window and the
date, and both stay put. Measured before the fix: two hours added and the month headline still read
`11h 28m`, the calendar still ten fills.

Both take the same `beat` the rail does. Verified through the room's own controls rather than
through cloud calls, which is what the last tick's false start taught: pressing **Stop** moved the
calendar's today cell from `1h 39m recorded` to `1h 40m`, and filling an hour-long gap moved Gym's
month bar from `2h 15m` to `3h 15m`.

**One reading needed care.** Today's cell did not change when the gap landed, and the entry count
for today stayed at five — correct, not a failure: it was past one in the morning, so "nine hours
ago" is yesterday afternoon. The month total moved and the day's did not, which is exactly right,
and is the sort of thing that reads as a broken refresh if the clock is not checked.

## 6ap · ✅ Two sentences the room said that were not true

Found by walking the whole room from a blank account through its own controls, which is the thing
that keeps earning its cost: both of these are right arithmetic attached to a wrong claim, so
neither could have been found by reading the code for mistakes.

### "100% Locked In" above "Focused 0s"

Two seconds after pressing Start, the rail read **100% Locked In**, and four inches under it the
day's totals read `Focused 0s · Written down 0s`. Every one of those numbers was correctly
computed: two seconds of a Locked In activity really is 100% of everything recorded today. It is
still four statements that contradict each other on one screen, and the reader is right and the
room is wrong.

A proportion needs something to be a proportion of, and **a minute is the unit this room writes
everything else in** — `spanText` rounds to it, the totals are in it, a goal's target is in it. So
`scoreOf` now withholds `share` below one logged minute rather than dividing by a scrap:

```ts
share: logged >= 1 ? (focused / logged) * 100 : null,
```

`null` rather than `0`, because those are different facts and the rail says so — `— nothing yet`
against `0% Locked In`. Zero is a verdict on a day you spent badly; it should not also be what an
empty day says. The same `null` already covers the 0/0 case a new member sees, where the
alternative was `NaN%` at the top of the first screen.

The minutes themselves are never withheld — only the ratio. A 30-second sitting is still 30
seconds in the totals.

### "60 / 30 done" on a row counting minutes

Pointing a goal at an activity and asking for 30 minutes produced a row reading **60 / 30 done**,
two inches below the room's own seeded goals reading `35 / 30 minutes`. A target always carrying a
unit was the right rule; the DEFAULT was the bug. Everything fell back to `'done'`, including the
cases where the room already knew the answer:

- a derived goal counting **time** is counting minutes — there is nothing else it could be;
- one counting an **amount** is counting the activity's own metric, the word already typed against
  it: `pages`, `reps`;
- only a goal you move **by hand** has a number nobody can name, and `done` is honest for exactly
  that one.

So the box stays optional and is filled in from what is known. A typed word still wins, always —
this fills an empty box, it does not correct anybody, and somebody counting an activity's minutes
who calls them `pomodoros` means pomodoros.

### Both now live where they can be asked a question

`unitFor` went into `goal.ts` rather than staying a closure in `Chronicle.tsx`, for the reason the
standard gives: a unit rule inside JSX cannot be asked what it thinks, and this one is four
branches about a word a reader will see for months. Seven tests in `goal.test.ts`, written as the
sentence the row says rather than as the branch the function takes, and the fixture is an activity
with **every field non-default** so a rule reading the wrong field has somewhere to be wrong — the
metric is not the name and the name is not the category.

Both were made to fail once, from scratchpad copies. Perturbing `goal.ts` back to a bare
`return 'done'` turned four of the seven red; loosening `score.ts` to `logged > 0` turned exactly
one red — the under-a-minute case, and nothing else. Then verified a third time through the room's
own form, which is where the claim actually lives: `0 / 30 minutes`, `0 / 20 pages`,
`35 / 300 minutes` for a category source, `0 / 12 done` for one moved by hand.

## 6aq · ✅ Putting a copy back told half the room

Walking the rest of the flow — plan a span, run a routine, export, put it back — through the room's
own controls rather than through its functions.

**The routine works end to end.** Clicking a step starts that activity's timer and stops whatever
was running; the step ticks to ✓ once there is a minute against it, and the heading went from
"2 of 3" to "all done today". The entry editor prefills every field it owns — started, ended, the
metric, the rating, the note — and **a Save with nothing changed erased nothing**, which is the
check §8 of the standard exists for.

**The import did not.** `YourCopy` already calls `onPutBack()`, with a comment describing exactly
this symptom from an earlier sitting — but `onPutBack` was `() => void load()`, and `load()` is the
GOALS half. The stopwatch half fetches its own activities and its own day, so a put-back into an
empty account restored seven activities, seventeen sessions and eleven goals, filled the goal list
in, and left the bigger half of the room saying **"Name an activity with ＋ Activity first"** over
an empty picker and an empty log — indefinitely, not briefly. Measured over eight seconds: the
goals went 0 → 4 and the picker stayed at one option.

The fix is the same `beat` that `Looking` and `MonthGrid` already take, for the third time and the
same reason: a component that fetches its own data hears nothing when something else rewrites the
record. `Timer` now takes `beat`, the put-back bumps it, and both halves fill in together.

**The round trip itself is clean**, compared field by field rather than by counts: all five
collections — activities, entries, goals, plans, routines — came back byte-identical through the
room's own ⬇ Save a copy and ⬆ Put one back, with the toast reading "Added 40 — 17 sessions, 7
activities, 11 goals."

### Two ways the double was lying, both found the same way

**The planner "silently did nothing" for an hour, and had saved everything.** The form closed, the
save returned `{ id: 'pv-p-new-9' }`, and the store read back four unchanged plans. All three
readings were of **different module instances**: Vite's HMR binds the app to
`/src/dev/chroniclePreview.ts?t=1791958465904` after any hot update, so a probe importing the plain
path gets a second store and the extensionless specifier a third. The tell is the minted id — a
store handing out `-new-1` while holding rows called `-new-7`, `-8`, `-9` is not that store. Now in
CLAUDE.md with the recipe for reaching the app's own instance; the short version is to believe the
page over any module read, and the page had been right from the first submission.

**And the seed was inventing a state the server cannot reach.** `pvVisit` finds its auto activity
the way `chronicle_visit` does — one per room, matched on `auto && name === room` — but the seed
called it `Chronicle (on the site)` where the room's title is `Chronicle`, so the first visit minted
a SECOND auto activity beside it. Two auto rows for one room is not a state the product has code to
produce. Renamed; and since `Looking` already draws an "on the site" chip for an auto row, the old
name was saying it twice anyway. The long name it used to provide — which two layout decisions in
this room were made against and say so — moved to an ordinary activity so the stress case survives.

**The third thing the seed could not test was colour.** Every activity in it had `colour: null`,
which is the exact column with an erasure history here (a restored file is the only way an activity
can get one, and a rename used to delete it). A round trip is worth only the fields its fixture
fills, so three activities now carry one and Dishes deliberately keeps the null. Re-checked
afterwards: the colours survive the round trip, and a rename keeps them.

**At 375 with that data in the room**: no sideways scroll, nothing past the edge, nothing clipped,
nothing under the 24px floor, and no container overflowing its list or card. The one zero-width
element is `.chron-ent-when` under a deliberate `display: none` — "a timestamp range is the first
thing worth dropping when a row will not fit a thumb".

## 6ar · ✅ What chronicle made untrue on the Account page

§2 of the standard says to look for what a change just made stale, and this is the one chronicle
made: the Account page's backup card says **"A file is the copy that survives losing the account"**,
which was true of everything on the account when it was written. Chronicle then arrived with its own
record — sessions, goals, routines, plans — and its own ⬇ Save a copy, which that file knows nothing
about. A promise that has quietly narrowed is worse than no promise, because somebody takes one file
and believes they have everything. The card now says so in a line.

Two things were already wrong there, and reading the card to add that line is what found them.

**The summary omitted a kind the Save button counted.** The line was written by hand as
`${songs} songs · ${art} drawings · ${looks} looks` while `total` — the number deciding whether
⬇ Save a copy is even ENABLED — summed a fourth, minions. So an account holding nothing but minions
got a live Save button over a line reading "0 songs · 0 drawings · 0 looks", and a file with their
minions in it.

**And park records were in neither.** `makeBackup` has packed them since it was written and
`restoreBackup` reports them arriving — "Park records: 3 brought over" — but nothing counted them on
the way out, so a member whose only keepsake was a run of records had Save **disabled** and no way to
take them anywhere.

Both are the same shape: a list of kinds typed into JSX cannot be kept level with a list of kinds
summed four lines above it. `backupSays` and `backupTotal` are now one table that answers both, and
the test asks by SUM rather than by naming the kinds — a test listing them would be a third copy of
the list, which is the thing that broke. Perturbed back to three kinds, five of the eight go red.

**Measured on the page**, which is what settles it: this browser holds two looks and three park
records, the line now reads `2 looks · 3 park records`, and the file it writes holds exactly those
five things. The old line would have said `0 songs · 0 drawings · 2 looks`.

The empty case also still said "Nothing kept **in this browser** yet", four lines under a paragraph
that had already been corrected once for claiming exactly that — these follow the account now. It
says "Nothing to copy yet", because where they are kept is not what that line is about.

**Named, not fixed:** the `Change` button beside the handle in Your info is 62×17px at 375, under the
24px floor. It is a control inline in a line of text, so it wants a hit area extended without
disturbing the line rather than a taller button, and it is nothing to do with chronicle.

## 6as · ✅ Chronicle on a profile

The thing Evan asked for and had not deferred: _"a profile block for the goals or stats"_. The
security reasoning is in `docs/2026-10-14-chronicle-profile-block.sql` and is the larger half of
the work; this is what it looks like and what the building of it turned up.

**The block is the switch, and there is no other one.** `get_member_chronicle` answers nothing
unless the member HAS a chronicle block and the viewer may see THAT block — so taking the block off
the page is a revocation rather than a hiding, and a member who never adds one cannot leak anything
through this path however the client is called. This is deliberately not how `stats` works: that
one rides along in `get_member_profile` behind `profiles.activity_visibility`, a single switch
already covering the snake score, the shared circuits and the movie count. Three unrelated facts
behind one switch is more than that switch can honestly mean, and a record of how somebody spends
their days would have been a fourth and much the most personal.

**It cannot be public, refused in SQL rather than discouraged in the UI**, because
`can_see(owner,'public')` is true for anon while the RPC refuses an unauthenticated caller — so
that tier would READ as the open internet and BEHAVE as members. The editor stops offering
"Anyone" for this one block type, which only keeps the dead end unreachable; the refusal that
matters is the server's. Checked that the filter is narrow: a Banner still offers all four tiers.

**And it shows no goal titles.** A goal is free text somebody wrote about their own life — the seed
for this room has "Ring the dentist" in it and real ones will be franker. Agreeing to show how many
hours went into drawing is a different act from agreeing to show what you are trying to fix about
yourself, and one card collecting the second consent while asking for the first is not something
this site should do. Counts only: reached, and still going.

### Three things the building of it turned up

**The bars were drawn backwards, and every number beside them was right.** The fill was the flex
child, so `flex: 1 1 auto` beat its inline width and each bar became however much room its row had
left over — which is the length of its LABEL, not its time. Measured: Drawing at 3h49m drew 270px
and Chronicle at 7m drew 294px. The DOM readings that preceded the screenshot were all clean: names
present at 56px, nothing clipped, no overflow. It took looking at it. Fixed with a track that grows
and a fill inside it that does not, then re-checked by reading the minutes back out of the LABEL —
a path sharing no arithmetic with the width — and comparing: 100/79/59/5/4% against 100/79/59/5/3%
expected, the last being the 4% floor.

**Then the bars did not line up, which is the same chart being wrong more quietly.** Each track
absorbed whatever its minutes label left, so "3h 49m" and "3h" produced tracks of 166 and 196px
and the five bars were drawn against five different baselines. `Looking.tsx` had already reached
this about its own name column — _a bar chart whose bars do not line up is a worse chart_ — so the
minutes column is a fixed 52px, in pixels because the root font-size here is fluid. All five tracks
now measure 146px and start at the same x.

**A second block's window picker did nothing.** The window was read off the first chronicle block's
config, so a second block answered with the first one's span while offering a control that appeared
to change it. Found by adding a second block in the workbench, not by reading the code. The window
is a parameter now, clamped 1–90 server-side, and the gate became "a chronicle block THIS viewer
may see" — the same question as before for one block and the right one for two. Verified through
the room's own picker: 7 days → 9h 23m, 30 → 11h 29m, 90 → 11h 28m, the last two agreeing because
the seed only spans about a month.

### What it took to be able to see any of that

`previewMember` makes no session, so the block fetched, got nothing, and rendered "Nothing recorded
lately" — which looks exactly like a block that works. `pvMemberChronicle` stands the RPC in from
the same seed store the room itself uses, clamping the window the same way the SQL does. Without it
the whole card above would have been shipped on reasoning alone, and the two bar bugs were
invisible to reasoning.

The three category colours moved from `.chron` to `:root` rather than being written out again —
the note on them says they were consolidated to stop a fourth copy appearing, and a chronicle block
on a profile page was precisely that fourth copy waiting to happen.

**At 375**: no sideways scroll, nothing past the edge, nothing clipped, nothing under the 24px
floor, no container overflow. And the bundle was grepped: none of the preview seed reaches it.

## 6at · ✅ "Tied to profile status if shared"

The rest of the sentence Evan wrote: _"i will want chronicle to be tied to account and profile
status if shared"_. The account half has been true since the library started syncing. This is the
profile half — a page that can say what its owner is actually doing.

The chronicle block can now show the running sitting: the activity's name, its colour, and how long
it has been going, above a rule and above the week's figures, because it is a different kind of
fact from them. Those are a week; this is a minute ago.

**It is off until switched on, and the switch is read from the BLOCK rather than passed by the
caller** — which is the whole difference between it and the window. A window is not a privacy
boundary: somebody who agreed to show their hours did not make a separate decision about seven of
them versus ninety, so `p_days` is a parameter and the server merely clamps it. What they are doing
right now, by name, to anybody who opens the page, IS a different decision — so there is
deliberately no parameter for it. `v_live` is read off `config->>'live'` on a block the viewer can
already see, in the same pass as the gate.

**The real data argued for that better than I could.** The first test run printed one of Evan's own
activities: _"talking with josh and parker"_. That is what an activity name is — and the card has
always shown the top five by name, which the editor's copy says. Adding "and what they are doing at
this moment" to that is exactly the step that should need a deliberate tick.

So the editor's sentence changes as the box is ticked: _"Your hours and the activities you spent
them on. Never the names of your goals, or your notes."_ becomes _"… on, **including the one running
now**. Never the names of your goals, or your notes."_ The thing you just turned on is named in the
line underneath it rather than left for you to infer.

Verified through the editor's own checkbox rather than by setting config: off → no line at all; on
→ "Chronicle right now · 7m so far", and the help text changed with it. The double refuses it the
same way the SQL does, so the opt-in is exercised where it is easiest to look at. At 375: one line,
28px, and nothing sideways, off-edge, clipped or under the floor.

## 6au · ✅ The day's log had orphaned buttons on a phone

Chasing the thing Evan actually said — _"even the ui is so much cooler in the html"_ — rather than
another feature.

A log of four sittings at 375 had two rows one line tall and two rows **two** lines tall, and the
second line was not what you would guess. On the Drawing row — a name, a length and one rating
chip — everything fitted on line one and the ✎ and ✕ **wrapped onto a line of their own**, floating
right under an empty space with nothing to attach them to. A row that looks broken rather than
wrapped.

**The numbers nearly hid it.** `mobileAudit` was clean: no sideways scroll, nothing off the edge,
nothing clipped, nothing under the touch floor, and no container overflowing. The row heights said
`39, 66, 39, 66`, which reads as "some rows are taller", not as "the controls have come off". And
a count of distinct `top` values said `lines: 4` and `lines: 6`, which sounds like chaos and is
really just centred items of different heights. **It took a screenshot**, which is the rule this
file has been written about twice already.

The cause was one declaration: `.chron-ent-name { flex: 1 1 130px; min-width: 130px }`. On a 303px
row that is not a name column, it is most of the row. Measured there, the gap resolves to 8.5px, so
`dot 9 + name + length 25 + chip 30 + buttons 99 + four gaps 34` fits only while the name is under
**106px**. At a 100px floor on phones the ordinary row — what it was, how long, how it went — is one
line with 13px to spare, and the names still grow to 162 and 171px where there is room. Nothing is
clipped at either width; desktop is untouched, still 42px rows with names at 494–740px.

A rich row still wraps — Gym carries a name, a length, a metric total, a SHORT chip, a rating and
two buttons, and seven things do not cross a phone at any name width. The point was never to make
every row one line; it was to stop the ORDINARY row looking like a mistake.

### A dead selector, found by checking the one I was about to copy

The rule read `.chron-ent-name, .chron-acts li > span:first-child`, and I had duplicated both halves
into the new phone rule before checking the second one. An activities row begins with
`<button class="chron-act-name">` — the spans inside it are the category and the metric — so
`> span:first-child` matched **nothing**, in every state the fold renders, archived rows included:
0 of 7. Removing it is provably a no-op and the proof is in the measurements, which are identical
either side of the removal: entry rows `39, 66, 39, 39` and activity rows `64, 50, 50, 37, 69, 62,
37` before and after. It is gone from both rules now, rather than being dead in two places.

## 6av · ✅ The unit box hinted at a word nobody would get

A phone sweep of the five forms the opening audit cannot see — ＋ Activity, Fill a gap, Plan a span,
＋ Routine and Add to today — came back clean on every measure at 375, and looking at the richest of
them confirmed it: the goal form pairs into sensible rows with nothing cramped.

What the look DID turn up was a word. The optional unit box hinted **"points"**, and "points" is
not what you get by leaving it empty: `unitFor` fills it from what the room already knows —
`minutes` for a goal counting an activity's time, that activity's own metric for one counting an
amount, `done` only where nothing can be known. A placeholder naming a fourth word nobody will ever
receive is a guess the reader has to un-learn.

So the hint IS the answer now, and it follows the source as you change it: `done` on a fresh form,
`minutes` once it points at Writing counting time, `pages` the moment it counts the amount instead.
Same function the save uses, so the preview cannot drift from the result.

**And the first measurement of it was wrong, in a way worth recording.** The sequence read `done →
pages → pages → minutes`, with step two apparently ignoring that the goal was counting TIME. It was
not: an earlier probe in the same page had left `countWhat` on `amount`, and the form was never
reopened, so trial two inherited trial one's state. Re-run from a freshly opened form it reads
`done → minutes → pages`. The same shape as the note in CLAUDE.md about a timed-out call's
keypresses landing in the next trial — **close and reopen the thing under test between readings**,
or the state you set two probes ago answers for you.

## 6aw · ✅ The two remaining save paths, checked — and the one that is safe by accident

No bug this time, which is worth writing down as plainly as a bug would be: §8's rule says a save
that writes every column is a delete for the ones the caller forgot, and chronicle has two save
paths that had never been walked for it.

**An activity.** `chronicle_activity_save` does NOT treat its optional columns alike, and the
difference matters:

| column         | a null means                              |
| -------------- | ----------------------------------------- |
| `colour`       | leave it alone — `''` is how you clear it |
| `metric`       | **erase it**                              |
| `session_mins` | **erase it**                              |

The colour is defended because it was already lost once: the room passed null on every rename, and
once `chronicle_import` shipped, a restored file became the only way an activity could HAVE a
colour, so the next rename deleted it. The other two have no such guard — `metric = v_metric` and
`session_mins = v_session`, unconditionally.

**They are safe, and they are safe for a reason that is not written down anywhere near them: the
editor prefills them.** Opening Gym's editor shows `reps` and `60` already in their boxes, so a
rename sends them back unchanged. That is the only thing standing between a rename and a deletion,
and it is a property of a component three files away from the SQL that depends on it.

Walked both directions through the room's own controls, since a field you cannot clear is as much
a bug as one that clears itself:

- renamed Gym to "Gym and weights" and changed nothing else → `metric=reps`, `session=60`,
  `colour=#4caf50`, `cat=free`, all intact;
- emptied both optional boxes and saved → `metric=null`, `session=null`, and the colour still
  `#4caf50`, because it has its own control and was not touched.

**A routine.** Same shape — `chronicle_routine_save` writes `name` and `steps` together — and same
answer: the editor prefills the steps, so renaming "Morning" to "Morning routine" kept all three,
including the one whose minutes are null. Then the controls nobody had exercised at all: ▼ reordered
Dishes below Drawing, ＋ Step added Gym at 20m, and the save persisted
`pv-draw/30, pv-dish/10, pv-write/null, pv-gym/20` with the fold's own summary moving to "3 of 4".

**What to do with this.** Nothing today. But if a second caller of `chronicle_activity_save` is ever
added — a quick category toggle, a bulk edit, anything that knows the name and not the metric — it
deletes both optional columns silently, and the prefill that protects the current one will not
protect it. The cheap fix at that point is to give `metric` and `session_mins` the same `null leaves
it alone` treatment the colour has, rather than to remember at every call site.

## 6ax · ✅ Goals on a profile, behind two switches

The other half of _"a profile block for the goals or stats"_ — the half I deliberately did not ship
with the block, saying at the time that titles belonged behind a per-goal opt-in rather than a
block-level one. The security reasoning is in `docs/2026-10-14-chronicle-goal-share.sql`.

**Two switches, both required, both off by default.** `chronicle_goals.shared` is ticked one goal
at a time, in the room, beside that goal; `config.goals` on the block says it is willing to show
goals at all. A member who ticks a goal and has no block has published nothing. Proven each way
round in SQL with the other held still, then again through the controls themselves: ○ beside two
goals put exactly those two on the card and left the other nine off, and unticking the block's own
switch emptied the list while the hours stayed.

**No progress figure, and that is a decision rather than a shrug.** A goal's window comes from
`goalWindow` here in the client — six scopes, anchor-or-repeat, the Sunday-week rule — and the
server has no copy of it, which is exactly why `chronicle_tally` takes its windows from the caller.
A bar would buy one line of UI and cost a second home for all of that arithmetic, obliged to agree
with this one forever. What a shared goal says is what it IS: "Read ten books · 10 books".

### The third button broke the row, and the numbers said it was fine

§6 of the standard says a new control counts as a UI change, and this is why. The goal row carried
✎ and ✕; ○ made three. At 375 that pushed "Water the plants" over, and what wrapped was not the
chips — it was **✕, alone on a line of its own, floating right under an empty space.**

`mobileAudit` reported it clean: no sideways scroll, nothing off the edge, nothing clipped, nothing
under the touch floor, no container overflowing. It is clean — a wrap is not an overflow. **This is
the second time today the same measurement missed the same shape**, the first being the day log's
own buttons this morning, and both times the screenshot is what found it.

The fix is the idiom the log row already had: the three controls live in `.chron-goal-do`, which is
`flex-wrap: nowrap` with `margin-left: auto`, so they move as one unit and stay right. Measured
after: all four rows, three controls, **1px** of vertical spread between them and a right edge
consistent at 339px. Desktop untouched at 63/103px rows.

The lesson is not "measure more" — I measured plenty. It is that **wrapping is invisible to every
check in `mobileAudit` by construction**, so a change that adds anything to a row needs eyes on it
at 375 regardless of what the numbers say.

## 6ay · ✅ A long goal title, and the third container of the day

Two checks on yesterday's goal sharing, one clean and one not.

**The round trip is safe, and now measured rather than asserted.** The commit claimed a file
somebody sends you cannot put goals on your profile, on the grounds that `chronicle_import` does
not carry the column — but I had only made the PREVIEW DOUBLE ignore it, and never read the real
function. It does not mention `shared` either, so the guard is real and structural. Checked the
other direction too, since a new column is exactly what an existing round trip quietly clobbers:
exporting with a goal shared produces a file with no `shared` key, putting it back skips all
sixteen rows as already present, and the flag survives. A restore into a FRESH account gives
unshared goals, which is the right default for a page that has not been looked at yet.

**The long title was a different story.** Every goal in the seed was twenty-odd characters, so
nothing had ever tested the ellipsis the card's title column exists for. Giving the back-fence goal
a realistic 66-character name — the column allows 120 — found this:

```
cardOver   223     ← the card 223px past its own edge
titleW     437     ← inside a ~300px card
sideways     0     offEdge 0     clipped 0
```

The page-level sweep is not wrong there. A grid item defaults to `min-width: auto`, which means
"never shrink below your content", so the row simply grew and took the card with it — and the
overflow is INSIDE a container, which `mobileAudit` does not ask about. **That is the third time in
one day the container-versus-page distinction has been the whole answer**, after the goal row's
orphaned ✕ and the day log's before it.

`min-width: 0` on the row fixes it, and is safe here only because the floor is one level down: the
title keeps its own 56px floor, so what this permits is an ellipsis rather than a disappearance.
After: `cardOver 0`, the title ellipsed at 201px, and "4 panels" still readable beside it. The
activity rows got the same treatment, since a long activity name would have done the same thing and
only has not because nothing in the seed is long enough — which is the lesson, not the fix.

The fixture carries the long title permanently now, the way it carries a long activity name, for
the same reason: a fixture whose longest string is short tests the ellipsis on nothing.

## 6az · ✅ The new rule's first catch, which was mine

`spills` went into `scripts/mobile-audit.js` because three faults in one day shared a blind spot it
could not see. Run across twelve rooms with every fold open, a healthy site reported exactly one
thing: the Activities fold's name button, over by eight pixels.

Eight pixels sounded like rounding. It was not. Going to look found the fold in a genuinely poor
state at 375 — each row's button carries a name, a category, a metric AND a sitting length, gets
about 178px of a 375 screen, and was wrapping to three ragged lines with "· 30m a sitting" drawn
outside its own rounded background. **The number was small because an overflow is measured in
pixels and a mess is not.**

The answer is the one this room already uses twice — `.chron-plan-note` and `.chron-ent-when` both
disappear below 700px because _"a note is the first thing to go when a planned row will not fit a
thumb"_. The metric and the sitting length are now `.chron-act-extra` and go the same way, and they
are the right two to lose: both are in the editor that this very button opens. Five of seven rows
are a clean 36px single line now, where before they were three wrapped lines each; desktop keeps
everything.

**And one row stays slightly tall on purpose.** The auto activity's "on the site" chip wraps to
three lines, which `white-space: nowrap` fixes — measured, it takes the row from 61px to 49px — but
that makes the name button spill 28px instead. Hiding the chip would fix both and is the one thing
not available: `record.ts` says that flag is _shown, not hidden_, because "Paint 4h" meaning the
room was open is a different claim from having painted for four hours. So the chip wraps, the row
is 61px against the others' 36px, and nothing overflows. A tall row is a worse look than a short
one and a better answer than a quiet lie.

## 6ba · ✅ The block had only ever been looked at at one size

A profile block has three widths — a third, a half, full — and the chronicle one had been built,
measured, screenshotted and shipped at `medium` every single time. Switching it to **a third** found
it overflowing its own card by 45px, with six spills, every goal title pinned at its 56px floor and
a bar track down to twelve pixels.

The arithmetic is unarguable: a third-width card gives its lists 108px, and a row's rigid parts come
to about 133 — a 56px label floor, a 52px minutes column or a wider aim, the dot and the gaps. It
does not fit, and no amount of shrinking makes it fit, because the floors are the point.

**Stacked, not hidden.** What would have had to go is exactly the part somebody chose: the goals
they ticked and the activities they spent the week on. So at `is-small` the rows wrap and the number
drops under its label, still right-aligned. The bar track is the one thing dropped, and it earns
that: twelve pixels cannot express a proportion, and the minutes beside it say the same thing
exactly — a decoration pretending to be a measurement is worse than no decoration.

**And then a flexbox detail worth keeping.** Wrapping happens on an item's BASIS, before any
shrinking does. Both labels are `flex: 0 1 auto`, so their basis is the whole title — which did not
fit beside its ○, wrapped to a line of its own, and only then shrank. Three lines for one goal, with
the tick sitting alone above it. A basis of the floor (`flex: 1 1 56px`) lets the label sit beside
its marker and grow into what is left: two lines, reading as a label with its number underneath.

After: all three sizes report `cardOver: 0` and `spills: 0`, with nothing hidden at any of them —
three goals and five activities at a third, a half and full alike.

**The lesson is the one-size habit, not the CSS.** Every check I ran on this block for two days was
run at the width it happened to be created at. A `size` prop with three values is three layouts.

## 6bb · ✅ The same habit, applied to the blocks I did not write

Having learned that a `size` prop with three values is three layouts, the obvious next move was to
stop treating it as a chronicle lesson. Eight block types × three widths, swept with `spills`.

**Two of the other seven had the same fault, and neither is mine.**

**The guestbook, 144px past its own card at a third** and 63px at a half — only full width was ever
right. Its compose box is `flex: 1`, which can grow it and never shrink it: a flex child defaults to
`min-width: auto`, and for an `input` that means its `size` attribute's worth of characters, twenty
by default, about 202px. `minWidth: 0` is the whole fix.

**The trophy shelf, 30px past** at a third, with the list itself 50px over. A pill is 158px of
`white-space: nowrap` — "🥇 Gold · Jan 27, 2026" — and that card gives its list 108px. The pill now
wraps to two lines at `is-small` only, because the alternative is an ellipsis and the date is half
of what a trophy says. The `nowrap` stays everywhere else, where it is right.

After: eight blocks, three sizes, twenty-four combinations, nothing spilling.

**Worth saying plainly — both were already there.** Neither came from this week's work; they have been
on the site for as long as those blocks have had a small size, and no sweep found them because every
sweep ran at the width the block happened to be in. The rule that can see inside a container is what
made them visible; varying the prop is what made them happen.

## 6bc · ✅ Years had nothing to say about the record

Six horizon views; five of them say something about what you did. Today and Tomorrow have the day's
own totals two inches up. Week, month and year each get `Looking`. **Years had its life-scope goals
and not one word about the record** — which is odd for the view whose whole subject is the things
that take years.

The note at Looking's call site explained it, and is right about what it says: _"Years has no window
to add up — the range cap is 400 days, so pretending would mean quietly showing a year and calling
it everything."_ `chronicle_totals` really does raise above 400 days. But that is a fact about one
function, not a reason to show nothing, and the same note calls all-time totals _"a different
question"_ — which is a description of work to do.

So the Years view now ends with the whole record, a year at a time: a total, when it began and how
many days that is, then one row per year with its hours split into the three categories.

### The windows are computed in the client, deliberately

A year begins at local midnight and the server does not know the zone. The obvious shortcut is to
pass a UTC offset and let Postgres bucket by it — and it is wrong twice a year, because the offset
in force today is not the one that was in force on the 1st of January. So `chronicle_spans` takes
the windows already built, the way `chronicle_tally` does and for the same reason.

`year.ts` builds them with `new Date(y, 0, 1)`, local by construction, and **its test asserts the
property rather than a boundary**: the windows TILE — each ends exactly where the next begins — so
the sum over all of them is the whole record, with nothing dropped between two of them or counted
by both. The same shape as `overlapMs`' own test. Perturbed two ways at once, an off-by-one that
drops the earliest year and a gap between windows: five of eleven go red, including the tiling one.

### What it showed, checked by hand

With three sittings added to the seed in earlier years — everything else in it is inside ten days,
which makes a lifetime of exactly one year and tests nothing:

```
16h 23m recorded in all · since August 5, 2024 · 801 days
2026   11h 28m    locked 595px · free 164 · life 37
2025    3h 55m    locked 272
2024       1h     free 69
```

11h28 + 3h55 + 1h = 16h23, which is the headline — added up separately rather than trusting the same
sum twice. Segments scale against the **biggest year** rather than the total, the rule every other
bar in this room uses: against the total, six years of records would be six slivers. At 375 all
three tracks measure 209px and start at the same x, and nothing spills.

## 6bd · ✅ A goal in no list at all

Removing the quarter tab was right — _"quater is not worth a tab"_ — and the reasoning for keeping
the SCOPE was right too: the check constraint accepts it, `windowOf` computes it, and a file put
back through ⬆ Put one back can contain a quarter goal, so refusing it on the way in would lose
somebody's data rather than tidy it. The open item even said so, and called the import _"exactly
one door into the state"_.

What nobody checked is what a goal looks like once it is through that door. **It is invisible.**
`inScope` matches on scope exactly — deliberately, so each goal appears in one list rather than six
— and no view has scope `quarter`. The seed's "Read ten books" was in `myGoals()`, counted in the
profile block's "9 still going", shareable onto a profile, and listed by **none of the six tabs**.
Not seeable, not editable, not deletable.

The design doc had worried about this exact outcome in those exact words — _"a goal somebody can
create and never see again"_ — and then concluded the scope should stay, which was the right
conclusion and not the whole job.

**`homeFor` is the fix**: a goal whose cadence has no view is listed under the nearest one that
exists, which for a quarter is the year that contains it. It keeps its own scope in the data, the
window it is matched against is the VIEW's, and its row now carries a `this quarter` chip — because
an unlabelled quarter goal among the year's would be a quiet lie about what it is, and the member
needs to know in order to edit it into something the room does show.

### The test that passed for as long as the bug existed

There was already a test called _"appears at its own cadence and nowhere else"_. It asserted that a
quarter goal appears in the `quarter` list. **That was true, and useless** — it compared against
`SCOPES`, all six, when only five of them are lists anybody can open. It asked about `inScope` in
the abstract rather than about a view, so it agreed with the bug for as long as the bug lasted.

It compares against `SHOWN_SCOPES` now and expects `homeFor(scope)`. The new test asks the property
rather than naming the two scopes: **every scope lands in exactly one list, and one the room can
show** — which stays true if a seventh scope arrives or the quarter tab ever comes back. Perturbed
by routing an orphan to itself again, four tests go red.

Measured in the room afterwards: "Read ten books · THIS QUARTER" under This year, and that tab's
unfinished count moved from 1 to 2 — it had been counting the goal all along while showing it
nowhere.

## 6be · ✅ Archiving, checked across the room — and one control that lied

Hunting the same shape as the invisible quarter goal: data that exists and a view that will not
show it. Archiving is the obvious neighbour, because archiving is not deleting.

**It is sound everywhere it matters.** Archived "Drawing" with 35m logged today: the day's log keeps
the sitting, "Locked In 35m" keeps the minutes, the week grid keeps its blocks, the Looking bars
still list it, and the derived goal still reads _from Drawing · 35 / 30 minutes_ with its streak. A
routine step naming an archived activity is still enabled, and pressing it genuinely starts a
sitting rather than being a dead button — which is the right way round: the routine is an explicit
instruction, and the alternative is a control that looks live and does nothing.

**The goal editor was not.** A goal pointing at an archived activity opened with its source picker
reading **"I will count it myself"** — because the list filtered archived activities out, so no
option matched `a:pv-draw` and the select rendered empty. Two inches above it, the goal's own row
said FROM DRAWING. A control showing a different current value from the thing it edits is a lie
about state, and it is the one somebody acts on.

Fixed with the rule the plan form already had: an archived activity stays in the list **while it is
the one selected**. Checked both ways — editing the Drawing goal now offers and selects "Drawing";
editing a goal pointing at Gym does not offer it at all.

**And the other three pickers were checked rather than assumed**, by driving each with an archived
activity selected: the entry editor appends it (`[...open, ...(a && a.archived ? [a] : [])]`), the
Fill-a-gap form has `!a.archived || a.id === gapAct`, and the plan form has the same. One gap in
four, now closed. The pickers that are only ever used to CHOOSE something new — the stopwatch's and
the routine step's — filter archived activities out and should: there, the list is the offer rather
than a report of state.

### I predicted a data loss and there was not one

The shape looked exactly like §8's silent erasure — an editor that cannot represent the current
value, and a save that writes every column — so the expectation was that pressing Save with nothing
changed would null the source. **It does not.** `src` is React state, set when the editor opens; a
`<select>` whose value matches no option displays empty without changing it. Measured either side of
a no-change Save: `activity=pv-draw counts=minutes` before and after.

Worth recording precisely because the prediction was wrong. The failure here is a misleading
control, not a deletion — a smaller bug than the one being looked for, and reporting it as the
bigger one would have been the easier story to tell.

## 6bf · ✅ What a new member sees, across everything built this week

One sweep of a blank account through all six views, asking of each panel added over the last few
days: does it know there is nothing?

Four of five did. The rail, the week grid and `Looking` are all gated on there being an activity —
_"four zeros where one instruction belongs"_ — and `Lifetime`, built yesterday, says "Nothing
recorded yet. Once there is, this is where the whole of it adds up."

**The month calendar did not.** A new member opening This month met 35 cells with nothing in a
single one of them, sitting between "Nothing here yet." above and "Nothing recorded this month yet."
below — an empty grid framed by two sentences already saying so, on the one screen where the
three-step instruction is what somebody actually needs. It is now gated the same way as its
neighbours, and the sentence underneath stays: this hides a chart of nothing, not the fact that
there is nothing.

It was built the same day as the rail and the week grid and simply missed the rule they were given,
which is the ordinary way a room becomes inconsistent — not a wrong decision, an unrepeated one.
Checked both states: blank gives no calendar and keeps the sentence; seeded gives 35 cells and 10
fills.

## 6bg · ✅ "Looking back" on a day that has not happened

The same method as the blank-account sweep, pointed at another state nothing had been checked
against: the day stepper walked forwards.

Stepping to Saturday, the room said **"Looking back. Use ⏱ Fill a gap to add time, or go back to
today to start a timer."** The condition behind it is `seeing !== todayISO()`, which is true in both
directions; the sentence was written for one of them. It is wrong twice on a future day — you are
looking forward, and you cannot have spent time on a day you have not lived — and the second half is
worse than untidy, because it invites somebody to record work they have not done.

A future day now says **"Not here yet. Plan a span below, or go back to today to start a timer."**,
which points at the thing that is actually for it: the plan list is a few inches down the same
column. Checked in both directions afterwards — Oct 17, 18 and 19 give the new sentence, Yesterday
and Oct 13 still give the old one, and today gives neither because the timer controls are there.

**What was already right, and worth noticing.** The week grid's footnote reads _"6% of these 5 days
is written down"_ when the week is half over — counting the days that have happened rather than
seven — and on a week entirely in the future it omits the line altogether. The percentage knew
about the future before the sentence above it did.

## 6bh · ✅ A sitting that crosses a boundary, through every panel and both implementations

The arithmetic the whole room rests on — _"two hours long and belongs to two days, one hour
each"_ — has had a unit test since the beginning and had never been driven through the interface.
A sitting added with ⏱ Fill a gap from 23:00 to 01:00:

| where              | what it said                      |
| ------------------ | --------------------------------- |
| today's log        | `Drawing 1h · 11:00 PM – 1:00 AM` |
| yesterday's log    | the same entry, also `1h`         |
| today's totals     | Locked In 35m → **1h 35m**        |
| the week           | Drawing 2h 38m → **4h 38m**       |
| the month calendar | Oct 14 `1h 42m`, Oct 15 `2h 40m`  |

Shown on both days at an hour each, counted once at two hours in every aggregate above them.

**And then the year boundary**, which is what `year.ts` claims and nothing had exercised. A sitting
from 31 Dec 23:00 to 1 Jan 01:00 moved 2025 from 3h 55m to **4h 55m** and 2026 from 13h 29m to
**14h 29m** — an hour each, total +2h, and 14h29 + 4h55 + 1h is the 20h 24m headline, added by hand
rather than by trusting the same sum twice.

⚠️ **That was the preview double, and `chronicle_spans` is a second implementation in SQL.** The
two cannot share a bug but they can disagree, so the production function was asked the same
question directly, read-only, in a rolled-back transaction: windows placed **inside** an existing
69-minute sitting. Two touching ten-minute windows reported `locked 10` and `locked 10`, and the
twenty-minute window they tile reported `locked 20`. A second sitting overlapping only the first
window gave `free 9` and `free 9`, with no key at all in the second — the documented shape for a
category with nothing in it.

That measurement discriminates, which is the point of choosing it: attributing a sitting to the
window it STARTED in would have given 0 for both ten-minute windows, since the sitting began five
minutes before either of them. Double counting would have given 69 to each.

**What the same sweep turned up that is not a bug yet.** Every "how much time" function was read
for its join, because four of them answer the same question and a disagreement between them is a
total nobody can reconcile. They agree, and orphaned entries are impossible anyway —
`chronicle_entries.activity` is `on delete cascade`. But the row below it is
`chronicle_goals.activity on delete set null`, and `chronicle_tally` only answers goals
`where (gl.activity is not null or gl.cat is not null)`. So deleting an activity would quietly
turn every goal pointed at it into a goal that is never answered — the `0 / 30` shape from §6bd,
with nothing on screen to say why. **It cannot happen today**: nothing in the schema deletes from
`chronicle_activities`, which is only ever archived. Recorded because the day something gains a
delete button, this is waiting for it.

## 6bi · ✅ The log row on a phone, and a budget that was wrong in a comment

Going to look at the Years panel at 375 — new rows, and the shape that has twice produced an
overflow — found the panel clean and the **log above it coming apart**. Six facts about a sitting
and two buttons were all direct children of one wrapping row, and the ordinary row lost the line
by two pixels: `dot 9 + name 100 + 35m 25 + good 30 + buttons 100` is 264, plus five 8px gaps is
**304 against a 302px row**, so ✎ and ✕ dropped to a line of their own under an empty space.

The standing comment on `.chron-ent` had an arithmetic budget in it that said this fitted. It
counted **four gaps and no rating** — so it had been true of the row as it stood when it was
written, and silently stopped being true when the rating was added. It is corrected in place rather
than replaced, because a budget that was wrong is worth more as a warning than a budget that is
right.

Two changes, and the first is the one that matters:

1. **The facts are one group now** (`.chron-ent-facts`). The row is four items — dot, name, facts,
   buttons — so the facts wrap among themselves and no number of them can push the buttons off.
2. **6px gaps on the phone row**, in pixels: the computed gap is 8.984px at desktop root size, so
   `0.5rem` is not 8px and a budget written in rem would not survive a wider root.

Measured at 375 before and after: the ordinary row went from **65px tall with orphaned buttons to
one 38px line**, six of the seven rows in the seed are single lines, and the four that already
fitted gained four pixels of name each. The rich row — a metric AND a chip AND a rating — still
wraps, as the note has always said it must; what changed is that its facts wrap together instead
of the rating being stranded alone at the far left. Desktop (1440) and tablet (820) are unchanged:
every row one line, no overflow on the list, the card or the page.

⚠️ **The audit did not find this and could not have.** `mobileAudit` reported the room clean, and
it was right to: nothing overflowed, nothing was clipped, no target was under 24px. A row that
wraps into two tidy halves is not an overflow — it is a layout that measures perfectly and reads
as broken. The screenshot found it. See CLAUDE.md §6, _measure then look_.

## 6bj · ✅ What chronicle actually ships, and the sentence that stopped being true

Forty-odd commits this week, every one verified against `npm run dev`, which is not the program
anybody runs. Two things were checked against the built bundle on :4173.

**The dev harness is not in it.** `src/dev/chroniclePreview.ts` has grown all week — four more
stand-ins, a long-named activity, three sittings in earlier years — and CLAUDE.md records that
2.78 kB of invented fixture once shipped to real users on a module whose header said it tree-shook
out. Greps for five strings only the harness contains (`Ring the dentist`, `pv-draw`,
`pvMemberChronicle`, …) and for `previewMember`, `dev-profile`, `dev-park`: all absent.

⚠️ **With a control, because a grep that finds nothing proves nothing.** `Fill a gap`,
`Looking back`, `Not here yet`, `recorded in all` and `chronicle_spans` are all present in the same
files by the same method — so the harness's absence is the bundle's doing, not the grep's.

**The signed-out room, on an origin with no localStorage**: a two-sentence description, the note
that it lives in the account rather than the browser, and a Sign in anchor. At 375: nothing over
the card or the document, Sign in 82×40.

**And that page is where the fault was.** Its blurb ends _"today, this week, this year, and the
things that take years"_. The signed-IN room's blurb ended at _"this year"_ — so the room that has
the Years tab was the one not mentioning it, while the page for people who cannot see it described
it correctly. `git log -S` dates the split to `0449e50`, the Years work itself: that commit updated
one of the pair and not the other. They say the same thing now, and the call site says it is a
pair so the next horizon is two edits rather than one.

**One more from the same panel.** `.chron-life-mins` was `flex: none; width: 58px` — enough for
`14h 29m`, and a hard cap, so a longer figure wrapped and silently doubled the row. Measured by
replacing the label by hand: `1095h 30m` took the row from 18px to 36, and three hours a day for a
year reaches that. It is a `min-width` now with `white-space: nowrap`, so the short labels still
align into a column and a long one takes what it needs from the track: 58 → 67 → 74 as the label
grows, the track giving up 209 → 200 → 193, and the row staying **18px** throughout.

## 6bk · ✅ What ⬇ Save a copy leaves behind, asked as a query rather than read off a list

`shared` was added to `chronicle_goals` on the 14th, and the round trip's key contract lives in a
hand-written list in `chroniclePreview.test.ts` — described in its own comment as _"the one place
where the server's contract is written down rather than derived"_. CLAUDE.md §11 is about exactly
that shape: `rpc-inventory.md` was a hand-kept table and was wrong in both directions in four
weeks. So the question was whether the list had already drifted.

It had not. Asked of the live function's own output rather than its source, the key sets are
**9 / 8 / 18** for activities, entries and goals, matching the list exactly, with `shared` absent.

**Then the better question**, which a query can answer and a list cannot: what does the file leave
behind? Every column of every chronicle table, against the keys the file actually carries:

| table                | rows | not in the file   |
| -------------------- | ---- | ----------------- |
| chronicle_activities | 6    | `owner`           |
| chronicle_entries    | 9    | `owner`           |
| chronicle_goals      | 1    | `owner`, `shared` |
| chronicle_plans      | 0    | ⚠ not checked    |
| chronicle_routines   | 0    | ⚠ not checked    |

`owner` is deliberate and tested — the file is passed between machines and never names an account.
So **`chronicle_goals.shared` is the only column on any chronicle table the file does not carry**,
and the two unchecked lists were read off the function instead: routines and plans carry every
column but `owner`.

⚠️ **The ⚠ is the point.** The first version derived keys from the exported rows and reported
every column of plans and routines as missing — because this account has none of either, so there
were no rows to take keys from. A list with nothing in it has no keys, and a sweep that cannot say
so reports a catastrophe. The same shape as a members-only room rendering its empty state and
passing every check there is.

**And `shared` stays out.** `chronicle_import` ignores it on purpose, so a file somebody sends you
cannot put goals on your profile; exporting a flag nothing will read back would only write a
privacy fact into a file that gets passed around, and the file carries no owner id, so "this one
is mine" is not a question it can answer. The cost is that a restore leaves your goals private
until you tick them again — the direction this should fail in. That reasoning now sits beside the
key list, because the next person to notice the gap will otherwise close it.

**The protection was proven, not assumed.** Adding `shared: g.shared ?? false` to `pvExport`'s goal
object turns two tests red — the key equality and the round trip that fills every field — so no
third test was added to say the same thing. Reverted from a scratchpad copy; `git diff` clean,
996 green.

## 6bl · ✅ A routine could be stopped dead by archiving, and the double was hiding it

Routines is the one chronicle feature this week never touched, and it is behind a closed
`<details>` — so it renders, it is never looked at, and the account has none of them at all.

**The rule it runs on.** There is no stored "where am I in the routine"; which step is next is
derived from the minutes already in hand. A step is done when today's minutes against its activity
reach its suggested length, or reach one minute when it suggests nothing.

**What that rule could not express.** An archived activity cannot be started — `chronicle_start`
checks `archived_at is null` — so it can never gain a minute and can never be done. With only two
states, archived read as "not done yet": the step sat at the head of the queue for ever, the
routine said **2 of 3** for the rest of its life, and the ▶ beside it was offered, enabled, titled
"Start this". Pressed on the live site it would have answered **"no such activity"** about an
activity named on the button's own face.

**And the pane said it was fine**, because `pvStart` checked only that the id existed. Driving it
here started a timer on an archived activity and showed no error at all. CLAUDE.md says an
unfaithful double looks exactly like a product bug; this is the other direction, and it is worse —
it looked exactly like no bug. The double now makes the server's check, with the server's words,
and refuses "not yours" and "put away" identically so the refusal cannot tell them apart.

**The rule moved to where it can be asked a question.** It was two expressions inlined in JSX — a
`findIndex` for the arrow and a `filter().length` for the counter — which have to agree with each
other and could only be checked by looking at a screen. `src/chronicle/routine.ts` is `readRoutine`,
with four states instead of two, and eleven tests: the `>=` boundary at exactly the suggested
length, the one-minute rule for a step that suggests nothing, steps done out of order, and an
invariant sweep asserting the counter and the arrow can never disagree.

Measured in the room, archiving the step the routine was up to:

|          | before                           | after                                                                           |
| -------- | -------------------------------- | ------------------------------------------------------------------------------- |
| header   | `2 of 3`                         | `all done today`                                                                |
| the step | `is-next`, enabled, "Start this" | `is-gone`, **disabled**, "Writing is archived — bring it back to use this step" |

A routine made entirely of archived steps says "every step is archived" rather than congratulating
you. The step stays visible and struck-out-looking rather than vanishing, because archiving an
activity is not a reason to rewrite a list somebody saved — and `is-gone` is italic and dimmer
rather than struck, since struck already means "you did this".

Both tests were made to fail once: reinstating the two-state rule turns four of the eleven red, and
removing the double's archived check turns the fidelity test red. 375 and 1440 checked — three
steps, no overflow, nothing under 24px.

## 6bm · ✅ Every guard the server keeps, against every guard the double keeps

§6bl found that `pvStart` was missing the server's archived check, and that the missing check had
hidden a real bug rather than invented one. One infidelity found by accident is a reason to look
for the rest, so both sides were listed: every `raise exception` in all 25 `chronicle_*` functions,
against every refusal the double can give.

Most of the gaps are caps a preview session cannot reach — 200 activities, 500 goals, 5000 plans,
40 routines — and simulating those would be inventing a fixture nobody will have. **One gap was
reachable in half a second**, because ⏱ Fill a gap is two free-form datetime boxes:

`chronicle_entry_add` refuses a span over 24 hours. The double refused only a backwards one. Driven
in the room before the fix, a three-day gap was **accepted**: the week went from 4h 58m to
**150h 43m**, and the comparison line read "148h 38m more than this". The live site would have
refused it outright.

⚠️ **The first attempt to show this measured nothing**, and said so loudly enough to be caught: the
activity select was left unset, the client refused with "which activity was it?" before the double
ever saw the span, and the week was unchanged. A clean result from a path that never reached the
thing under test. Re-run with the activity chosen, it failed immediately.

**What was aligned**, in the server's order and the server's words — the order is part of the
contract, since a span that is both backwards and four days long is answered about being backwards:

| function      | gained                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `pvAddEntry`  | the 24-hour bound, the activity check, and `'that span ends before it starts'`                      |
| `pvEditEntry` | `'both ends, please'`, the 24-hour bound, and `'no such entry'` **last**, where the server makes it |
| `pvQuality`   | a rating is 1 to 5                                                                                  |

⚠️ **AND ONE DELIBERATE DIFFERENCE, PINNED SO IT IS NOT TIDIED AWAY.** `chronicle_entry_add` asks
only `owner = auth.uid()`; `chronicle_start` also asks `archived_at is null`. Writing down an hour
you already spent on something you have since put away is recording history — only _starting_ a new
sitting on it is refused. Copying the stricter rule across, which is the obvious tidy-up, would
have invented a refusal the server does not make. There is a test asserting both halves.

**A near-miss worth keeping.** The patch that made these edits asserted a single match per anchor,
and one anchor matched **twice** — `pvFixRunning` makes the same "not one of your activities" check
in the same words as `pvEditEntry`. The assert caught it; a bare search-and-replace would have
edited the wrong function and left the right one alone.

**And one test was wrong rather than the code.** The first boundary test asserted that `h(1)` to
`h(25)` is refused. That is exactly twenty-four hours, and the bound is `> 24 hours`, not `>=`, so
the code was right. It now asserts the boundary from both sides — exactly a day passes, a day and
one millisecond does not.

Driven afterwards: the three-day gap is refused with "that is more than a day", the form stays
open, and a legal ninety-minute one is accepted and closes it. 1013 tests.

## 6bn · ✅ The invariant a quarter goal broke, asserted across every shape

§6bd found a goal that was in no list at all, and fixed it. The test written with that fix asserts
the right claim — every goal lands in exactly one list the room can SHOW — but it walks one shape
per scope: anchored on the first day of its window. That is the shape the quarter bug happened to
have, and a matrix with one cell per row is how the next hole stays open, because the other shapes
take different branches: `repeats(g)` returns before the anchor is looked at, and an anchor on the
last day of a window sits against the end of the range that is exclusive.

**Four tests, each made to fail once**, and none of them found a live bug — the invariant holds:

- **Three shapes × six scopes.** First day, last day, repeating — each in exactly one shown list.
- **The day after is a different window.** A goal anchored on `w.to` is in no list today, for every
  dated scope. Perturbing `< w.to` to `<= w.to` turns this red while the old suite catches it only
  for `day`, which is the coverage it adds.
- **Streak windows tile.** Each ask ends exactly where the one before it begins, so a run has no
  gap for a met target to fall into and no overlap to count one twice. Asserted through the asks
  rather than by recomputing `windowBack`.
- **A quarterly streak walks back three months**, written from the calendar: Q1 2026, then Q4, Q3,
  Q2, Q1 of 2025. Changing the step from `3 * n` to `n` turns both streak tests red and nothing
  else in the suite notices.

⚠️ **THE STREAK OF A QUARTER GOAL WAS UNREACHABLE CODE UNTIL §6bd.** No list, no row, no chip — so
the path had never run. Making a thing visible makes its neighbours live, and a path that becomes
live is a path nobody has exercised. The existing streak test covered `month` only.

**One thing deliberately not changed.** The streak chip renders `🔥 4` with "4 days in a row" only
in a `title`, and CLAUDE.md is explicit that a tooltip does not exist on a phone. Measured at 375
before deciding: the goal row already carries **"7 of the last 31 days reached"** in words
immediately below the chip, so the idea is not title-only — and this is the row that overflowed
once with five chips. Widening a chip on it to repeat something the next line already says is a
real risk for a marginal gain. The chip's wording is right for every scope, incidentally: it reads
`g.scope`, so a quarter goal says "quarters in a row" rather than taking the year view's word.

## 6bo · ✅ ✓ on tomorrow's plan recorded time nobody had spent

§6bg fixed the sentence a future day shows, and said why: the old one "invites somebody to record
work they have not done". The sentence was fixed and the button was not.

Plans is a surface nothing this week had driven, and it is the routine bug's sibling — a saved
thing pointing at an activity, shown on a day you have not reached. `chronicle_plan_did` hands a
plan's own times to `chronicle_entry_add`, which checked the span's direction and its length and
nothing else. Measured in the room with the clock at 15 Oct 06:30, pressing ✓ on tomorrow's
`7:00–7:45 · Gym`:

> **Gym 45m SHORT 7:00 AM – 7:45 AM** · Free Time 45m · "1h 15m · 45m done"

Forty-five minutes of gym, twenty-five hours ahead, counted in a day's totals. ⏱ Fill a gap is the
same door by hand, which is why the check went into `chronicle_entry_add` rather than into either
caller — and into `chronicle_entry_edit` too, since a rule only one write path keeps is one you get
around by adding a legal sitting and editing it forward.

**The start, not the end**, and the same check `chronicle_running_fix` has always made in the same
words. A span whose end is slightly ahead is what logging a block you are in the middle of looks
like, and what a clock two minutes fast produces. **And last of the three checks**, so every input
refused before this is still refused with the same words — only inputs that were _accepted_ can
newly be refused.

⚠️ **THE POSITIVE CONTROL NEARLY DIDN'T HAPPEN, AND WOULD HAVE HIDDEN A DISASTER.** The first pass
through the room after the fix showed every tick disabled on Today as well as Tomorrow, which reads
exactly like proof the fix works. It was the clock: 06:34, with both of the day's plans at 10:00
and 14:00, so all four were legitimately in the future. A guard with no positive control is a guard
that might have turned the feature off. A plan made for 05:00 that morning is still tickable, and
pressing it logged "Gym 30m" and moved the fold to "3h · 2h 11m done".

**And the room no longer offers it.** The server refusing is correct and not sufficient: a button
whose only possible answer is an error should not be lit. ✓ is disabled on a plan that has not
started, titled "Not yet — this has not started" — the same lesson as the archived step in a
routine, one surface over. 375: three rows, ticks 44×38, nothing over the list.

## 6bp · ✅ Sixty reps became sixty pages

Moving a session to another activity exists because pressing Start on the wrong one is the
likeliest mistake a stopwatch allows. An amount exists because some activities count something —
reps, pages, maps. Put together, they had a hole: **the number stayed while its unit changed.**

Measured in the room. `Gym · 45m · 60 reps` opened in the editor, activity switched to Writing,
nothing else touched, Save:

> **Writing 45m 60 pages**

The box's placeholder flipped from "reps" to "pages" the instant the activity changed — so the
form knew the unit had changed and kept the number anyway.

**And a second door, quieter.** The amount box follows the SELECTED activity, which is right, so
moving onto something that counts nothing takes the box away. The save then skipped `setAmount`
entirely, because it only ran `if (metric)`. The old number stayed in the row, invisible, and came
back out the moment the session was moved onto an activity with a metric again. Hidden state that
reappears is worse than a cleared field: nobody chose it and nobody can see it to undo it.

Both have one root — a quantity belongs to a metric — and one fix. When the selected activity's
metric differs from the one the box is currently under, the number goes, **visibly, while somebody
is looking at it**. And when a session lands on an activity that counts nothing and it had an
amount, that amount is cleared rather than left behind; only when there is one to clear, so the
ordinary edit still costs two round trips rather than three.

Four cases, the last two being the controls that stop this from being an over-correction:

| move                                            | the number                         |
| ----------------------------------------------- | ---------------------------------- |
| Gym (reps) → Writing (pages)                    | cleared                            |
| → Dishes (counts nothing), then back to Gym     | cleared, and does not come back    |
| same activity: type 25, then edit only the note | 25, and still 25                   |
| Writing (pages) → the difficult chapter (pages) | **kept** — same unit, same meaning |

⚠️ **A THIRD DOOR IS OPEN AND IS NOT MINE TO SHUT.** Editing an ACTIVITY to change or remove its
metric does the same thing from the other side: every amount already recorded against it keeps its
number and loses its meaning, invisibly, until a new metric brings them back out under the wrong
word. The repair would mean deleting quantities out of rows somebody recorded, which is
irreversible and is Evan's call rather than mine — see CLAUDE.md §4. Named here rather than done.

**And a note on getting a clean fixture.** Clearing localStorage to reset the preview store did not
reset it — the store is module state — but it did remove `dev_preview_member`, so the room came
back signed-out and the next reading was taken against a sign-in card. The store is reset by a real
`location.reload()`; navigating to the same `#chronicle` URL is a hash change and reloads nothing,
which is why the first "fresh" seed still had the previous test's row in it.

## 6bq · ✅ A goal that could never move, made through the form

Every goal examined this week came out of the seed. Nothing had ever gone through the goal editor,
which is the room's other half and has more fields than any other form in it.

The form asks what to count FROM, and then — only when the chosen activity names a metric — offers
a second choice: count the time, or count the reps. Both are right. But they are **two controls**,
and the second kept its answer when the first moved beneath it. Pick Gym, choose "count the reps",
change the source to Dishes: the chooser vanishes, `countWhat` stays on `amount`, the save sends it.

What that made, sitting in the same list as its own counter-example:

| goal                                     | source      | reads               |
| ---------------------------------------- | ----------- | ------------------- |
| Read ten books _(made through the form)_ | FROM DISHES | **0 / 10 done**     |
| Wash up every evening _(from the seed)_  | FROM DISHES | **12 / 10 minutes** |

Same activity, same twelve minutes in the log two inches above, one stuck at zero for ever — it
was measuring a quantity Dishes never records. The unit read "done" rather than "minutes", which
is `unitFor` faithfully reporting the nonsense it was handed. **This is §6bd's shape, and the first
instance anybody could create on purpose rather than inherit.**

⚠️ **AND THE SERVER HAD TO BE READ BEFORE CALLING IT A PRODUCT BUG.** The comment beside
`countWhat` says "the table refuses that pairing and the save function corrects it", which would
have made this a double-fidelity problem instead. `chronicle_goal_save` does correct one case —
`if v_counts = 'amount' and v_act is null` — and Dishes is not null. The correction had one half of
the question. The preview was reproducing the server faithfully.

Fixed in both places, because a rule the client alone keeps lasts until the next caller: the room
**derives** what a goal counts from its source rather than remembering it, so a stale answer cannot
reach a save, and the server's correction now asks both halves — is there an activity, and does it
name a metric. Corrected rather than raised, like its sibling: somebody who has typed a title, a
number and a source has written down something they mean.

**Checked, including the control that stops it being the feature switched off:**

- 0 of 1 goals on the account count an amount, so nothing stored is wrong — this is preventive.
- Through the form: Gym + "count the reps" offers `reps`; moving the source to Dishes turns the
  unit box from **"done"** to **"minutes"**; saved, it reads `12 / 10 minutes` and agrees with the
  seed's goal on the same activity.
- A goal genuinely counting reps still does: `Sixty reps a day · FROM GYM · REPS · 60 / 60 reps`.

## 6br · ✅ A goal that said reps and counted pages

§6bq drove the goal form's CREATE path. The EDIT path loads a stored goal back into the same form,
including its stored `unit` — and `unitFor` is explicit that **a typed word always wins**. So the
same question as §6bp, one surface over: what happens to the word when the thing it describes
changes underneath it.

Made a goal counting Gym's reps, then edited it to point at Writing, which counts pages:

> **Sixty reps a day · FROM WRITING · PAGES · 0 / 60 reps**

The chip says pages. The meter says reps. One row, contradicting itself, and the number underneath
is counting the one the chip names.

**The fix had to not break the rule it was tripping over.** `unitFor` lets a typed word win because
it must — somebody counting an activity's minutes who calls them "pomodoros" means pomodoros, and
a room that corrects that is a room arguing with its owner. But `unitFor` is also what FILLS the
box on save, so a goal saved against Gym comes back with "reps" in it, and that word is the room's,
not the person's.

So the rule is: **when the source changes, a box still holding the OLD suggestion is emptied and
refills from the new one; a box holding anything else is left exactly alone.** The same applies to
the count-the-time/count-the-reps chooser, which changes the suggestion without touching the source.

Both halves driven, which is the whole of the verification:

| goal                                           | unit box                              | after moving to Writing |
| ---------------------------------------------- | ------------------------------------- | ----------------------- |
| Sixty reps a day — "reps" is the room's word   | `reps` → cleared, placeholder `pages` | **0 / 60 pages**        |
| Pomodoro drawing — "pomodoros" is the person's | `pomodoros` → kept                    | **0 / 4 pomodoros**     |

One honest edge: somebody who types the very word the room would have suggested is indistinguishable
from the room having suggested it, so their word follows too. The outcome is the right word for the
new source either way, which is why it is left rather than pursued.

## 6bs · ✅ Ten books a quarter quietly became ten books a year

Three fixes in two ticks had the same shape — a stored value whose meaning comes from another
field that can change without it. Rather than wait to trip over the fourth, every chronicle column
was asked the same question: **what gives this its meaning, and can that change underneath it?**

One answer stood out. A goal's `scope` gives meaning to its `anchor`, its `repeat_every` and its
`target` — "ten" means ten a quarter or ten a year depending on it — and **the form has no control
for it at all**. The save sent `scope: v.scope`: the scope of the view you are looking at.

For almost every goal that is the same thing, because a day goal only ever appears in the day
list. **A quarter goal appears under the YEAR**, by `homeFor`. So:

> before `Read ten books · THIS QUARTER · ◉ · 3 / 10 books`
> open the editor in the only list it appears in, change nothing, press Save
> after `Read ten books · 3 / 10 books`

Ten books a quarter, silently rewritten as ten books a year. ⚠️ **And this was a consequence of
making quarter goals visible** — §6bd. Before that they were in no list, so no editor could be
opened on one and `v.scope` always happened to be the goal's own. Fixing a thing into view gives
it neighbours it never had, and one of them was wrong.

An edit now keeps the goal's own scope, and its own anchor: taking `win.from` would move a one-off
onto whatever window is on screen. The fallback is only for the case with no anchor to keep — a
repeating goal whose repeat has just been switched off, which needs one in its own scope.

**The same Save lost a second thing, and that one was the harness.** The ◉ beside the goal came
back as ○. `chronicle_goal_save`'s update names every column it writes and `shared` is not among
them, so the server leaves it alone — sharing is `chronicle_goal_share`'s business. The double
rebuilt the row from `NewGoal`, which has no such field, so every edit quietly unticked it. A loss the
real site does not have, which is the worst kind of infidelity: it looks exactly like a bug worth
chasing. Fixed and pinned.

**Four readings, the last three being the controls:**

|                                 |                                                                         |
| ------------------------------- | ----------------------------------------------------------------------- |
| Save changing nothing           | `THIS QUARTER · ◉ · 3 / 10 books` — identical before and after          |
| Save changing the target        | `THIS QUARTER · ◉ · 3 / 12 books` — the change lands, the rest holds    |
| A new goal made on the week tab | in the week list only — not year, not today                             |
| Unticking "every day"           | one-off, streak chip gone, still in today's list, no leak into the week |

## 6bt · ✅ The column sweep, and the third write path it found

Four fixes in three ticks had one shape, so every chronicle column was asked the same two
questions: **what gives this its meaning, and can that change without it?** Recorded so nobody
repeats the sweep.

| column                         | its meaning comes from             | verdict                                                                                                                                                                       |
| ------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entries.amount`               | the activity's `metric`            | §6bp — fixed when the entry moves; §6bu drove the other door, which now asks before it is taken. The repair itself is still Evan's call, since it deletes recorded quantities |
| `entries.quality`              | a fixed 1–5 scale                  | nothing can move under it                                                                                                                                                     |
| `entries.note`                 | itself                             | —                                                                                                                                                                             |
| `goals.counts`                 | whether the source counts anything | §6bq — fixed in room and server                                                                                                                                               |
| `goals.unit`                   | what is being counted              | §6br — the room's word follows, a typed one stays                                                                                                                             |
| `goals.scope`                  | the list it is shown in            | §6bs — an edit keeps the goal's own                                                                                                                                           |
| `goals.anchor`, `repeat_every` | `scope`                            | held by the same fix                                                                                                                                                          |
| `goals.target`                 | `unit` / `counts`                  | **left alone deliberately** — it is always typed by the person and never auto-filled, so "a typed value wins" applies, as it does to the unit                                 |
| `goals.progress`               | `unit`, for a hand-moved goal      | benign: giving a goal a source hides its progress rather than reinterpreting it, and removing the source brings the same number back                                          |
| `activities.session_mins`      | itself                             | the "SHORT" marker is judged live, not stored, so changing it re-judges rather than reinterprets                                                                              |
| `activities.cat`               | itself                             | a category goal's total moving when an activity changes category is the total being right                                                                                     |

**And the sweep turned up something else: a third write path.** §6bo put "not in the future" into
`chronicle_entry_add` and `chronicle_entry_edit`, reasoning that a rule only one write path keeps
is one you get around. There are three. ⬆ Put one back inserts entries directly.

`chronicle_import` does that deliberately — its own comment says restating the table's constraints
as WHERE clauses is "a second copy of the rules that drifts", and lets the table refuse what it
will. That is right for `ended_at > started_at`, which **is** a constraint. It is not an argument
about these two, because neither is:

⚠️ **AND NEITHER CAN BECOME ONE.** The future rule is not immutable, so Postgres will not take it.
The 24-hour rule could be — and **must not be**: `chronicle_start` and `chronicle_stop` close a
forgotten timer with `ended_at = clock_timestamp()`, so a timer left running over a weekend would
fail that constraint and lock somebody out of starting anything at all. The loop is the only place
either can live, and the loop already restates one non-constraint rule — `a.owner = me`.

Checked against the live function with a crafted four-entry file:

| row                                 |                                            |
| ----------------------------------- | ------------------------------------------ |
| an ordinary sitting three hours ago | in                                         |
| seventy-two hours long              | refused                                    |
| starting twenty-five hours from now | refused                                    |
| running, no end at all              | **in** — an open sitting has no length yet |

`entries 2, skipped 2`, counted in the tally the person is shown, and rolled back.

## 6bu · ✅ Renaming what an activity counts, and a guess that was wrong

§6bt left one door open: an activity's own `metric` changing, under amounts already recorded
against it. It was listed from reading rather than from driving, and driving it corrected the
entry.

**The guess was that clearing a metric would break goals pointed at it** — counts stuck on
`amount` against an activity that counts nothing, the §6bq shape. It does not. Measured: clearing
Gym's metric left "20,000 reps · 180 / 20000 reps" reading exactly as before, because clearing a
metric does not touch the entries' amounts and the tally still sums them. What it does is stop the
log DISPLAYING them — "Gym 45m 60 reps" becomes "Gym 45m" — since the room only shows an amount
beside a metric. Hidden, not broken.

**The door that does rewrite meaning is a swap**, one word for another, and it is worse than the
entry side alone:

|                    |                                                                 |
| ------------------ | --------------------------------------------------------------- |
| the log            | `Gym 45m` **`60 pages`** — sixty reps, relabelled               |
| a goal counting it | `20,000 reps · FROM GYM · `**`PAGES`**`· 180 / 20000`**`reps`** |

The goal's chip is read live off the activity; its unit is stored. One row, disagreeing with
itself — §6br reached from the other side.

**Repairing it still means deleting quantities out of sessions somebody recorded, so it is still
not mine to do.** What is mine is to say so at the moment of choosing, which is the lesson the
delete confirmation already carries in this room: a confirmation that understates what it does is
worse than none.

> Anything already recorded against Gym was counted in reps. Changing this to pages makes every
> one of those numbers read as pages instead. Change it?

⚠️ **ONLY WORD → DIFFERENT WORD.** Naming a metric for the first time cannot relabel anything
recorded without one, and clearing hides rather than reinterprets. Both measured, not reasoned —
which is also how the wrong guess above was caught.

Four readings, with `window.confirm` stood in because the pane auto-dismisses it:

|                          |                                                                 |
| ------------------------ | --------------------------------------------------------------- |
| reps → pages, declined   | asked once; log still `60 reps`; the editor kept what was typed |
| reps → pages, accepted   | asked once; `· pages`, log `60 pages`                           |
| none → "loads" on Dishes | **not asked**                                                   |
| reps → cleared           | **not asked**; the amount stops showing, as it should           |

## 6bv · ✅ The writer nobody presses

Three write paths into `chronicle_entries` refuse a span longer than a day. There is a fourth, and
it is the one no one operates: `chronicle_visit`, which records time on the site by itself. It
extends the last sitting whenever the previous beat landed within three minutes — what makes a
visit a sitting rather than a thousand scraps — **with no ceiling at all**. A tab left visible on
a desk grows one row for as long as it is open.

|                      |                          |
| -------------------- | ------------------------ |
| before the next beat | 23.9917 h, 1 sitting     |
| after it             | **24.0083 h**, 1 sitting |

⚠️ **The first attempt to show that proved less than it looked.** The fixture began at 30 hours, so
the reading showed a 30-hour row and an extension happening — not the extension _crossing the
line_, which was the claim. Re-run from 23h59m30s it crosses in a single beat.

**And Archive did nothing to it.** Nobody creates this activity; the room makes it the first time
you are seen in a module, so Archive is the only lever over it — and minutes kept arriving against
something you had put away, every day, with no way to stop them. The lookup still finds the
archived row on purpose: filtering it out would make a _second_ activity of the same name on the
next visit. It is found, and then nothing is written.

Five readings, two of them controls: a sitting past a day is left alone and a new one begun
(2 sittings, longest 23.99h); a 20-minute-old sitting still coalesces (1 sitting); an archived one
records nothing and grows no twin; a module seen for the first time still records.

⚠️ **AND THE TEST FOR THE ARCHIVE RULE WAS WRONG TWICE, both times passing.** Counting rows cannot
tell the rule from its absence — without it the visit EXTENDS the recent sitting rather than adding
one, so the count is identical either way. Asserting the end timestamp instead fails for a duller
reason: these run inside a millisecond, so extending writes back the very value it already had and
"it did not move" is true in both worlds. Only after ageing the sitting past the three-minute
window does the difference become a whole new row. Perturbation caught it both times; the test
itself was green throughout.

## 6bw · ✅ Counting the write paths, and a sentence I had written three times

Three commits now said some version of _"every other way into this table refuses a span longer
than a day"_. That is the kind of sentence worth checking rather than repeating, so the question
was asked properly: **how many functions write to `chronicle_entries`?**

**Ten.** Not four.

|                        |                                                                             |
| ---------------------- | --------------------------------------------------------------------------- |
| told a span            | `chronicle_entry_add`, `chronicle_entry_edit`, `chronicle_import`           |
| makes up its own       | `chronicle_visit`                                                           |
| **measures one**       | `chronicle_start`, `chronicle_stop`                                         |
| touches no times       | `chronicle_entry_amount`, `chronicle_entry_quality`, `chronicle_entry_drop` |
| moves a start, guarded | `chronicle_running_fix`                                                     |

⚠️ **AND THE SENTENCE WAS FALSE.** `chronicle_start` and `chronicle_stop` close a timer with
`ended_at = clock_timestamp()` and keep no day rule at all. Measured: a timer left running thirty
hours is closed at **30.0h**, exactly as it should be. A sitting the clock MEASURED is however long
it ran; refusing it would throw away what somebody actually did. The bound belongs to spans
somebody ASSERTS — typed into ⏱ Fill a gap, carried in by a file, or synthesised by the visit
writer — and to nothing else.

That distinction is the useful half of the finding, and it is now in CLAUDE.md with the
enumeration query, because the next person to tidy this will reach for a CHECK constraint. They
must not: closing a day-long timer would fail it, and `chronicle_start` closes the old sitting
before opening a new one, so it would stop them starting anything at all.

⚠️ **THE QUERY ALMOST WENT INTO THE STANDARD BROKEN.** Condensed from the one that worked, it lost
`p.prokind = 'f'` — and `pg_get_functiondef` raises on an aggregate, so it errors on `array_agg`
before reaching any chronicle function. CLAUDE.md §11 keeps queries rather than lists precisely
because a list rots; a query that does not run is worse than the list it replaced. Run before
committing, and it returns all ten.

## 6bx · ✅ The write-path question, asked of a second table

§6bt and §6bw are about counting the ways into `chronicle_entries`. The useful generalisation is
narrower than "count the paths": **a rule that lives in a function rather than in a constraint is
a rule the second path will not have.** Asked of `chronicle_goals`, the answer was the same.

The table says `counts = 'minutes' OR activity IS NOT NULL` — an amount needs _an_ activity. The
other half, that the activity must **name a metric**, cannot be a CHECK at all: it is a fact about
a different row. So it lives in `chronicle_goal_save`, and ⬆ Put one back kept only the table's
half.

Confirmed against the live function with a crafted file, before:

| goal                  | counts   | its source counts |
| --------------------- | -------- | ----------------- |
| counts what it cannot | `amount` | **(none)**        |
| counts what it can    | `amount` | reps              |

The first is §6bq restored from a file — a goal reading 0 for ever with the minutes in the totals
above it. After the fix it imports as `minutes`, while both controls keep what they had.

**Corrected rather than refused**, matching the save path: all three rows go back and none is
counted as skipped, because the goal is still a goal somebody wrote down — it just measures time.

## 6by · ✅ The sweep finished, and an asymmetry that is right

The question — _which rules live in a function rather than a constraint, and does the second path
keep them?_ — asked of all four chronicle tables. Two paid (§6bt entries, §6bx goals). The other
two are clean, and one of them explains something that would otherwise read as an oversight.

| table                  | the rule                                  | where it lives                               | the other paths         |
| ---------------------- | ----------------------------------------- | -------------------------------------------- | ----------------------- |
| `chronicle_plans`      | ends after it starts                      | **constraint**                               | covered                 |
|                        | no longer than a day                      | **constraint** `chronicle_plan_within_a_day` | covered                 |
| `chronicle_routines`   | 8 KB of steps                             | **constraint**                               | covered                 |
|                        | at most forty steps                       | function                                     | import does not keep it |
|                        | steps name your own activities            | function                                     | import does not keep it |
| `chronicle_activities` | name, colour, cat, metric, session length | **constraints**                              | covered                 |
|                        | at most two hundred                       | function                                     | import does not keep it |

Driven rather than inferred: a file carrying a one-hour plan, a thirty-hour plan and a backwards
one put **only the one-hour plan back**. The table refused the other two and the import counted
them, which is exactly what its design says it will do.

⚠️ **AND `chronicle_plans` HAS THE DAY RULE AS A CONSTRAINT WHILE `chronicle_entries` CANNOT.**
That looks like an oversight on entries and is the opposite. A plan is always ASSERTED — somebody
typed two times into a form — so a constraint is safe. An entry can be MEASURED: `chronicle_stop`
closes a timer with `ended_at = clock_timestamp()`, so the same constraint on entries would make
closing a day-long timer fail, and `chronicle_start` closes the old sitting before opening a new
one, so it would stop somebody starting anything at all. The schema already embodies the
distinction §6bw arrived at from the other direction. **Nobody should "fix" the gap on entries.**

**The three function-only rules left open are bounds, not meanings**, and all three need a
hand-edited file: a routine with more than forty steps, a routine step naming an activity you do
not have, and more than two hundred activities. None changes what anything means, none can be
reached through the room, and the first and third are already bounded — 8 KB of steps, and the
file's own 50,000-row ceiling. The middle one lands on the `gone` state that §6bl built for an
archived step: shown, disabled, and not blocking the rest. Named here rather than fixed.

## 6bz · ✅ The file flow driven at last, and what was sitting beside it

⬇ Save a copy and ⬆ Put one back had been tested in SQL and in the double for a week and **never
once through the UI**. Driven now, the whole flow is sound:

|                                  |                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Save a copy                      | a 14 kB `application/json` blob, `chronicle-2026-10-15.json`, 7 activities · 20 entries · 11 goals · 1 routine · 4 plans |
| that same file back              | **"Everything in that file was already here"**                                                                           |
| a file with rows it has not seen | **"Added 2 — 1 sessions, 1 activities, 0 goals."**, and the row appears without a reload                                 |
| not JSON                         | "That file could not be read"                                                                                            |
| JSON, not ours                   | "Not a chronicle file" — capitalised from the server's lowercase                                                         |
| a newer version                  | "That file is from a newer version"                                                                                      |
| an empty chronicle file          | "There was nothing in that file"                                                                                         |

⚠️ **AND ONE OF THOSE READINGS WAS NEARLY A FALSE BUG REPORT.** "JSON, not ours" first came back
with **no message at all**, which reads exactly like a missing refusal. It was the measurement:
four imports fired back to back, the toast element reused rather than replaced, and a
`childList`-only `MutationObserver` sees nothing when only text changes. Watched with
`characterData: true` and a gap to let the previous toast clear, the refusal is there. **A toast is
transient and reused — observe the character data, and leave time between trials.**

**The real finding was in the log beside it.** While reading the restored rows, two sittings on the
auto activity overlapped: one running from 1:12, one written by the visit writer from 1:19 to 1:21.
Free Time read **56m on a day holding 55** — the overlapping minute counted in both, because
nothing dedupes two entries on one activity.

The room already knew this was wrong. The Quick start row has carried the reason since it was
built: _"a button that started a timer on it would be recording something the site is already
recording, twice over"_ — and it filters auto activities out. **The dropdown beside it and ⏱ Fill a
gap did not.** The rule held for the shortcut and for neither real way in.

It is one named list now, `yours`, used by all three. The entry editor deliberately keeps them:
moving a session OFF an auto activity has to stay possible, and a picker that cannot show its own
current value is the lie about state §6-earlier is about. The Activities fold keeps them too, which
is where Archive lives — and §6bv made that lever work.

Verified after: start, quick and gap all offer the same five activities and no "Chronicle"; the
editor still offers it; the fold still lists it. **And the preview seed was demonstrating the
forbidden state** — its running sitting was on the auto activity, which is how the overlap appeared
at all. It runs on Drawing now.

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
2. ~~**`quarter` in the scope list**: worth having, or noise?~~ **Answered 14 Oct 2026** — _"quater
   is not worth a tab"_. The view is gone. The SCOPE is not: `chronicle_goals_scope_check` still
   accepts it, `windowOf` still computes it and `Looking` still has a word for it, because a file
   imported through ⬆ Put one back can contain a quarter goal and a scope the table accepts with
   nothing able to render it is a goal somebody can create and never see again. That leaves exactly
   one door into the state, which is the narrowest the question can be left without a migration —
   see the note at the top of `src/sections/Chronicle.tsx`. **And a goal that walks through that
   door is now visible**, which it was not: see §6bd.
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
