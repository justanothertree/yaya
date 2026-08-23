# Open decisions

Things that are blocked on Evan rather than on code. Each one names what is already built, what
is actually being asked, and what happens if it keeps waiting.

Last reviewed: 2026-08-23.

---

## 1. ~~The price feed~~ — DONE 2026-08-23

Evan put `finnhub_api_key` in Vault. Verified: `have_finnhub_key: true`, 97 of 175 symbols
refreshed within hours, the rest cycling through the nightly staggered runs. The rate-limit path
also ran for real for the first time and behaved — stopped asking, said so, still wrote crypto.

Nine symbols will never price from Finnhub — `HEXO, SNCY, RMO, ABLC, CCIV, WOLF.OLD, WBA,
LSXMK, SIRI.OLD` — delisted or renamed. `admin_set_price` carries a manual value if any of them
matter.

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

---

## 8. Importing trades is too cumbersome to be a habit

Raised 2026-08-23, after doing it once end to end.

**What it takes today:** download two broker CSVs by hand, find them, open a terminal, set a
service-role key in the environment, run a dry run, read the summary, run it again with
`--commit`. That is a lot of steps standing between Evan and a number that should be current,
and a process with that many steps does not get done monthly — which is exactly how prices and
trades both ended up months stale.

Getting the key onto the command line is the worst of it: it is the one step that can fail four
different ways (wrong key, JWT secret instead, placeholder pasted verbatim, shell syntax), and
all four report the same "Invalid API key".

**The idea:** upload the CSV from the site instead. Admin → a drop zone; the parsing already
exists in `scripts/import-trades.mjs` and would move server-side. No key to handle — being
signed in as an admin IS the credential — no terminal, and the dry-run summary becomes a screen
you look at before pressing Import.

**What it needs deciding:**

- Where the parse runs. The Render relay already holds the service-role key and is the natural
  home; an edge function is the alternative, but see decision 1 for how that has gone.
- Whether the dry-run summary stays a wall of text or becomes a real review screen — the
  ⚠️ COLLAPSED warning and the skipped-kind spot-checks are the parts worth keeping visible,
  because they are how you catch money that did not import.
- Broker exports still have to be downloaded by hand either way. Neither Robinhood nor Cash App
  offers an API on these accounts, so this removes the terminal, not the download.

**Cost of waiting:** the data goes stale between the imports that do happen, and every stale
stretch shows up as wrong numbers on pages the family is meant to trust.

---
