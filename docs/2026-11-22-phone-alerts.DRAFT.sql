-- ⏳ DRAFT, NOT APPLIED. Nothing in this file has run against production.
--
-- Step 2 of docs/2026-11-22-phone-alerts.md, "the plumbing": where a member's phones are kept,
-- what they want to hear about, and the queue an alert waits in until the `push` edge function
-- (supabase/functions/push/) delivers it. Evan, 22 Nov 2026: "Phone notifications: plan, then build
-- up to the point of needing the VAPID secret; ask me before adding it." So this stops there: the
-- one row of push_config is created EMPTY, and nothing is sent until it is filled at the secret
-- step. No URL, key or secret is in this file or anywhere in the repository.
--
-- WHY A DRAFT AND NOT A MIGRATION. A production apply is asked for first, like every one before it
-- (CLAUDE.md §4). Until then it lives in docs/ and CI proves it on a throwaway database.
--
-- HOW IT IS TESTED. .github/workflows/db-guards.yml, after the other suites: production's default
-- grants are put back first (a CI stack's baseline revokes them, and a draft that forgot to name
-- anon would pass there and fail here), then this file is loaded with `psql -1` — one transaction,
-- as apply_migration runs it — then supabase/tests/phone-alerts.sql asks it everything below in a
-- transaction that rolls back, then supabase/tests/visibility-guards.sql runs a second time, so
-- its checks H (nothing new anon-callable) and K (writers refuse a suspended member) are asked
-- about these functions too.
--
-- WHAT IT ADDS, in the house pattern (CLAUDE.md §3): four tables with RLS ON, ZERO policies and no
-- privileges for public, anon or authenticated — deny-all — reached only through SECURITY DEFINER
-- functions.
--
--   push_devices  one row per browser subscription: the endpoint, its two keys, a label. A push
--                 service answering 404 or 410 marks it gone; nothing deletes a row.
--   push_prefs    one row per member, a boolean per kind of alert. No row means all on: turning
--                 alerts on at all was the opt-in.
--   push_outbox   one row per alert to one member. `not_before` is what will make a Chronicle alarm
--                 the same machinery as a message.
--   push_config   one row: the push function's URL and the project's public anon key, for the
--                 kick. Created empty; filled at the secret step, never from the repository.
--
-- WHO MAY DO WHAT.
--   members   push_device_add, push_device_remove, push_devices_mine, push_prefs_get,
--             push_prefs_set, push_test. Every writer refuses a suspended member except
--             push_device_remove, which only stops alerts reaching one's own phone.
--   service   push_claim, push_done, push_device_ok, push_device_gone: the `push` function's four
--             doors, granted to service_role and nobody else.
--   admins    push_stuck: how many alerts are overdue, so a stuck queue is a number on a screen
--             rather than a quiet phone (the five-day 401 in docs/2026-08-21-prices-without-the-
--             edge-gateway.sql is why).
--   nobody    push_due, push_http_post, push_kick, push_outbox_kick: internal.
--
-- ⚠️ ONE COLUMN THE PLAN DID NOT HAVE: push_outbox.claimed_at, A LEASE. The plan said rows are
-- claimed `for update skip locked`, "so a send that overlaps the next can never deliver one twice".
-- That holds only inside the claiming transaction, and PostgREST runs every RPC in its own: the
-- lock is gone the moment push_claim returns, long before push_done marks the row. Two kicks a
-- second apart would each claim the same row. So a claim also stamps claimed_at, and a row is not
-- offered again for two minutes — which is also the wait before a failed row is retried.
--
-- ⚠️ AND push_outbox.tag IS REQUIRED. A row is retried while any of its member's devices failed,
-- so a phone that had it gets it again; that is harmless only because the service worker shows it
-- under the same tag, which replaces the first without sounding again. A row with no tag would
-- break that silently, so the table refuses one.
--
-- ⚠️ THE KICK MAY NEVER FAIL THE INSERT THAT CAUSED IT. An alert is queued inside the transaction
-- of the thing it is about (a message, a note); if telling the push function could raise, a push
-- service outage or a mistyped URL would stop people sending messages. push_kick catches its own
-- failure, and the trigger catches push_kick's. pg_net only queues, and sends after commit, so a
-- slow network costs the insert nothing either.
--
-- WHAT DOES NOT CHANGE. No existing table, column, row, function or grant. Nothing queues an alert
-- yet except "Send a test": messages, notes, rings, challenges and Chronicle are steps 3 to 6.
--
-- AFTER APPLYING: add the four tables to block B of supabase/tests/visibility-guards.sql (it runs
-- before this draft in CI, so it cannot name them yet), and point the db-guards step at the
-- migration instead of this file.
--
-- ROLLBACK, while nothing has used it:
--   select cron.unschedule('push-sweep');   -- only where pg_cron is installed
--   drop table public.push_outbox, public.push_devices, public.push_prefs, public.push_config cascade;
--   drop function public.push_device_add(text, text, text, text), public.push_device_remove(text),
--     public.push_devices_mine(), public.push_prefs_get(),
--     public.push_prefs_set(boolean, boolean, boolean, boolean, boolean), public.push_test(),
--     public.push_claim(int), public.push_done(bigint, text), public.push_device_ok(uuid),
--     public.push_device_gone(uuid), public.push_stuck(), public.push_http_post(text, jsonb, jsonb),
--     public.push_kick();
--   (the cascade takes push_due and the trigger with push_outbox; push_outbox_kick is then
--   `drop function public.push_outbox_kick()`)

-- ── the tables ───────────────────────────────────────────────────────────────────────────────
create table public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  /* the push service's URL for one browser. Which services are allowed is push_device_add's
     rule; the table only insists it is https and not absurd */
  endpoint text not null unique check (char_length(endpoint) <= 1024 and endpoint ~ '^https://'),
  /* base64url, unpadded: the browser's P-256 point (65 octets, so 87 characters starting B, which
     is 0x04) and its 16-octet auth secret (22 characters) */
  p256dh text not null check (p256dh ~ '^B[A-Za-z0-9_-]{86}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  label text check (label is null or char_length(label) between 1 and 60),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  gone_at timestamptz
);
create index push_devices_live on public.push_devices (user_id) where gone_at is null;

create table public.push_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  ring boolean not null default true,
  message boolean not null default true,
  post boolean not null default true,
  challenge boolean not null default true,
  chronicle boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('test', 'ring', 'message', 'post', 'challenge', 'chronicle')),
  /* sized so a row always fits one push message (3993 octets, RFC 8291 §4) with room to spare;
     webpush.ts's notePayload trims the body for the rare row JSON escaping inflates past it */
  title text not null check (char_length(title) between 1 and 120),
  body text check (body is null or char_length(body) <= 400),
  /* a place on this site, never another: `#room` or `/path`, and not `//host` or `/\host`, which a
     browser reads as another origin */
  url text check (url is null or (char_length(url) <= 300 and url ~ '^(#|/([^/\\]|$))')),
  tag text not null check (char_length(tag) between 1 and 64),
  not_before timestamptz not null default now(),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 500)
);
/* every reader of the queue asks about unsent rows only, and nothing deletes the sent ones */
create index push_outbox_unsent on public.push_outbox (not_before) where sent_at is null;

create table public.push_config (
  id int primary key check (id = 1),
  url text,
  anon_key text
);
insert into public.push_config (id) values (1);

alter table public.push_devices enable row level security;
alter table public.push_prefs enable row level security;
alter table public.push_outbox enable row level security;
alter table public.push_config enable row level security;

-- ⚠️ EXPLICIT, BECAUSE THE SCHEMA'S DEFAULT ACL GRANTS EVERYTHING (CLAUDE.md §3): RLS refuses rows
-- but never TRUNCATE, and `revoke … from public` does not reach anon in this project.
revoke all on table public.push_devices, public.push_prefs, public.push_outbox, public.push_config
  from public, anon, authenticated;
revoke all on sequence public.push_outbox_id_seq from public, anon, authenticated;

-- ── the queue's one rule ───────────────────────────────────────────────────────────────────
-- Due: unsent, its time has come, under five tries, and not claimed in the last two minutes (the
-- lease in the header). Written once, because push_claim takes what it says and push_kick asks
-- whether there is anything to take, and the two disagreeing would be a kick that wakes the
-- function for nothing or a row nothing ever wakes it for.
create function public.push_due(o public.push_outbox)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select o.sent_at is null
     and o.not_before <= now()
     and o.attempts < 5
     and (o.claimed_at is null or o.claimed_at <= now() - interval '2 minutes')
$$;

-- ── members ─────────────────────────────────────────────────────────────────────────────────
-- ⚠️ ONE ENDPOINT IS ONE BROWSER, SO AN ENDPOINT ALREADY HELD BY ANOTHER ACCOUNT MOVES TO THE
-- CALLER. Two of the family on one tablet, switching accounts: the alerts follow whoever turned
-- them on last, and the one before stops getting them on a screen that is not theirs any more.
-- Moving it clears gone_at and starts its history again (label, created_at, last_ok_at), because
-- those described the other account's alerts.
--
-- ⚠️ THE PUSH SERVICE IS CHECKED, NOT ONLY THE SCHEME. The `push` function POSTs to whatever URL
-- is stored here, so an endpoint is a member telling the server where to send a request. These
-- are the services the browsers in use hand out — FCM (Chrome, Edge, Android), Mozilla, Apple and
-- Windows — and an address anywhere else is refused before it is stored.
create function public.push_device_add(
  p_endpoint text, p_p256dh text, p_auth text, p_label text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  /* stored base64url and unpadded, whichever alphabet the browser handed over */
  v_p256dh text := translate(rtrim(btrim(coalesce(p_p256dh, '')), '='), '+/', '-_');
  v_auth text := translate(rtrim(btrim(coalesce(p_auth, '')), '='), '+/', '-_');
  v_label text := nullif(left(btrim(coalesce(p_label, '')), 60), '');
  v_id uuid;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if public.is_suspended(me) then
    raise exception 'this account cannot turn alerts on' using errcode = '42501';
  end if;
  if char_length(v_endpoint) > 1024 or v_endpoint !~ (
       '^https://([a-z0-9-]+\.)*'
       || '(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)/')
  then
    raise exception 'this browser''s push service is not one alerts are sent to'
      using errcode = '22023';
  end if;

  /* one member's devices are counted one call at a time, so two tabs cannot both pass the cap */
  perform pg_advisory_xact_lock(hashtextextended('push_devices ' || me::text, 0));
  if (select count(*) from public.push_devices d
       where d.user_id = me and d.gone_at is null and d.endpoint <> v_endpoint) >= 10 then
    raise exception 'alerts are on for 10 devices already; turn one off first'
      using errcode = '22023';
  end if;

  begin
    insert into public.push_devices as d (user_id, endpoint, p256dh, auth, label)
    values (me, v_endpoint, v_p256dh, v_auth, v_label)
    on conflict (endpoint) do update
       set user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           /* null means "not saying", never "clear it" (CLAUDE.md §8) — for the same owner */
           label = case when d.user_id = excluded.user_id
                        then coalesce(excluded.label, d.label) else excluded.label end,
           created_at = case when d.user_id = excluded.user_id then d.created_at else now() end,
           last_ok_at = case when d.user_id = excluded.user_id then d.last_ok_at end,
           gone_at = null
    returning d.id into v_id;
  exception when check_violation then
    /* the endpoint and label are already settled above, so the table can only mean the keys */
    raise exception 'those are not a browser''s push keys' using errcode = '22023';
  end;
  return v_id;
end;
$$;

-- Marks the caller's own device gone. It only narrows — fewer alerts, to fewer screens — so a
-- suspended member may do it, like deleting their own things (visibility-guards.sql block K).
create function public.push_device_remove(p_endpoint text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  update public.push_devices d
     set gone_at = now()
   where d.endpoint = btrim(coalesce(p_endpoint, '')) and d.user_id = me and d.gone_at is null;
  return found;
end;
$$;

-- The caller's live devices, newest first. The endpoint comes back so a page can tell which row
-- is the browser it is running in; the keys never do — nothing outside push_claim needs them.
create function public.push_devices_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'endpoint', d.endpoint, 'label', d.label,
             'created_at', d.created_at, 'last_ok_at', d.last_ok_at)
           order by d.created_at desc, d.id)
      from public.push_devices d
     where d.user_id = me and d.gone_at is null), '[]'::jsonb);
end;
$$;

create function public.push_prefs_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  p public.push_prefs;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  select * into p from public.push_prefs where user_id = me;
  /* no row is every kind on: the defaults, said here as well as on the columns */
  return jsonb_build_object(
    'ring', coalesce(p.ring, true),
    'message', coalesce(p.message, true),
    'post', coalesce(p.post, true),
    'challenge', coalesce(p.challenge, true),
    'chronicle', coalesce(p.chronicle, true));
end;
$$;

-- ⚠️ A NULL LEAVES THAT KIND AS IT WAS (CLAUDE.md §8: null means "I am not talking about this"),
-- so a page that changes one toggle sends one argument and cannot switch the others back on.
create function public.push_prefs_set(
  p_ring boolean default null, p_message boolean default null, p_post boolean default null,
  p_challenge boolean default null, p_chronicle boolean default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if public.is_suspended(me) then
    raise exception 'this account cannot change alerts' using errcode = '42501';
  end if;
  insert into public.push_prefs as p (user_id, ring, message, post, challenge, chronicle)
  values (me, coalesce(p_ring, true), coalesce(p_message, true), coalesce(p_post, true),
          coalesce(p_challenge, true), coalesce(p_chronicle, true))
  on conflict (user_id) do update
     set ring = coalesce(p_ring, p.ring),
         message = coalesce(p_message, p.message),
         post = coalesce(p_post, p.post),
         challenge = coalesce(p_challenge, p.challenge),
         chronicle = coalesce(p_chronicle, p.chronicle),
         updated_at = now();
  return public.push_prefs_get();
end;
$$;

-- "Send a test": one alert to every live device of the caller's, at most one a minute, and the
-- number of devices it is going to. ⚠️ THE LIMIT IS PER MEMBER AND IN THE DATABASE, because the
-- button is the one thing on the site that makes this project send a request to Google on demand.
create function public.push_test()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  n int;
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if public.is_suspended(me) then
    raise exception 'this account cannot send alerts' using errcode = '42501';
  end if;
  select count(*) into n from public.push_devices d where d.user_id = me and d.gone_at is null;
  if n = 0 then
    raise exception 'alerts are not on for any device' using errcode = 'P0002';
  end if;
  /* one call at a time per member, so two quick presses cannot both find the minute empty */
  perform pg_advisory_xact_lock(hashtextextended('push_test ' || me::text, 0));
  if exists (select 1 from public.push_outbox o
              where o.user_id = me and o.kind = 'test'
                and o.created_at > now() - interval '1 minute') then
    /* PT429: PostgREST answers HTTP 429 */
    raise exception 'one test a minute' using errcode = 'PT429';
  end if;
  insert into public.push_outbox (user_id, kind, title, body, url, tag)
  values (me, 'test', 'Test alert', 'Phone alerts work.', '#account-settings', 'test');
  return n;
end;
$$;

-- ── the push function's doors (service_role only) ──────────────────────────────────────────
-- Takes up to p_limit due rows, each with its member's live devices and their keys, and counts
-- the attempt. `skip locked` keeps two overlapping claims from waiting on each other; the lease
-- (claimed_at, see the header) is what keeps them from taking the same row.
create function public.push_claim(p_limit int default 50)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  with picked as (
    select o.id
      from public.push_outbox o
     where o.sent_at is null and public.push_due(o)
     order by o.not_before, o.id
     limit greatest(1, least(coalesce(p_limit, 50), 200))
       for update skip locked
  ), claimed as (
    update public.push_outbox o
       set attempts = o.attempts + 1, claimed_at = now()
      from picked
     where o.id = picked.id
    returning o.id, o.user_id, o.kind, o.title, o.body, o.url, o.tag, o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'title', c.title, 'body', c.body, 'url', c.url,
           'tag', c.tag, 'attempts', c.attempts,
           'devices', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', d.id, 'endpoint', d.endpoint, 'p256dh', d.p256dh, 'auth', d.auth)
                    order by d.created_at, d.id)
               from public.push_devices d
              where d.user_id = c.user_id and d.gone_at is null), '[]'::jsonb))
         order by c.id), '[]'::jsonb)
    into v
    from claimed c;
  return v;
end;
$$;

-- Finished with a row: p_error null means delivered (or nobody left to deliver to) and stamps
-- sent_at; anything else is kept in last_error and the row waits out its lease for another try,
-- until its fifth. Once only: a row already sent is not touched again. A success keeps the last
-- error, so a row that went on its third try still says what the first two met.
create function public.push_done(p_id bigint, p_error text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update public.push_outbox o
     set sent_at = case when p_error is null then now() end,
         last_error = coalesce(left(p_error, 500), o.last_error)
   where o.id = p_id and o.sent_at is null;
  return found;
end;
$$;

create function public.push_device_ok(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update public.push_devices d set last_ok_at = now() where d.id = p_id;
  return found;
end;
$$;

-- 404 or 410 from a push service: that subscription is over for good (RFC 8030 §7.3).
create function public.push_device_gone(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update public.push_devices d set gone_at = now() where d.id = p_id and d.gone_at is null;
  return found;
end;
$$;

-- ── watched, not trusted ────────────────────────────────────────────────────────────────────
-- Unsent alerts that were due more than five minutes ago. ⚠️ DUE, NOT CREATED: a Chronicle alarm
-- queued today for tomorrow is not late, and counting from created_at would call it stuck.
create function public.push_stuck()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
             'stuck', count(*),
             'oldest_due', min(o.not_before),
             'last_error', (array_agg(o.last_error order by o.id desc)
                              filter (where o.last_error is not null))[1])
      from public.push_outbox o
     where o.sent_at is null and o.not_before < now() - interval '5 minutes');
end;
$$;

-- ── the kick ────────────────────────────────────────────────────────────────────────────────
-- Asks the push function to send, if it can be asked and there is something to send. It says
-- which, so a test (and a person at the SQL editor) can tell the four apart.
--
-- ⚠️ THE KEY IS THE PUBLIC ANON KEY, NOT A SECRET: op 'send' delivers only what is already queued
-- (supabase/functions/push/index.ts says why that is safe). It goes as `apikey` and as a Bearer
-- token, the two places the edge gateway reads a key from.
--
-- ⚠️ WHETHER THE GATEWAY TAKES IT IS A QUESTION FOR THE SECRET STEP, NOT A FACT. On 21 Aug it
-- refused the project's legacy anon JWT outright, UNAUTHORIZED_LEGACY_JWT, while pg_net reported
-- nothing for five days (docs/2026-08-21-prices-without-the-edge-gateway.sql). So the first kick
-- after push_config is filled is read back from net._http_response, and it must be the function's
-- OWN answer — its tally, or its 503 "phone alerts are not configured" — never the gateway's. If
-- the gateway refuses, `push` can run with verify_jwt off, which gives nothing away here: the key
-- it would check is public.
--
-- ⚠️ pg_net IS FOUND BY THE FUNCTION THIS CALLS, net.http_post with the signature the Supabase
-- docs give, rather than by the extension's name: that is the thing that has to exist, and it
-- lets the test stand a recording stub in where a stack has no pg_net.
--
-- ⚠️ AND THE CALL ITSELF IS ITS OWN FUNCTION, push_http_post, OWNED BY THIS MIGRATION'S ROLE. Where
-- a stack DOES have pg_net, net.http_post belongs to the extension's owner, which a test connection
-- may not be, so it cannot be swapped for a recorder — and every check of what the kick sends,
-- how often, and what a failure does would quietly not run there. push_http_post can be replaced
-- on any stack, so those checks run on every one.
create function public.push_http_post(p_url text, p_body jsonb, p_headers jsonb)
returns bigint
language plpgsql
volatile
set search_path = public, pg_temp
as $$
begin
  return net.http_post(
    url := p_url, body := p_body, headers := p_headers, timeout_milliseconds := 20000);
end;
$$;

create function public.push_kick()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c public.push_config;
begin
  select * into c from public.push_config where id = 1;
  if nullif(btrim(c.url), '') is null or nullif(btrim(c.anon_key), '') is null then
    return 'not configured';
  end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    return 'no pg_net';
  end if;
  /* the cron asks every minute; waking the function for an empty queue would be 1,440 calls a day
     to do nothing */
  if not exists (select 1 from public.push_outbox o where o.sent_at is null and public.push_due(o))
  then
    return 'nothing due';
  end if;
  begin
    perform public.push_http_post(
      btrim(c.url),
      jsonb_build_object('op', 'send'),
      jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', btrim(c.anon_key),
        'Authorization', 'Bearer ' || btrim(c.anon_key)));
  exception when others then
    raise warning 'push_kick: %', sqlerrm;
    return 'failed: ' || sqlerrm;
  end;
  return 'queued';
end;
$$;

-- Once per INSERT statement, not per row: a statement queueing an alert for each member of a room
-- is one kick.
create function public.push_outbox_kick()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform public.push_kick();
  exception when others then
    raise warning 'push_outbox_kick: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger push_outbox_kick
  after insert on public.push_outbox
  for each statement execute function public.push_outbox_kick();

-- ── who may call what ───────────────────────────────────────────────────────────────────────
-- ⚠️ revoke … from public DOES NOT COVER anon in this project (CLAUDE.md §3): each is named.
revoke all on function
  public.push_due(public.push_outbox),
  public.push_device_add(text, text, text, text), public.push_device_remove(text),
  public.push_devices_mine(), public.push_prefs_get(),
  public.push_prefs_set(boolean, boolean, boolean, boolean, boolean), public.push_test(),
  public.push_claim(int), public.push_done(bigint, text),
  public.push_device_ok(uuid), public.push_device_gone(uuid),
  public.push_stuck(), public.push_http_post(text, jsonb, jsonb), public.push_kick(),
  public.push_outbox_kick()
  from public, anon, authenticated;
grant execute on function
  public.push_device_add(text, text, text, text), public.push_device_remove(text),
  public.push_devices_mine(), public.push_prefs_get(),
  public.push_prefs_set(boolean, boolean, boolean, boolean, boolean), public.push_test(),
  public.push_stuck()
  to authenticated;
grant execute on function
  public.push_claim(int), public.push_done(bigint, text),
  public.push_device_ok(uuid), public.push_device_gone(uuid)
  to service_role;

-- ── the sweep ───────────────────────────────────────────────────────────────────────────────
-- Once a minute, the same kick: for an alert whose time has come (a scheduled one has no insert
-- to wake anything), and for a row whose try failed. Only where pg_cron is installed — production
-- has 1.6.4, a CI stack may not — and scheduling an existing name replaces it.
--
-- ⚠️ IT IS NOT FREE, AND THE COST IS IN A TABLE NOTHING HERE TRIMS. pg_cron writes a row to
-- cron.job_run_details for every run: 1,440 a day, from the moment this is applied, configured or
-- not. At an ESTIMATED ~150 bytes a row with its index (not measured) that is ~80 MB a year of a
-- 500 MB plan (CLAUDE.md §5: the worst case). Trimming that table is a DELETE, so it is a question
-- for Evan before this is applied, not something this file does.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('push-sweep', '* * * * *', 'select public.push_kick()');
  end if;
end;
$$;
