-- ============================================================================
-- ✅ APPLIED 2026-08-20. Migrations: family_contributions_ledger,
--    family_contribution_rpcs, fund_status_promised_vs_contributed
--
-- WHY: the dollar-a-day dashboard's headline number could not be derived from trades at all.
--
-- The fund is COMMINGLED with Evan's personal trading, and which shares were bought "thinking of
-- them" was never recorded — his words: "without any real time calculation on how much is theirs
-- or mine." No broker export carries that, and no derivation recovers it. Proof, all from the
-- same family-designated trades:
--     netting sells      -> "behind $8,376"
--     gross buys         -> "ahead $41,313"
--     net at cost        -> "$770 invested"
-- Three answers, none real, because the input was missing. Family-designated trades are $49,992
-- in and $49,221 out since 2020 — he trades in and out of the same symbols, so each rebuy of
-- recycled money counted again as a fresh contribution.
--
-- THE PROMISE IS ABOUT MONEY ENTERING THE FUND, not trades — and `scripts/import-trades.mjs`
-- explicitly skips deposits. The one number everything depended on was the one never imported.
--
-- SO: he declares it. `finance.family_contributions` is the sole origin of a fact that exists
-- nowhere else, which is why this is NOT the kind of manual-entry escape hatch to avoid.
-- Everything else derives: promised is exact ($1/day x days x accounts, no import, cannot drift)
-- and ahead/behind = contributed - promised.
--
-- ⚠️ A contribution is split equally only among accounts that EXISTED on its date
-- (start_date <= contributed_on). Splitting by today's count would retroactively hand a share of
-- old contributions to someone who joined last week and dilute everyone already there. Today all
-- 33 accounts share ONE start_date so the two agree — this is here so it stays correct the first
-- time somebody joins late.
--
-- SECURITY: table has RLS on, NO policies, and no grants to anon/authenticated — reachable only
-- through the definer RPCs, matching cost_basis_overrides and price_history. Verified as a
-- non-admin member: adding a contribution BLOCKED ("admin required"), fund-wide status BLOCKED,
-- direct table read BLOCKED at the grant, and my_fund_status() returns only that caller's own
-- accounts.
--
-- MATHS VERIFIED on live data (rolled back): two contributions of $3,300 and $1,650 gave
-- fund-wide contributed $4,950 against promised $8,679 across 33 accounts, and each member's
-- view showed contributed $150.00 vs promised $263.00 — exactly 1/33 of each.
--
-- FOUND WHILE TESTING, worth knowing: all 33 family_accounts belong to Evan's own user_id and
-- are named "Member 1".."Member 33". No real family member is linked yet, so the incorrect
-- numbers were never shown to anyone, and no real personal data sits in that table. Linking each
-- account to a member's login is still to do, and is Evan's data to enter.
-- ============================================================================

create table if not exists finance.family_contributions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  amount         numeric(14,2) not null check (amount > 0),
  contributed_on date not null,
  note           text check (note is null or length(note) <= 200),
  created_at     timestamptz not null default now()
);
create index if not exists family_contributions_owner_date_idx
  on finance.family_contributions (user_id, contributed_on);
alter table finance.family_contributions enable row level security;
revoke all on table finance.family_contributions from anon, authenticated;

-- RPCs (bodies are the source of truth in the migrations named above):
--   admin_add_contribution(amount, on, note)  -> uuid    admin only; refuses future dates
--   admin_list_contributions()                -> rows    admin only; includes per_person
--   admin_delete_contribution(id)             -> boolean admin only; own rows only
--   my_fund_status()                          -> jsonb   caller's own accounts + `ready` flag
--   admin_fund_status()                       -> jsonb   fund-wide totals
--
-- `ready` is false until at least one contribution exists, so the UI can say "being set up"
-- instead of rendering a confident zero to somebody's niece.
