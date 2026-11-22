-- ✅ APPLIED to production 22 Nov 2026 (5:39 PM EST, 22:39 UTC) as migration `phone_alerts`, version
-- 20261122223957, with Evan's yes of 22 Nov ("#454 phone alerts: YES ... Apply the migration, deploy
-- push, fill in its config row, and release"). Production recorded md5(statements[1]) =
-- 32a3cf8f0db51649f59ac03e6025d209 over 31,150 bytes, this file's body byte for byte. Before it: nothing named
-- push_* existed and net.http_post(text, jsonb, jsonb, jsonb, integer) did. After it: the five
-- tables with RLS on, no policy and no privilege of any kind for anon or authenticated; no push_*
-- function executable by anon; the seven member functions by authenticated; the push-sweep job
-- every minute; and push_kick() answering 'not configured' until push_config was filled.
-- Why, and the rollback: docs/applied/2026-11-22-phone-alerts.DRAFT.sql,
-- docs/2026-11-22-phone-alerts.md and docs/2026-11-22-phone-alerts.ROLLBACK.sql.

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
  /* every live device of the member's took it or refused it for good (push_deliveries) */
  sent_at timestamptz,
  /* its kind's TTL ran out before every device had it: given up on, and never sent late */
  expired_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  /* a status or an error's name and a push service's host — never an endpoint (webpush.ts,
     failureNote) */
  last_error text check (last_error is null or char_length(last_error) <= 500),
  check (sent_at is null or expired_at is null)
);
/* every reader of the queue asks about open rows only, and nothing deletes the finished ones */
create index push_outbox_open on public.push_outbox (not_before)
  where sent_at is null and expired_at is null;

/* ⚠️ ONE ROW PER ALERT PER DEVICE THAT IS DONE WITH IT, and the absence of a row is "still
   waiting" — so a retry goes only to the devices with none (push_waiting). ok_at: the push service
   took it. final_error: it refused it in a way that will not change (400, 401, 403, 413), so that
   device is not sent this alert again. Exactly one of the two. A device that met a 429 or a 5xx
   gets no row: it is still waiting, and the retry is for it alone. */
create table public.push_deliveries (
  outbox_id bigint not null references public.push_outbox (id) on delete cascade,
  device_id uuid not null references public.push_devices (id) on delete cascade,
  ok_at timestamptz,
  final_error text check (final_error is null or char_length(final_error) <= 500),
  /* when it was recorded, so push_stuck can count recent refusals (below) */
  at timestamptz not null default now(),
  primary key (outbox_id, device_id),
  check (num_nonnulls(ok_at, final_error) = 1)
);

create table public.push_config (
  id int primary key check (id = 1),
  url text,
  anon_key text
);
insert into public.push_config (id) values (1);

alter table public.push_devices enable row level security;
alter table public.push_prefs enable row level security;
alter table public.push_outbox enable row level security;
alter table public.push_deliveries enable row level security;
alter table public.push_config enable row level security;

-- ⚠️ EXPLICIT, BECAUSE THE SCHEMA'S DEFAULT ACL GRANTS EVERYTHING (CLAUDE.md §3): RLS refuses rows
-- but never TRUNCATE, and `revoke … from public` does not reach anon in this project.
revoke all on table public.push_devices, public.push_prefs, public.push_outbox,
  public.push_deliveries, public.push_config
  from public, anon, authenticated;
revoke all on sequence public.push_outbox_id_seq from public, anon, authenticated;

-- ── the queue's two rules ───────────────────────────────────────────────────────────────────
-- Due: neither sent nor expired, its time has come, under five tries, and not claimed in the last
-- two minutes (the lease in the header). Written once, because push_claim takes what it says and
-- push_kick asks whether there is anything to take, and the two disagreeing would be a kick that
-- wakes the function for nothing or a row nothing ever wakes it for.
create function public.push_due(o public.push_outbox)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select o.sent_at is null
     and o.expired_at is null
     and o.not_before <= now()
     and o.attempts < 5
     and (o.claimed_at is null or o.claimed_at <= now() - interval '2 minutes')
$$;

-- Waiting: the devices one row still has to reach — its member's live devices with no
-- push_deliveries row for it. Written once for the same reason as push_due: push_claim sends to
-- these and push_done calls the row sent when there are none, and the two disagreeing would be an
-- alert marked sent that a phone never got, or a row that never finishes.
--
-- ⚠️ IT TAKES THE MEMBER AS WELL AS THE ROW so it never reads push_outbox. push_claim calls it in
-- the same statement as the UPDATE that claims the row, and a STABLE function there reads the
-- snapshot from BEFORE that update (CI met this shape in the tests once already). That is safe
-- only while it reads nothing that statement writes, and keeping push_outbox out of it keeps it so.
create function public.push_waiting(p_outbox bigint, p_user uuid)
returns setof uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select d.id
    from public.push_devices d
   where d.user_id = p_user and d.gone_at is null
     and not exists (select 1 from public.push_deliveries pd
                      where pd.outbox_id = p_outbox and pd.device_id = d.id)
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

  /* one member's devices are counted one call at a time, so two tabs cannot both pass a cap */
  perform pg_advisory_xact_lock(hashtextextended('push_devices ' || me::text, 0));
  if (select count(*) from public.push_devices d
       where d.user_id = me and d.gone_at is null and d.endpoint <> v_endpoint) >= 10 then
    raise exception 'alerts are on for 10 devices already; turn one off first'
      using errcode = '22023';
  end if;
  /* ⚠️ AND THE ROWS, NOT ONLY THE LIVE ONES. The cap above counts devices that are on, and turning
     one off keeps its row (nothing here deletes), so add-then-remove grew the table without limit
     while never passing ten. So a member may also bring in at most 30 endpoints a day, gone ones
     counted. created_at is when a row became this member's (a browser moved from another account
     starts again), and an endpoint already theirs — turned back on, or its keys renewed — is not
     a new row, so it never meets this. PT429: PostgREST answers HTTP 429. */
  if not exists (select 1 from public.push_devices d where d.endpoint = v_endpoint and d.user_id = me)
     and (select count(*) from public.push_devices d
           where d.user_id = me and d.created_at > now() - interval '1 day') >= 30 then
    raise exception 'alerts were turned on for 30 new devices today; try again tomorrow'
      using errcode = 'PT429';
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
-- Takes up to p_limit due rows, each with the devices still waiting for it (push_waiting) and
-- their keys, and counts the attempt. `skip locked` keeps two overlapping claims from waiting on
-- each other; the lease (claimed_at, see the header) is what keeps them from taking the same row.
--
-- `age` is how long the row has been due, in seconds, on this clock: from not_before, or from
-- created_at for a row queued after its own time. The function takes it off the kind's TTL, and a
-- row with none left is expired rather than sent (webpush.ts, deliveryFor).
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
     where o.sent_at is null and o.expired_at is null and public.push_due(o)
     order by o.not_before, o.id
     limit greatest(1, least(coalesce(p_limit, 50), 200))
       for update skip locked
  ), claimed as (
    update public.push_outbox o
       set attempts = o.attempts + 1, claimed_at = now()
      from picked
     where o.id = picked.id
    returning o.id, o.user_id, o.kind, o.title, o.body, o.url, o.tag, o.attempts,
              greatest(0, round(
                extract(epoch from now() - greatest(o.created_at, o.not_before))::numeric, 3)) as age
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'title', c.title, 'body', c.body, 'url', c.url,
           'tag', c.tag, 'attempts', c.attempts, 'age', c.age,
           'devices', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', d.id, 'endpoint', d.endpoint, 'p256dh', d.p256dh, 'auth', d.auth)
                    order by d.created_at, d.id)
               from public.push_waiting(c.id, c.user_id) as w(id)
               join public.push_devices d on d.id = w.id), '[]'::jsonb))
         order by c.id), '[]'::jsonb)
    into v
    from claimed c;
  return v;
end;
$$;

-- One device is done with one row: p_error null means its push service took it, anything else
-- that it refused it for good (webpush.ts, outcomeOf: 'final'). Either way that device is not
-- offered the row again. Once only — the first answer stands — and only for a device that is the
-- row's member's: false otherwise, and nothing is written. A device that took it gets last_ok_at.
create function public.push_delivery(p_outbox bigint, p_device uuid, p_error text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  insert into public.push_deliveries (outbox_id, device_id, ok_at, final_error)
  select o.id, d.id, case when p_error is null then now() end, left(p_error, 500)
    from public.push_outbox o
    join public.push_devices d on d.id = p_device and d.user_id = o.user_id
   where o.id = p_outbox
  on conflict (outbox_id, device_id) do nothing;
  get diagnostics n = row_count;
  if n = 1 and p_error is null then
    update public.push_devices d set last_ok_at = now() where d.id = p_device;
  end if;
  return n = 1;
end;
$$;

-- Finished with a try at a row. ⚠️ WHETHER THE ROW IS SENT IS DECIDED HERE, FROM THE DEVICES, AND
-- NOT BY THE CALLER: sent when no live device of the member's is still waiting (push_waiting) —
-- every one took it or refused it for good — and otherwise left for the devices that are, once
-- its lease runs out, until its fifth try. A member with no live device at all has nobody to wait
-- for, so that row is sent too. p_error is only what last_error says about this try; a success
-- keeps the last error, so a row that went on its third try still says what the first two met.
-- Once only: a row already sent or expired is not touched. True when this call marked it sent.
create function public.push_done(p_id bigint, p_error text default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_sent boolean;
begin
  update public.push_outbox o
     set sent_at = case when not exists (select 1 from public.push_waiting(o.id, o.user_id))
                        then now() end,
         last_error = coalesce(left(p_error, 500), o.last_error)
   where o.id = p_id and o.sent_at is null and o.expired_at is null
  returning o.sent_at is not null into v_sent;
  return coalesce(v_sent, false);
end;
$$;

-- Too late to send: the kind's TTL ran out before every device had it (webpush.ts, deliveryFor).
-- Once only, and never over a row already sent.
create function public.push_expire(p_id bigint)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  update public.push_outbox o
     set expired_at = now()
   where o.id = p_id and o.sent_at is null and o.expired_at is null;
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
-- Open alerts — neither sent nor expired — that were due more than five minutes ago. ⚠️ DUE, NOT
-- CREATED: a Chronicle alarm queued today for tomorrow is not late, and counting from created_at
-- would call it stuck. An expired row is not stuck either: the queue moved, and gave it up.
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
                              filter (where o.last_error is not null))[1],
             /* ⚠️ REFUSALS ARE COUNTED TOO, because they are not stuck. 400, 401, 403 and 413 are
                final for a device, so a row they end is finished, never late — and a VAPID key the
                push services reject answers 401 or 403 for EVERY device, which would finish every
                row quietly while "stuck" read zero. The whole point of this function is that a
                broken queue shows as a number rather than a quiet phone. */
             'refused_day', (select count(*) from public.push_deliveries d
                              where d.final_error is not null and d.at > now() - interval '1 day'),
             'last_refusal', (select d.final_error from public.push_deliveries d
                               where d.final_error is not null order by d.at desc limit 1))
      from public.push_outbox o
     where o.sent_at is null and o.expired_at is null
       and o.not_before < now() - interval '5 minutes');
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
-- OWN answer — `{"ok":true}`, or its 503 `{"error":"not sent"}` — never the gateway's. If
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
  if not exists (select 1 from public.push_outbox o
                  where o.sent_at is null and o.expired_at is null and public.push_due(o)) then
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
  public.push_due(public.push_outbox), public.push_waiting(bigint, uuid),
  public.push_device_add(text, text, text, text), public.push_device_remove(text),
  public.push_devices_mine(), public.push_prefs_get(),
  public.push_prefs_set(boolean, boolean, boolean, boolean, boolean), public.push_test(),
  public.push_claim(int), public.push_delivery(bigint, uuid, text), public.push_done(bigint, text),
  public.push_expire(bigint), public.push_device_gone(uuid),
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
  public.push_claim(int), public.push_delivery(bigint, uuid, text), public.push_done(bigint, text),
  public.push_expire(bigint), public.push_device_gone(uuid)
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
