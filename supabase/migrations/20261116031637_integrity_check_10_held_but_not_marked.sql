-- Integrity check 10: held by the family, but the symbol is not marked.
--
-- `finance.symbol_designations` and `finance.allocations` are written by two paths that never
-- consult each other, and one reader (`isFamily`) asks the designation. So a position every
-- family account wholly owns can carry no designation row anywhere, and the single screen built
-- to say who owns what calls it Personal. Not an error — a thing to be told. Count on the live
-- fund: 5 (AKAM, CURI, GENI, MNRO, SKHY on robinhood, 79.956946 units, $813.84 at cost).
--
-- ⚠️ THE NINE EXISTING CHECKS ARE UNTOUCHED BY CONSTRUCTION, not by proofreading. This body was
-- produced by two anchored string replacements applied by script to the repository's own
-- committed text, which throws if either anchor is missing; `diff` against that text is exactly
-- two hunks with one line removed. The text surgered was first proved to be what production was
-- running: md5(prosrc) and md5 of the body in 00000000000000_baseline.sql were both
-- beffb1ed10c19c565f1a02672eb23680 at 6,082 bytes. `pg_get_functiondef` was deliberately NOT the
-- source — applied.md5's own header records 20261027004612 as the migration that went wrong that
-- way.
--
-- ⚠️ THE SORT HAD TO CHANGE, AND THAT IS THE HALF THAT WOULD HAVE SHIPPED QUIETLY.
-- `order by c->>'ord'` compares STRINGS and `ord` is text. Nine checks never exposed it; a tenth
-- does. Measured in production rather than reasoned about: `order by v` over 1..10 gives
-- `1, 10, 2, 3, ...`, so check 10 would have rendered SECOND in the Reconcile list with nothing
-- on screen to say so — ReconcilePanel renders the array in arrival order and keys on `label`,
-- never on `ord`. The cast leaves every existing `ord` VALUE untouched, so the first nine keep
-- their order and the UI's keys do not move. Verified after applying: array positions 1..10 match
-- ords 1..10, and check 10 is at position 10.
--
-- ⚠️ THE MEANING DELIBERATELY DOES NOT NAME THE CORRECTION. The sketch this grew from ended
-- "a correction to one of these gives them none of it", which was the sharpest consequence and
-- stopped being true hours earlier, when 20261116020828 made `admin_correct_position` ask
-- `finance.family_share_at` instead of this flag. Shipping it verbatim would have put a sentence
-- about a version of the code that no longer exists onto the admin screen. Two pieces of copy in
-- `Investments.tsx` said the same thing and were corrected in the same sitting.
--
-- ⚠️ THE PREDICATE WAS PERTURBED, NOT ARGUED FOR. All five are the (no row) kind today, so
-- `coalesce(sd.is_family,false) = false` and `sd.asset_symbol is null` agree and the choice looks
-- free — one dimension pinned flat, which is the fixture trap. Simulated an explicit `false` row
-- on GENI beside its live allocations, read-only: coalesce form 5, is-null form 4. A null row is
-- an omission; an explicit false beside live allocations is a contradiction, and the more
-- alarming of the two. Symbols in that state today: 0, so the guard is bought before it is needed.
--
-- No DML. Measured either side: payload md5 across 33 accounts 4cdb5581d2c9b9c722461c375c82cbef
-- both times, trades 1,774, allocations 15,840. Body md5
-- beffb1ed10c19c565f1a02672eb23680 (6,082 bytes) -> 8decb4325a8c0a54fa6af4e06dc0b2aa (9,188).
-- Reconcile list 9 -> 10 checks; admin_attention.integrity counts checks with a non-zero count
-- rather than summing them, so the badge moved 2 -> 3, not 2 -> 7.
--
-- ACL unchanged, as `create or replace function` promises: {postgres=X/postgres} either side.
-- Not granted to `authenticated` or `service_role` — it is reached only through
-- `admin_reconciliation` and `admin_attention`, both SECURITY DEFINER and both checking
-- `is_admin()`. The revoke at the end is a reaffirmation, and there is deliberately no grant.
--
-- Reasoning: docs/2026-11-16-integrity-check-10.sql

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
