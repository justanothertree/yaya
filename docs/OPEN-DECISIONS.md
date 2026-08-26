# Open decisions

Things that are blocked on Evan rather than on code. Each one names what is already built, what
is actually being asked, and what happens if it keeps waiting.

Last reviewed: 2026-08-25 (third pass).

---

## 1. ~~The price feed~~ — DONE 2026-08-23

Evan put `finnhub_api_key` in Vault. Verified: `have_finnhub_key: true`, 97 of 175 symbols
refreshed within hours, the rest cycling through the nightly staggered runs. The rate-limit path
also ran for real for the first time and behaved — stopped asking, said so, still wrote crypto.

Nine symbols will never price from Finnhub — `HEXO, SNCY, RMO, ABLC, CCIV, WOLF.OLD, WBA,
LSXMK, SIRI.OLD` — delisted or renamed. `admin_set_price` carries a manual value if any of them
matter.

---

## 2. ~~Contributions have never been recorded~~ — SUPERSEDED 2026-08-23

They are derived from the trades now, not typed. `finance.account_ledger` walks each account's
allocated trades in date order: a sale becomes their cash, a purchase spends their cash before
Evan's, and only the shortfall is a fresh contribution. Nothing to remember to enter.

`finance.family_contributions` is left in place and still holds one $33 test row. It remains the
right home for money set aside but NOT yet invested, which the trades cannot know about.

⚠️ **Corrected 2026-08-25: it was NOT inert.** Admin → Fund still rendered it as a hero
ahead/behind figure, so the admin screen carried two opposite answers to the one question the
module exists for:

|                             | contributed | promised  | verdict              |
| --------------------------- | ----------- | --------- | -------------------- |
| Admin → Fund (typed)        | $33.00      | $8,514.00 | **$8,481.00 behind** |
| Investments → All (derived) | $13,825.02  | $8,514.00 | **$5,311.02 ahead**  |

$13,792 apart. The panel now reports the set-aside total and nothing else, and says in words
that the promise is worked out on Investments. Ahead-or-behind has one home again.

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

## 5. ~~Should `activity_visibility` default to `members`?~~ — DONE 2026-08-23

Default is now `private`, matching `circuit_people.visibility`. New members share nothing until
they choose to.

⚠️ **Still open, deliberately:** the 7 existing members are untouched and remain on the old
`members` default, which none of them ever chose. A default governs someone who has not decided;
rewriting the people already here would silently take away sharing they may be relying on. Evan's
call whether to move them.

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

- ~~**Rate limiting on the anon RPCs.**~~ — DONE 2026-08-26, with one part deliberately left.

  `submit_score` is bounded: 40 an hour per name, 200 globally as a backstop, sized against a
  measured peak of 13. It counts a new `submitted_at` column rather than `created_at`, because
  `created_at` is supplied by the caller — a limit reading it is one the flooder sets the clock
  for. The relay gained a per-address connection ceiling in the same commit. See
  `docs/2026-08-26-a-limit-the-caller-cannot-backdate.sql`.

  `get_invite_by_token` was **left alone on purpose**: tokens are `gen_random_uuid()`, so
  enumeration is not the threat, and the only ceiling worth having would be global — a shared
  fuse whose failure mode is that nobody can accept an invite. `complete_member_signup` raises
  `not authenticated` before touching anything, so it is not anon-reachable despite the grant.
  ⚠️ Whether that grant is vestigial is a real question, still open.

  ⚠️ Also found, still open: `submit_score` takes `p_created_at` from the caller, so anyone can
  **backdate a leaderboard entry by up to two years**. That is scoring integrity, not rate
  limiting, and changing it would rewrite how offline rounds sync. Evan's call.

- **Render's own env/secret handling** — outside this repo.
- **Auth settings beyond the linter.** Note that leaked-password protection is **paywalled** on
  the current plan, so the advisor will keep flagging it; that one is not actionable.

---

## 8. ~~Importing trades is too cumbersome~~ — DONE 2026-08-23

Admin → Import: pick a CSV, read the summary, press the button. No terminal, no service-role key
on a command line. Being signed in as an admin is the credential; the relay holds the key.

Verified end to end on the real Cash App export — 49 new trades, 1,328 already present, 1,485
allocations across 33 accounts, and the database agrees with the screen to the row.

Still manual: downloading the exports. Neither broker offers an API on these accounts, so this
removed the terminal, not the download.

⚠️ Two bugs found doing it, both worth remembering — see the relay notes in
`docs/2026-08-23-import-from-the-site.sql`.

---

## 9. ~~Tax-aware selling~~ — BUILT 2026-08-25

Investments → **Tax** (admin only): what is long-term, what is not, the month-by-month crossing
calendar, a wash-sale flag per holding, and — with a marginal rate typed in, kept in memory and
sent nowhere — what selling the short-term half today costs over waiting.

Two of the three open questions below turned out to be answerable rather than decidable:

- **Lot selection was never a choice.** Robinhood's default is FIFO and it offers no per-lot
  selection at sale time. Cash App's method is not publicly documented, but its two positions
  (SPCE, BTC — two-thirds of the money) have never had a sale, so no method distinguishes them.
- **Wash sales** are flagged from the data. SPCE was bought 20 times in the last 30 days, so a
  loss on it today is disallowed outright. BTC is the only family crypto and the rule does not
  currently reach digital assets; the copy says so as a statement about today's law, not a
  promise.
- **The marginal rate** stays out of the database entirely — typed per session, gone on refresh.

Found along the way: `finance.account_basis()` was destroying the cost basis of any position that
had had a reverse split — seven of them, $174.93 — see
`docs/2026-08-25-a-split-is-not-a-sale.sql`.

Still true as of 2026-08-25: **every family share is short-term.** First crossing 2026-12-11.

<details><summary>the original entry</summary>

## 9. Tax-aware selling — the motivation Evan hadn't named until now

Raised 2026-08-23. **"Since I'm the one buying and selling I'm the one paying the taxes, so
ideally I would rotate trades over time and only sell family fund positions if they've been held
long enough — unless I would make a lot of money in a short term sell that would cover any taxes
easily."**

This changes what the Investments page is FOR. It is not only a report for the family; it is a
decision tool for Evan, and the decision is _when may I sell without it costing me_.

**Where things stand today**, computed from the allocations:

|                           |                            |
| ------------------------- | -------------------------- |
| family lots held          | 316                        |
| earliest purchase         | 2025-12-10                 |
| cost basis, long-term     | **$0.00**                  |
| cost basis, short-term    | **$15,483.88 — all of it** |
| first lots turn long-term | **2026-12-11** (109 days)  |

Every family share is short-term. Selling anything today is taxed as ordinary income, not at
capital-gains rates. That is worth knowing before the next temptation — and it retroactively
justifies not selling SPCE in June at +170%, which would have been a short-term gain.

**What to build.** Per holding: how much is already long-term, how much isn't, and the date the
next tranche crosses over. A "sellable without a tax penalty" figure alongside "worth today".
Lot-level detail exists already — every allocation carries its trade's date.

**Open questions:**

- Wash sales. Selling at a loss and rebuying the same symbol within 30 days disallows the loss.
  The daily dollar-a-day buying makes this near-guaranteed on any family symbol he sells at a
  loss. Worth flagging in the UI, at minimum.
- The exception he named — a short-term gain big enough to cover its own tax — needs his marginal
  rate to compute, which is personal information the site does not have and arguably should not
  store. A rate he can type per-session, or a simple "assume X%", may be enough.
- Lot selection (FIFO vs specific-lot) changes the answer, and brokers differ in what they allow.

**Cost of waiting:** he keeps making sell decisions without the one number that decides whether
they cost him money.

</details>
