-- A stand-in for the parts of a Supabase project the schema depends on but does not create, so
-- the baseline can be loaded into a PLAIN Postgres 16 when `supabase start` is not available
-- (no Docker daemon). Loaded first by supabase/tests/plain-postgres/build.sh, then the same files
-- `[db.seed] sql_paths` lists, in the same order.
--
-- ⚠️ IT IS A STAND-IN, NOT SUPABASE. What it reproduces is exactly what the policies and the
-- SECURITY DEFINER functions read: the three API roles, and `auth.uid()` / `auth.jwt()` answering
-- from the `request.jwt.claims` setting — the same setting the guard files set to impersonate a
-- member, and the one PostgREST sets per request. It does NOT reproduce PostgREST, GoTrue, the
-- API gateway, storage or realtime, so a result here is a statement about the DATABASE: grants,
-- RLS, constraints and function bodies. The CI job (`supabase start`) remains the reference.
--
-- ⚠️ AND IT GRANTS LIKE PRODUCTION'S DEFAULTS, ON PURPOSE. Supabase's own default ACL hands every
-- new table and function in `public` to anon and authenticated (CLAUDE.md §3: deny-all is
-- something each table has to be GIVEN). The baseline's 00-privileges.sql revokes those defaults
-- for the dump; build.sh puts them back before loading a draft, so a draft that forgets its own
-- revokes is tested against the permissive world it would actually be applied into.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key,
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_sign_in_at timestamptz
);

-- Supabase's own definitions: the claims PostgREST puts on the request
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

-- schemas some function bodies name; plpgsql does not resolve them until called
create schema if not exists net;
create schema if not exists vault;
create schema if not exists cron;
