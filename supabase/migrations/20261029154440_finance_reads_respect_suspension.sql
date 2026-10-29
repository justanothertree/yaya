-- ✅ APPLIED 29 Oct 2026 as `finance_reads_respect_suspension`.
--
-- §3 of Yaxa's family-fund safety set, which the draft left as a prose sketch rather than SQL —
-- "take the current text first, then add these two guards" — because it did not want to guess at
-- two long function bodies. They turned out not to be long: 524 and 340 characters. Both are
-- reproduced below from `pg_get_functiondef`, with two lines added and nothing else touched.
--
-- WHAT WAS OPEN. `get_my_portfolio` and `get_my_timeline` checked `auth.uid()` and nothing else —
-- verified, neither definition mentioned `is_suspended`. Suspension and the finance feature switch
-- were enforced only in App.tsx, which decides what to render. So a suspended member, or one with
-- investments switched off, could still read their own fund account through the API. It is only
-- ever their OWN data, which is why this was #3 and not #1 — but "Suspend" should mean what the
-- admin pressing it thinks it means.
--
-- ⚠️ AN EXCEPTION RATHER THAN AN EMPTY ARRAY, which the draft left open as a decision. Yaxa
-- suggested returning '[]'; this raises. The reason is in the client: `fetchMyPortfolio` does
-- `if (error) throw error` and the room renders the message, so the sentence is member-facing copy
-- and reaches the screen as written. "[]" would read as "you have nothing" — indistinguishable
-- from an account that genuinely holds nothing — where this reads as "not for you". The wording
-- matches the card App.tsx already shows for the same state.
--
-- ⚠️ AND THE FEATURE CHECK CALLS `my_features()` RATHER THAN RESTATING IT. What "finance is on"
-- means is `account_features` if there is a row, else `is_admin() or role = 'family'` — three
-- clauses that would now be written in three places, which is the thing §3's house pattern is
-- against. Probed first, because `get_my_portfolio` is STABLE and `my_features()` is VOLATILE by
-- default: a scratch STABLE function calling it returned true, so Postgres permits the nesting.
--
-- ⚠️ NO ERROR FLASH FOR THE PEOPLE BEING REDIRECTED, checked rather than assumed — this was the
-- one regression worth worrying about. App.tsx mounts the real `<Investments />` only when
-- `canFinance === true`; `null` (still loading) and `false` both fall to a card and never fetch.
-- So the client cannot reach these refusals through the feature path at all, and the guard is pure
-- defence in depth against a hand-written RPC call. The suspension path CAN surface briefly, for a
-- member suspended since their flags were last cached — and a refusal that appears for one round
-- trip before the redirect is strictly better than the data it used to serve.
--
-- BASELINE, in a simulated session for the one member in good standing who has accounts, taken
-- before this ran and re-checked after:
--   get_my_portfolio  md5 cea66be154d5759b2019ef8b28743bb3   33 accounts
--   get_my_timeline   md5 afddd4993cec2bc206e52a4621ab6e29
--
-- NOT DONE, named rather than silently skipped (§10): `admin_get_portfolios` and
-- `admin_get_timeline` are unguarded the same way. They are admin-gated, so the case is a
-- suspended admin, which cannot currently exist — `admin_delete_member` already refuses to touch
-- an admin and nothing suspends one. Worth revisiting if admin ever stops meaning Evan.

create or replace function public.get_my_portfolio()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'finance', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  /* ⚠️ THE TWO LINES THIS FUNCTION NEVER HAD. Both messages are shown to the member as written:
     the room does `if (error) throw error` and renders what comes back. */
  if public.is_suspended(v_uid) then raise exception 'this account is suspended'; end if;
  if not coalesce((select enabled from public.my_features() where feature = 'finance'), false) then
    raise exception 'investments are not enabled for this account';
  end if;

  select coalesce(jsonb_agg(finance.account_payload(fa.id) order by fa.display_name), '[]'::jsonb)
    into v_result
    from finance.family_accounts fa
   where fa.user_id = v_uid;

  return v_result;
end;
$function$;

create or replace function public.get_my_timeline()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'finance', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if public.is_suspended(v_uid) then raise exception 'this account is suspended'; end if;
  if not coalesce((select enabled from public.my_features() where feature = 'finance'), false) then
    raise exception 'investments are not enabled for this account';
  end if;
  return public._fund_timeline(v_uid, false);
end $function$;
