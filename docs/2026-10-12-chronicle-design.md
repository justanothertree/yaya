# Chronicle — a design, before any of it is built

**Status: ✅ STEPS 1–4 APPLIED, 12 Oct 2026.** Migrations `chronicle_goals`, `chronicle_goal_rpcs` and
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
