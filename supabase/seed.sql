-- Seed for a THROWAWAY LOCAL DATABASE. Never run against production.
--
-- `supabase db reset` applies the migrations and then runs this file, which is what CI needs:
-- supabase/tests/visibility-guards.sql tests who can see whose things, and on a freshly migrated
-- database there is nobody and nothing. Every check that needs a session would then succeed
-- against an empty set and the suite would report "0 failures" in green — the exact clean zero
-- CLAUDE.md §2 keeps describing. The guard file now refuses to run without these fixtures; this
-- file is what satisfies it.
--
-- ⚠️ EVERY NAME HERE IS INVENTED. This is a public repository and a seed is the easiest place to
-- leak a real member by accident — `src/dev/previewMember.ts` carries the same warning for the
-- same reason.
--
-- ⚠️ THE SHAPE MATTERS MORE THAN THE SIZE. What the guards need is: an admin, a non-admin member
-- who is NOT the admin's friend (so the friends tier can be tested at all), a third member who
-- IS, a circuit person with an owner and a log (the suspension checks need one), and blocks at
-- three different tiers. Four rows of each would prove nothing more.

-- auth.users first: public.profiles references it.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'owner@example.test', '', now(), now(), now()),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'friend@example.test', '', now(), now(), now()),
  ('00000000-0000-4000-a000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'stranger@example.test', '', now(), now(), now())
on conflict (id) do nothing;

-- ⚠️ `profiles.username` HAS A FOREIGN KEY TO `player_registry.player_name`, which only running
-- this against the real schema revealed -- the seed looked complete and failed on the first
-- profile row. A snake handle is reserved before an account exists (see
-- `claim_my_reserved_snake_name`), so the registry row comes first.
insert into public.player_registry (player_name)
values ('seedowner'), ('seedfriend'), ('seedstranger')
on conflict (player_name) do nothing;

insert into public.profiles (user_id, username, first_name, age_band, public_page, activity_visibility)
values
  ('00000000-0000-4000-a000-000000000001', 'seedowner',    'Owner',    'adult', true,  'public'),
  ('00000000-0000-4000-a000-000000000002', 'seedfriend',   'Friend',   'adult', false, 'members'),
  -- ⚠️ age_band deliberately NULL: the ceiling must cap an unestablished age at Friends, and a
  -- seed where everybody is an adult could never show that.
  ('00000000-0000-4000-a000-000000000003', 'seedstranger', 'Stranger',  null,   false, 'friends')
on conflict (user_id) do nothing;

insert into public.admin_users (user_id)
values ('00000000-0000-4000-a000-000000000001')
on conflict do nothing;

-- the owner and the friend are friends; the stranger is nobody's friend, which is what makes the
-- friends tier testable at all
insert into public.friendships (user_a, user_b, requested_by, status, responded_at)
values (least('00000000-0000-4000-a000-000000000001'::uuid, '00000000-0000-4000-a000-000000000002'::uuid),
        greatest('00000000-0000-4000-a000-000000000001'::uuid, '00000000-0000-4000-a000-000000000002'::uuid),
        '00000000-0000-4000-a000-000000000001', 'accepted', now())
on conflict do nothing;

-- blocks at three tiers, so a clamp has something to cut
insert into public.profile_blocks (user_id, block_type, position, size, config, visibility)
values
  ('00000000-0000-4000-a000-000000000001', 'bio', 1, 'medium', '{}'::jsonb, 'public'),
  ('00000000-0000-4000-a000-000000000002', 'bio', 1, 'medium', '{}'::jsonb, 'members'),
  ('00000000-0000-4000-a000-000000000003', 'bio', 1, 'medium', '{}'::jsonb, 'friends'),
  -- stored 'public' by somebody whose ceiling is not public: the row Phase 2 exists to clamp
  ('00000000-0000-4000-a000-000000000003', 'status', 2, 'small', '{}'::jsonb, 'public')
on conflict do nothing;

-- a circuit person with an owner, in a group, with a log. The suspension checks need a log whose
-- owner can be suspended; without one they would test nothing.
insert into public.circuit_people (id, name, owner_user_id, visibility)
values ('seed-person-1', 'Owner', '00000000-0000-4000-a000-000000000001', 'public'),
       ('seed-person-2', 'Friend', '00000000-0000-4000-a000-000000000002', 'private')
on conflict (id) do nothing;

insert into public.circuit_groups (id, name, created_by)
values ('00000000-0000-4000-b000-000000000001', 'Seed Circuit',
        '00000000-0000-4000-a000-000000000001')
on conflict (id) do nothing;

insert into public.circuit_group_members (group_id, user_id)
values ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001')
on conflict do nothing;

insert into public.circuit_person_groups (person_id, group_id)
values ('seed-person-1', '00000000-0000-4000-b000-000000000001'),
       ('seed-person-2', '00000000-0000-4000-b000-000000000001')
on conflict do nothing;

insert into public.circuit_logs (id, person_id, date, entries)
values ('seed-log-1', 'seed-person-1', current_date, '[]'::jsonb)
on conflict (id) do nothing;
