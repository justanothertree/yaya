-- Standing check: a member cannot write their own profile row.
--
-- Re-runnable, and safe: everything happens inside a transaction that rolls back. Run it after
-- any change to grants, policies or profile RPCs. Written as a QUERY rather than a table of
-- expected values, for the reason docs/rpc-inventory.md gives: a hand-maintained list drifts,
-- and this one would drift in the direction nothing contradicts.
--
-- Expected: every row in the first result says `refused`, and the two control rows say `allowed`
-- and `works`. A SUCCEEDED anywhere in the attack half is a hole.
--
-- ⚠️ THE CONTROLS ARE NOT DECORATION. A revoke that also broke `update_my_profile` would make the
-- attack half pass perfectly while breaking the account page for everybody — the clean-number
-- failure CLAUDE.md §2 keeps describing. If the control rows do not say `works`, the lock is
-- wrong even though the attack is refused.

begin;

-- act as an ordinary member (any non-admin will do; Cam is used here)
select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id::text from public.profiles where username = 'Cam'),
                    'role', 'authenticated')::text, true);
set local role authenticated;

create temp table result(part text, what text, outcome text);

do $$
declare c text; n int;
begin
  -- ── the attack: set each sensitive column on yourself ────────────────────────────────────
  foreach c in array array['age_band','feed_opt_in','suspended','username','activity_visibility',
                           'public_page','role'] loop
    begin
      execute format('update public.profiles set %I = %L where user_id = auth.uid()',
        c, case c when 'age_band' then 'adult'
                  when 'username' then 'not_my_name'
                  when 'activity_visibility' then 'public'
                  when 'role' then 'admin'
                  else 'true' end);
      get diagnostics n = row_count;
      insert into result values ('attack', c, 'SUCCEEDED -- ' || n || ' row(s) changed');
    exception
      when insufficient_privilege then insert into result values ('attack', c, 'refused');
      when undefined_column       then insert into result values ('attack', c, 'n/a -- no such column');
      when others                 then insert into result values ('attack', c, 'refused: ' || split_part(sqlerrm, E'\n', 1));
    end;
  end loop;

  begin
    execute 'insert into public.profiles (user_id, username) values (auth.uid(), ''second_row'')';
    insert into result values ('attack', '(insert a second row)', 'SUCCEEDED');
  exception when others then
    insert into result values ('attack', '(insert a second row)', 'refused');
  end;

  begin
    execute 'delete from public.profiles where user_id = auth.uid()';
    insert into result values ('attack', '(delete own row)', 'SUCCEEDED');
  exception when others then
    insert into result values ('attack', '(delete own row)', 'refused');
  end;

  -- ── the controls: what must still work ───────────────────────────────────────────────────
  begin
    perform 1 from public.profiles where user_id = auth.uid();
    insert into result values ('control', 'select own row', 'allowed');
  exception when others then insert into result values ('control', 'select own row', 'BROKEN: ' || sqlerrm); end;

  begin perform public.set_my_activity_visibility('friends');
        insert into result values ('control', 'set_my_activity_visibility', 'works');
  exception when others then insert into result values ('control','set_my_activity_visibility','BROKEN: '||sqlerrm); end;

  begin perform public.set_my_nicknames('Cammy', null, null);
        insert into result values ('control', 'set_my_nicknames', 'works');
  exception when others then insert into result values ('control','set_my_nicknames','BROKEN: '||sqlerrm); end;

  begin perform public.update_my_profile('Cam', null, null, 'cam@example.com', null, null, null, null, null, null);
        insert into result values ('control', 'update_my_profile', 'works');
  exception when others then insert into result values ('control','update_my_profile','BROKEN: '||sqlerrm); end;

  begin perform public.set_my_public_page(true);
        insert into result values ('control', 'set_my_public_page', 'works');
  exception when others then insert into result values ('control','set_my_public_page','BROKEN: '||sqlerrm); end;

  begin perform public.set_lounge_opt_in(true);
        insert into result values ('control', 'set_lounge_opt_in', 'works');
  exception when others then insert into result values ('control','set_lounge_opt_in','BROKEN: '||sqlerrm); end;

  -- a member must not be able to reach the admin writers
  begin perform public.admin_set_feed_consent('Cam', 'adult', true);
        insert into result values ('control', 'member calling admin_set_feed_consent', 'SUCCEEDED -- should refuse!');
  exception when others then insert into result values ('control','member calling admin_set_feed_consent','correctly refused'); end;
end $$;

select part, what, outcome from result order by part desc, what;

rollback;

-- ── the grant itself, read directly ─────────────────────────────────────────────────────────
-- Expected: authed_select true, everything else false.
select has_table_privilege('authenticated','public.profiles','SELECT') as authed_select,
       has_table_privilege('authenticated','public.profiles','INSERT') as authed_insert,
       has_table_privilege('authenticated','public.profiles','UPDATE') as authed_update,
       has_table_privilege('authenticated','public.profiles','DELETE') as authed_delete,
       has_table_privilege('anon','public.profiles','SELECT')          as anon_select,
       has_table_privilege('anon','public.profiles','UPDATE')          as anon_update,
       (select count(*) from pg_policy
         where polrelid = 'public.profiles'::regclass and polcmd in ('a','w')) as write_policies_should_be_0;
