# Open decisions

Things that are blocked on Evan rather than on code. Each one names what is already built, what
is actually being asked, and what happens if it keeps waiting.

Last reviewed: 2026-08-21.

---

## 1. The price feed has been dead since 2026-08-16

**What's wrong.** Four `pg_cron` jobs POST to the `refresh-prices` edge function using the legacy
anon JWT, and Supabase's edge gateway now rejects those outright:
`{"code":"UNAUTHORIZED_LEGACY_JWT"}`. Every investments figure is priced from a stale cache.

**Why it looks fine.** `cron.job_run_details` reports **success** regardless — `net.http_post`
only queues the request, so the failure never reaches the job record. The real answer is in
`net._http_response`. Anything that trusts the cron log will keep saying this works.

**The decision.** The project has only a legacy key (`get_publishable_keys` returns no
`sb_publishable_…`) and Vault is empty. Three ways out:

- create a modern publishable key and use that;
- put a key in Vault and have the cron read it via `decrypted_secret` — **recommended**, since
  nothing sensitive then sits in the job body;
- set `verify_jwt=false` on the function. It takes no input and only refreshes prices, but an
  open endpoint can be spammed to burn the Finnhub free tier.

⚠️ Whatever is chosen, do not hand-embed a secret in the cron command.

**Cost of waiting:** prices drift further from reality every day.

---

## 2. Contributions have never been recorded

**Already built and waiting.** Admin → **Fund**: amount, date, optional note. It backdates, shows
the per-person split as you type, and lists entries so a mistake can be removed.

**Why it matters.** The dollar-a-day promise is about money _entering_ the fund, and that number
exists nowhere else — the fund is commingled with personal trading, so no export contains it and
no derivation over trades recovers it. Three derivations over the same trades give "behind
$8,376", "ahead $41,313" and "$770 invested". They are not competing answers; they are noise from
a missing input.

**Cost of waiting:** nobody is shown an ahead-or-behind figure at all. Their page says it is still
being set up, which is deliberate — a confident zero would be a wrong answer rather than an
honest blank.

---

## 3. No family account is linked to a real person

All 33 `family_accounts` belong to Evan's own login and are named "Member 1".."Member 33".

**Already built.** Investments admin → edit an account → the **Member** picker, labelled "change
to hand this account over". It reassigns the account with its holdings and enables finance for
the new owner.

**Cost of waiting:** no family member can see their own page, so the whole point of the module is
not reachable yet. (Upside: the wrong numbers were never shown to anyone.)

---

## 4. Should person colours stay unreadable in light theme?

Measured on white: names at **3.99** (purple) and **2.10** (green), the per-day figure at
**2.93** — all below the 4.5:1 needed. In dark theme they pass.

These are user identity colours rendered as text, so fixing them means adjusting lightness while
keeping hue — invisible in dark mode, only biting on light. That changes how the crew's names
look, which is a design decision rather than a defect, so it has not been done.

---

## 5. Should `activity_visibility` default to `members`?

`profiles.activity_visibility` defaults to `'members'` — it shares by default. Its sibling,
`circuit_people.visibility`, defaults to `'private'`.

All 7 non-public members are sitting on that default, meaning none of them has ever chosen it.
Worth deciding deliberately, given the standing rule that data should only be shared where
someone chose to share it.

---

## 6. Two Snake integrity items, both deliberately left

**Identical same-day Robinhood buys collapse into one trade.** Robinhood rows carry no
transaction id and `Activity Date` has no time, so three real $20 purchases are indistinguishable
from one row listed three times. The importer now prints a loud `⚠️ COLLAPSED` block naming the
dollars it did not import, but the fix — adding an occurrence ordinal to the key — would change
the key of every Robinhood row **already imported** and make the next run insert a second copy of
the whole history. That needs a migration, not a patch.

**Multiplayer scores under a claimed handle are declined.** `finalize_round_rpc` refuses to write
to a claimed handle unless the caller vouches for the owner, and the relay does not yet send a
verified id. Restoring it is a relay + client change and a Render deploy — a convenience upgrade,
not a security fix, and that path has run eight times ever. See
`docs/2026-08-20-relay-audit.sql`.

---

## 7. Not swept, and outside what can be checked from here

- **Rate limiting on the anon RPCs.** `submit_score`, `get_invite_by_token` and
  `complete_member_signup` are reachable by anyone; nothing bounds call volume.
- **Render's own env/secret handling** — outside this repo.
- **Auth settings beyond the linter.** Note that leaked-password protection is **paywalled** on
  the current plan, so the advisor will keep flagging it; that one is not actionable.
