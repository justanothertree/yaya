-- ⛔ NOT APPLIED. Integrity check 10, drafted 16 Nov 2026 and previewed read-only against
-- production. Applying it is `apply_migration`, after which this header becomes ✅ APPLIED with
-- the migration name, per CLAUDE.md §4.
--
-- ── WHY IT EXISTS AT ALL ──────────────────────────────────────────────────────────────────────
--
-- `finance.symbol_designations` and `finance.allocations` are written by two different paths that
-- never consult each other: `admin_set_symbol_designation` writes the designation and even-splits
-- the trades, while `admin_set_trade_allocation` — the "Theirs" button on one trade — writes only
-- the allocations and stamps `reviewed_at`. One reader, `isFamily`, asks the designation. So a
-- position every family account wholly owns can carry no designation row anywhere, and the single
-- screen built to say who owns what calls it 🔒 Personal.
--
-- Measured 14 Nov 2026 and still true: AKAM, CURI, GENI, MNRO and SKHY on robinhood, 79.956946
-- units, $813.84 at cost, all five 100% family-owned.
--
-- It is not an error. The state is legitimate and Evan may well want it — it is a thing to be
-- TOLD, which is why it belongs here rather than anywhere that refuses something.
--
-- ── WHY IT IS BEING WRITTEN NOW RATHER THAN IN THE PROPOSAL THAT SKETCHED IT ──────────────────
--
-- `docs/2026-11-14-correction-follows-ownership.sql` deliberately left this a sketch, because the
-- body of `finance.integrity_checks()` is 6 kB and copying 6 kB into a proposal is how a copy and
-- its original drift. That was the right call, and the way out is not a more careful copy: the
-- body below was produced by SURGERY on the repository's own committed text, two anchored string
-- replacements in a script that throws if either anchor is missing. The nine existing checks are
-- byte for byte identical by construction rather than by my proofreading.
--
-- The text surgered was verified to be what production is running, not merely what the repository
-- says: `md5(prosrc)` of the live function and `md5()` of the body in
-- `supabase/migrations/00000000000000_baseline.sql` are both
-- beffb1ed10c19c565f1a02672eb23680 at 6,082 bytes. `pg_get_functiondef` was deliberately NOT
-- used as the source — `applied.md5`'s own header records `20261027004612` as the migration that
-- went wrong by being written back out of the live database that way.
--
-- `diff` of the proposed body against the committed one: exactly two hunks, exactly one line
-- removed. The removed line is the sort, below.
--
-- ── ⚠️ THE SORT IS A TEXT SORT, AND THIS IS THE HALF THAT WOULD HAVE SHIPPED QUIETLY ──────────
--
-- `order by c->>'ord'` compares strings, and `ord` is text. Nine checks never exposed it, because
-- '1'..'9' sort the same either way. A tenth does. Measured in production rather than reasoned
-- about:
--
--     select string_agg(v, ', ' order by v)      over 1..10  ->  1, 10, 2, 3, 4, 5, 6, 7, 8, 9
--     select string_agg(v, ', ' order by v::int)  over 1..10  ->  1, 2, 3, 4, 5, 6, 7, 8, 9, 10
--
-- So check 10 would have appeared SECOND in the Reconcile list, between 1 and 2, and nothing
-- would have said so — `ReconcilePanel` renders the array in the order it arrives and keys on
-- `label`, never on `ord`. The cast leaves every existing `ord` VALUE untouched, so the first
-- nine keep their order and the UI's keys do not move.
--
-- ── ⚠️ THE MEANING DELIBERATELY NO LONGER NAMES THE CORRECTION ────────────────────────────────
--
-- The sketch's `meaning` ended "A ✏️ correction to one of these gives them none of it." That was
-- the sharpest consequence and it stopped being true on 16 Nov 2026, when migration
-- `20261116020828` made `admin_correct_position` ask `finance.family_share_at` instead of the
-- flag. Shipping the sketch verbatim would have put a sentence about a version of the code that
-- no longer exists onto the admin screen — §2, from the direction where the thing that falsifies
-- a claim is a change made an hour earlier in a different file. Two pieces of on-screen copy in
-- `Investments.tsx` said the same thing and were corrected in the same sitting.
--
-- ── WHAT APPLYING IT CHANGES ON SCREEN ────────────────────────────────────────────────────────
--
-- Nothing in the client needs to change, which is why this is SQL alone: `Check` is
-- `{ label, count, meaning }`, the panel's heading counts `report.checks.length` and so says "All
-- 10 checks clear" by itself, and `admin_attention.integrity` counts CHECKS WITH A NON-ZERO COUNT
-- rather than summing them — so the badge moves by exactly one, not by five.
--
-- Measured, read-only, against production at 16 Nov 2026 02:2x UTC:
--
--     before  1:0  2:0  3:0  4:0  5:0  6:1  7:0  8:0  9:2            badge integrity = 2
--     after   1:0  2:0  3:0  4:0  5:0  6:1  7:0  8:0  9:2  10:5      badge integrity = 3
--
-- Check 5 ("Family holding with no price") reads 0 now: the 15 Nov 21:10–21:16 UTC sweep priced
-- the seven positions the 14 Nov audit found unpriced.
--
-- ── ⚠️ THE PREDICATE, PERTURBED RATHER THAN ARGUED FOR ────────────────────────────────────────
--
-- It must be `coalesce(sd.is_family, false) = false` and not `sd.asset_symbol is null`. Today all
-- five are the null kind, so the two agree and the choice looks free — which is exactly the
-- fixture problem §2 warns about, one dimension pinned flat. Simulated an explicit `false` row on
-- GENI while its allocations stand, read-only:
--
--     live, coalesce form   5      SIMULATED explicit-false, coalesce form   5
--     live, is-null form    5      SIMULATED explicit-false, is-null form    4
--
-- A null row is an omission; an explicit `false` sitting beside live allocations is a
-- contradiction, and it is the more alarming of the two. The is-null form misses it. Symbols in
-- that state today: 0, so the guard is bought before it is needed.
--
-- ── THE GRANT ─────────────────────────────────────────────────────────────────────────────────
--
-- `create or replace function` preserves privileges, and this function's ACL is
-- `{postgres=X/postgres}` — not `authenticated`, not `service_role`. It is reached only through
-- `admin_reconciliation` and `admin_attention`, both SECURITY DEFINER and both checking
-- `is_admin()`, which is the house pattern in §3: one question answered in one place. The revoke
-- below is a reaffirmation and not a change, and there is deliberately no matching grant — §3's
-- "don't grant what cannot be used", from the side where the answer is to grant nothing.

create or replace function finance.integrity_checks()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'finance', 'pg_temp'
as $function$
  select jsonb_agg(c order by (c->>'ord')::int) from (
    select jsonb_build_object('ord','1','label','Family given more units than a trade held',
      'count', (select count(*) from (
         select al.executed_trade_id, sum(al.units_allocated) su, max(et.units_acquired) ua
         from finance.allocations al join finance.executed_trades et on et.id = al.executed_trade_id
         group by al.executed_trade_id) t where abs(su) > abs(ua) + 0.0001),
      'meaning','A trade was split for more than it contained. The totals would be too high.') as c
    union all
    select jsonb_build_object('ord','2','label','A family holding with negative units',
      'count', (select count(*) from (
         select et.asset_symbol, sum(al.units_allocated) u
         from finance.allocations al join finance.executed_trades et on et.id = al.executed_trade_id
         group by et.asset_symbol) h where u < -0.0001),
      'meaning','They own less than nothing of something — usually a split allocated whole to a position they only partly own.')
    union all
    select jsonb_build_object('ord','3','label','Allocation older than the account it belongs to',
      'count', (select count(*) from finance.allocations al
         join finance.executed_trades et on et.id = al.executed_trade_id
         join finance.family_accounts fa on fa.id = al.family_account_id
        where et.execution_time::date < fa.start_date),
      'meaning','An account was given a trade from before it existed — your own history counted as theirs.')
    union all
    select jsonb_build_object('ord','4','label','Trade split unevenly across accounts',
      'count', (select count(*) from (
         select executed_trade_id, count(*) n, round(min(units_allocated),8) lo, round(max(units_allocated),8) hi
         from finance.allocations group by executed_trade_id) x
        where n <> (select count(*) from finance.family_accounts where dollar_per_day > 0) or lo <> hi),
      'meaning','Someone got a different share than the rest. Everyone is meant to get the same.')
    union all
    select jsonb_build_object('ord','5','label','Family holding with no price',
      'count', (select count(*) from (
         select et.asset_symbol from finance.allocations al
         join finance.executed_trades et on et.id = al.executed_trade_id
         group by et.asset_symbol having sum(al.units_allocated) > 0.0001) h
        where not exists (select 1 from finance.price_cache pc where pc.asset_symbol = h.asset_symbol)),
      'meaning','Worth today is understated — that holding is being counted as zero.')
    union all
    select jsonb_build_object('ord','6','label','Price older than three days',
      'count', (select count(*) from finance.price_cache pc
        where pc.updated_at < now() - interval '3 days'
          and exists (select 1 from finance.allocations al
                      join finance.executed_trades et on et.id = al.executed_trade_id
                     where et.asset_symbol = pc.asset_symbol
                     group by et.asset_symbol having sum(al.units_allocated) > 0.0001)),
      'meaning','A family holding is priced from a stale quote.')
    union all
    select jsonb_build_object('ord','7','label','Family credited with more than you actually hold',
      'count', (select count(*) from finance.position_overcredit() where excess_dollars > 1),
      'meaning','You sold out of something they part-own without splitting the sale — they are holding shares you no longer have.')
    union all
    -- ⚠️ #8 EXISTS BECAUSE #7 CANNOT SEE ITS OWN SHAPE. #7 tests each symbol against a dollar,
    -- which is right for the failure it names: one sale that forgot the family. It is
    -- structurally blind to the opposite shape, a small error on many symbols at once. Measured
    -- when this was written, #7 read 0 while 23 symbols were over-credited by a total of $0.56 --
    -- the 2025-12-01 broker unit-corrections predate the fund start, so they were correctly left
    -- unallocated and nobody reduced the family's share to match. Twenty-three two-cent errors
    -- are invisible to a per-symbol threshold no matter how long they accumulate.
    select jsonb_build_object('ord','8','label','Small over-credits that add up',
      'count', (select case when coalesce((select sum(excess_dollars) from finance.position_overcredit()), 0) > 1
                            then (select count(*) from finance.position_overcredit())
                            else 0 end),
      'meaning','Individually too small for the check above, but together worth more than a dollar across the fund.')
    union all
    -- ⚠️ #9: A DECISION THAT CAN NEVER TAKE EFFECT. A symbol marked family whose every trade
    -- predates the fund start will never be allocated -- the start_date rule blocks it, correctly
    -- -- and it is invisible to trades_needing_review for exactly the same reason, so
    -- admin_attention never counts it either. AEON and NFLX have sat like this since 2025-12-05
    -- and 2025-12-08: $115.77 at cost, designated theirs, belonging to nobody, with nothing on
    -- any screen that would ever ask about them.
    select jsonb_build_object('ord','9','label','Marked family, but nothing can be allocated',
      'count', (select count(*) from (
         select sd.asset_symbol, sd.platform
           from finance.symbol_designations sd
          where sd.is_family
            and exists (select 1 from finance.executed_trades et
                         where et.asset_symbol = sd.asset_symbol and et.platform = sd.platform)
            and not exists (
              select 1 from finance.executed_trades et
               where et.asset_symbol = sd.asset_symbol and et.platform = sd.platform
                 and et.execution_time::date >= (select min(start_date) from finance.family_accounts
                                                  where dollar_per_day > 0))) z),
      'meaning','Every trade in it is older than the fund, so the family can never receive any of it. Undesignate it, or the decision just sits there.')
    union all
    -- ⚠️ #10: THE TWO WRITE PATHS DISAGREE ABOUT A SYMBOL, and the state is legitimate rather
    -- than broken -- which is why this is a thing to be TOLD and not an error. A position can be
    -- wholly owned by all 33 family accounts with no designation row anywhere, because
    -- `admin_set_symbol_designation` writes the designation and even-splits the trades, while
    -- `admin_set_trade_allocation` -- the "Theirs" button on one trade -- writes the allocations,
    -- stamps reviewed_at, and never touches symbol_designations at all. Two writers, one reader.
    -- Measured 14 Nov 2026: AKAM, CURI, GENI, MNRO and SKHY on robinhood, 79.956946 units,
    -- $813.84 at cost, every one of them 100% family-owned and reading Personal to the gate.
    --
    -- ⚠️ WHAT IT DELIBERATELY NO LONGER CLAIMS. Until 16 Nov 2026 the sharp consequence was that
    -- `admin_correct_position` gated the family's share of a correction on this same flag, so a
    -- missed split handed them none of it and their share of the position shrank silently. That
    -- is fixed -- 20261116020828 made the correction follow ownership -- and a check that still
    -- named it would be this file telling the truth about a version of the code that no longer
    -- exists. What remains is real and smaller, and is what the meaning below says: the screens
    -- that answer "whose is this" read the SYMBOL, and admin_even_split_trades will not split
    -- future trades of it automatically.
    --
    -- ⚠️ `> 0.0001` IS `DUST_UNITS` AND SQL CANNOT IMPORT IT -- the same admission ReconcilePanel
    -- already makes about check 7's dollar. The question here is whether the position is OPEN,
    -- which is exactly what DUST_UNITS answers; DUST_USD is about whether a holding is worth
    -- DRAWING and would be the wrong constant, since a position can be worth nothing and still
    -- be held.
    --
    -- ⚠️ AND IT MUST BE `coalesce(sd.is_family, false) = false`, NOT `sd.asset_symbol is null`. A
    -- symbol explicitly marked Personal that nonetheless carries family allocations is the same
    -- fault and the more alarming one: a null row is an omission, an explicit false sitting
    -- beside live allocations is a contradiction. Both are counted.
    select jsonb_build_object('ord','10','label','Held by the family, but the symbol is not marked',
      'count', (select count(*) from (
         select et.asset_symbol, et.platform
           from finance.allocations al
           join finance.executed_trades et on et.id = al.executed_trade_id
           left join finance.symbol_designations sd
             on sd.asset_symbol = et.asset_symbol and sd.platform = et.platform
          where coalesce(sd.is_family, false) = false
          group by et.asset_symbol, et.platform
         having sum(al.units_allocated) > 0.0001) z),
      'meaning','They own units of it from per-trade answers, but the symbol itself still reads Personal — so every screen that answers who owns what calls it yours, and new trades of it will not be split automatically.')
  ) q;
$function$;

-- a reaffirmation, not a change: the ACL is already {postgres=X/postgres}
revoke all on function finance.integrity_checks() from public, anon;
