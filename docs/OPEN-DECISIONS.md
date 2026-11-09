# Open decisions

Things that are blocked on Evan rather than on code. Each one names what is already built, what
is actually being asked, and what happens if it keeps waiting.

Last reviewed: 2026-11-08 (ninth pass — §14 is the Lab's votes and notes, renumbered from a §13 written in parallel with the ducking one, and updated to Evan's decision of 8 Nov to drop the vote floor; §11a DONE and §11b–c re-measured, §13 new, from the ducking pass; §12 untouched).

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

---

## 10. What is waiting on Evan after 29 Oct 2026

Rewritten 29 Oct. The four drafts this section was mostly about are **applied**, so what is left is
much shorter: two things that need a browser Evan is signed into, and two engines the pane cannot
be.

### 10a. ~~Four `.DRAFT.sql` migrations, none applied~~ ✅ DONE 29 Oct

All four are live, as seven migrations — two of the drafts were prose sketches rather than runnable
SQL, and the picture one had to be split so there was never a window where uploads were broken.
`docs/2026-10-29-the-four-drafts-applied.md` has the table, the measurements and the standing
queries; each migration's own header has its own.

Two things are worth carrying forward from doing it:

**Two of the drafts broke each other, and neither file said so.** `close_insert_allocation` kept
its guard inside `insert_allocation` specifically so the admin UI would not have to change;
`family_fund_safety` §1 revokes `INSERT` on that table from `authenticated`, and
`insert_allocation` ran as the caller. Applied in either order they would have left **the admin**
unable to assign units. Measured rather than spotted by reading: the same call that inserts a unit
today returns `42501 permission denied for table allocations` with the revoke applied first. The
repair was to make that one function SECURITY DEFINER, which the new `is_admin()` gate is what
makes safe.

**The `.DRAFT.sql` files are gone, not renamed.** Their headers all began "⛔ DRAFT — NOT APPLIED",
which is exactly the kind of sentence that goes stale and misleads the next reader; the reasoning
in them is carried into the applied files, corrected where it was wrong, and git has the originals.

### 10b. One thing only a signed-in browser can exercise

**~~Keep one more picture on evancook.dev.~~ ✅ DONE 29 Oct — Evan saved a photo on a new review and
another on his circuit, and both worked.** That is the service-role path exercised end to end: the
finishing step runs as `service_role` against the 2-arg `picture_ready`, and the old 1-arg one is
revoked from `authenticated`, so there was no fallback left to quietly carry it. It was the last
thing no tool session could reach — a real member JWT and a real R2 PUT.

⚠️ He tested **v15's predecessor**; `pictures` was redeployed afterwards as v15, which differs by
one comment line and no code. Said plainly rather than left for somebody to wonder about: the test
still covers what runs, and the deployed module is byte-identical to this repository
(md5 `4f070d96d1edf024f474934d60eb2ed7`, 23,874 bytes).

The undo, if it ever regresses, is still one line and takes a second:
`grant execute on function public.picture_ready(uuid) to authenticated;`

**Open Investments → Trades and press a symbol's Family/Personal toggle.** Unchanged from 28 Oct:
it asks first and says how many allocations it is about to delete — 6,006 for SPCE. Press "Leave
it" the first time and check the sentence reads right. The positions table needs an admin session,
so the wired component is still the one unexercised piece; the wording module, the CSS and the SQL
are all checked.

Both are unverifiable here rather than unverified — the difference matters and is the reason they
are listed rather than claimed.

### 10c. Two things only another browser can answer

The Browser pane is Chromium. **Firefox and Safari are untested**, as always, and two changes this
week touch things those engines differ on:

- the investments chart now sizes itself from a `ResizeObserver` and a layout-effect measurement;
- the holdings row leans on `minmax(0, 1fr)` and `min-width: max-content` in grid and flex.

Neither is exotic. Both are worth a glance if anything looks wrong on an iPhone.

### 10d. What is left of Part C P3 and Part E

Added 29 Oct, after working through both. Everything else in them is done and pushed; these are
what is genuinely left, with why.

**Nothing is waiting on Evan here.** Two items are design decisions, two need a browser he is
signed into, and one is explicitly "later" in the review itself.

| left                                                 | why                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E §1.5 — weighted or subset splits ("just the kids") | the review marks it _"Later, for other families"_; today every split is even across 33 and there is no second family                                                                                                    |
| E §2.5 — the handover check                          | needs a throwaway member and a real reassignment on the live site; creating a member to test with is Evan's call, not something to do from a session                                                                    |
| E §2.4 — per-account chart series                    | the title says "All 3 accounts over time" now, which was the lie. Actually splitting `timeline.events` per account is a bigger change to `_fund_timeline` and wants deciding rather than guessing                       |
| P3.1's `trimmed` count                               | the importer reports how many rows it absorbed; the figure crosses the relay and the import panel does not display it yet                                                                                               |
| E §3.1's dust-only fold                              | asked for, deliberately not done — `accountNumbers` had already rejected it in a comment, and the two situations it would serve are opposite in meaning. A sentence above the list does the job instead; see the commit |

And one thing is reasoned rather than exercised: the **"All N accounts over time"** title lives in
the Investments room, which needs a session, and the workbench renders `PortfolioList` without the
room around it. The guardian case in `#dev-investments` shows the rows and the shared sparklines,
not the title.

### 10e. Three things named rather than closed

Not waiting on Evan — waiting on a reason. Each is a door with no path to it today, written down so
the day a path appears, the door is already known:

- **`allocations.executed_trade_id` has no foreign key.** Deleting a trade would orphan its
  allocations the way deleting a login used to orphan them (now fixed with a RESTRICT FK on the
  account side). Nothing deletes trades — checked across every function in `public` and `finance` —
  so it becomes real the day a "remove an imported trade" control is added.
- **`admin_get_portfolios` and `admin_get_timeline` do not check suspension**, where their member
  equivalents now do. The case is a suspended admin, which cannot exist: `admin_delete_member`
  refuses to touch an admin and nothing suspends one.
- **`family_accounts.start_date` is nullable and `admin_create_family_account` accepts a null one.**
  An account with no start date receives no allocations, because `>= fa.start_date` is NULL. The
  even-split fix no longer miscounts because of it, but the row would still quietly get nothing.

### 10f. One decision parked on purpose

The cash question — whether "worth today" should include cash from sales — is untouched by
everything above. The card still counts shares only and the chart's line still includes cash, both
deliberately, both documented where they are. Nothing this week moved either.

---

## 11. Three Instrument loudness calls — the first is now fixed, two still waiting

Added 6 Nov 2026, closing a run of Instrument work. Each of these is a number I can measure and
a balance I cannot judge, because judging it means listening on a real device. They are listed
together because they interact: fixing the first changes what the other two are worth.

### 11a. ~~A backing at zero volume takes 5–7dB off your hands~~ — DONE 2026-11-07

Fixed. The sum the scaler works from now carries the layer's fader, and reads it back off the bus
each time rather than copying it onto the voice. `src/audio/poly.ts` holds the arithmetic and
`poly.test.ts` asks it 20 questions; the reasoning and every figure are in
`docs/2026-11-07-the-sum-and-the-signal.md`.

Measured with `ducking()`, same backing, same key, every guard green:

|                                                 | before                      | after                     |
| ----------------------------------------------- | --------------------------- | ------------------------- |
| every fader at 0, held C4                       | **−6.62dB**                 | **−0.06dB**               |
| a held key with the faders pulled to 0 under it | 0.2198, stranded 7.7dB down | **0.4838**, within 0.71dB |

⚠️ **It is not the identity except at a fader of 1, and that is the point.** What else moved is
in §11c and §13a. Nothing has been LISTENED to.

### 11b. The preset levels, and whether they still need re-levelling

Untouched on purpose, three sessions running. The measured spread is roughly 13× between the
quietest and loudest patch at the same fader position, which is what `scripts/synth-levels.py` and
`presets.test.ts` are both about.

⚠️ **11a was the blocker and it has gone, so this is now answerable rather than merely
waiting.** The reasoning recorded here was that re-levelling presets might be fixing the symptom of
the ducking bug — "the layer volume is almost not loud enough for some of the instruments" is a
complaint about a fader that feels like it has no authority, and a fader that left a layer counting
its full patch level against everything else is exactly that. That cause is gone. Whether a spread
remains that an ear objects to is now a question about the presets alone, and the first useful move
is to listen to the same two patches that prompted it before changing any number.

### 11c. The layer fader's 2× ceiling buys less than it looks like — re-measured

The original reading was that taking every layer fader from 1 to its maximum moved the post-limiter
peak **1.061 → 1.100** and the RMS **0.248 → 0.339**, and that what it mostly bought was more
limiter.

⚠️ **That was measured over the bug and 11a has changed it.** Re-measured 7 Nov on the same
four-layer backing, playing with no key pressed:

|                            | in (at the limiter) | out        | windows past full scale |
| -------------------------- | ------------------- | ---------- | ----------------------- |
| every fader at 1, after    | 2.1913              | 1.0964     | 6 of 232                |
| every fader at max, before | 2.5308              | 1.1507     | **20 of 231**           |
| every fader at max, after  | **1.6328**          | **1.0287** | **4 of 231**            |

So a hot layer now ducks instead of leaning on the limiter, and the maximum is a quieter and
cleaner place than it was. The question is unchanged and the answer has moved: raising the cap
would buy even less volume than before, because the scaler takes back what the fader adds once the
sum is over the threshold — but it would no longer cost what it used to in limiting. Still an
ear's decision, and still **not to be changed here**. `BUS_CEILING` in `poly.ts` is the one place
that number now lives, and `setLayerGain`'s own clamp of 2 is still above it (see §13c).

### 11d. Two smaller ones, from the same run

- **`out` and `clip` on the health strip are measured before the volume fader**, because the tap
  forks there on purpose (see `mixer.ts` on why the picture must not follow the knob). So the
  strip can say CLIPPING about a mix that reaches the speakers at 0.77. Left measuring the
  limiter's output and the tooltip now says so; whether CLIPPING should instead mean _at the
  converter_ is a real question.
- **The take chain's echo and space sends have no headroom lean**, where the synth bus leans `dry`
  back as space comes up. A full-scale source with echo at 0.6 peaked at 1.777 through it. Real
  takes come from a microphone well below full scale, so this is a worst case rather than a daily
  one.

---

## 12. The vocal editor, after the import-and-microphone pass (2026-11-06)

Four calls that are Evan's rather than the code's. Everything else from that pass is settled and
committed; these are the ones where two answers are both defensible.

### 12a. A recording you walk away from — kept, or thrown away?

Leaving the instrument mid-recording used to hold the microphone open for ever: the room
unmounted, the Stop button went with it, and the track read `live` four seconds later with no
control anywhere on the site that could release it. That half is simply a bug and is fixed.

The other half is a decision. **What was already sung is now kept** — it appears in the list when
you come back — and the reasoning is takes.ts's own: it refuses to evict a recording at the
storage cap because "that silently deletes something somebody sang, which is the one thing a
recorder must never do", and a tap on the wrong nav link is not a decision to throw a take away.

The argument the other way is that a take nobody pressed Stop on is a take nobody asked for, and
it arrives with no message, because by then there is no panel to put one in. If a stray 0:02 row
after every mis-tap is more annoying than a lost 0:30 is painful, the fix is one line.

(Leaving while the permission prompt is still up drops it instead, and that part is not in
question — nothing was sung into it on purpose.)

### 12b. One sentence for three different refusals

`getUserMedia` can fail three ways and all three say **"No microphone, or the browser said no."**
Measured with each rejection in turn:

| rejected with      | what it means                              |
| ------------------ | ------------------------------------------ |
| `NotAllowedError`  | the person said no, or the site is blocked |
| `NotFoundError`    | there is no microphone on this machine     |
| `NotReadableError` | something else is using it                 |

The first two are covered by the sentence — allow it, or plug one in. The third is not: "another
app has the microphone" is a different thing to do about it, and on a phone it is usually a call
or a voice-memo app left open. Worth a sentence of its own, or not worth the words.

### 12c. 16MB of storage is two voice memos

Measured against a real Windows voice recording: **6 minutes 41 seconds of m4a is 9.3MB**, which
is 58% of `TAKE_CAP`. So the cap is "about eleven minutes of recorded sound in total", not the
three-quarters of an hour its own comment estimates from the 350KB-a-minute that MediaRecorder
produces — a file somebody already has is three times that rate.

Nothing is wrong: the refusal is clear and names both numbers. But the duration cap of ten
minutes can only ever be reached by a file that would also nearly fill the store, so the two
limits are closer together in practice than they look.

### 12d. The edit bar is full

Eight controls, and at 375px they wrap to three lines of buttons plus the status line — 150px of
controls under an 86px picture. Measured clean (nothing undersized, clipped, off-edge or
wordless, Undo and Redo still inseparable), and it looks fine in a screenshot. But it is full:
the next operation added to this editor wants a rethink of the bar rather than a ninth button.

---

## 13. What fixing the ducking turned up (2026-11-07)

Three things the measurement found that are loudness balance rather than defects, so they are
Evan's. They are listed in the order they would be worth acting on, and the first is the only one
with a number attached that anybody would notice.

### 13a. The shipped backing gains were chosen over the bug

The beat-and-chord picker drops its layers in at **0.4, 0.5, 0.55 and 0.55** — `BEAT_GAIN` is 0.55
and has its own paragraph in `looper.ts` about a beat being the thing you play over. Every one of
those numbers was picked by ear while a layer at 0.4 was counting its full patch level against the
room, which held the whole mix down by roughly the inverse of the average fader.

Measured with no key pressed, the backing alone:

|                 | in (at the limiter) | out        | windows past full scale |
| --------------- | ------------------- | ---------- | ----------------------- |
| shipped, before | 0.9848              | 0.9205     | 0 of 85                 |
| shipped, after  | **1.3251**          | **0.9970** | 0 of 60                 |

**About 2.6dB louder, and still nothing past full scale.** Nothing is broken and nothing clips;
the backing is simply where it always meant to be, and the room it sits in is now the one the
numbers describe. The call is whether the backing now sits too far forward under a hand — which
is a thing to hear, not to compute. If it does, the fix is three numbers in `looper.ts` and it
should be made once, with ears, rather than drifted towards.

### 13b. Drums are invisible to the scaler, and always have been

`hitDrum` builds noise bursts and short tones directly and registers no ring, so a drum voice
contributes nothing to the sum that decides how loud everything else is allowed to be. The beat
picker's layers are drums, so a loud kit does not make room for itself and does not take any from
your hands either.

That is defensible — a kick is percussive, the limiter handles transients, and giving a drum an
envelope this file holds the numbers for would mean inventing one. It is recorded because the sum
reads like a sum of everything and is not, and because anybody reasoning from `poly.ts` about why
a busy beat does not duck will otherwise look in the wrong place. Changing it would make the room
quieter around every beat, which is a loudness decision and belongs beside 13a.

### 13c. The nominal sum and the real peak are a factor of three apart

The scaler holds the **sum of envelope levels** at `LIMIT_AT` (0.7). What arrives at the limiter is
the sum of waveforms, whose phases add, and that was measured at **2.19** with the nominal sum
pinned at 0.7 — about 3×. So "held at the threshold" is a statement about a nominal quantity, and
the limiter is still doing real work on anything dense.

This is why `LIMIT_AT` is a calibration rather than a derivation, and it bounds what 11c can ever
buy. It also explains the one thing in `poly.ts` that looks like a loose end: `setLayerGain` clamps
a fader to 2 and the bus clamps it to 1.5, so the top quarter of the slider's travel does nothing.
Closing that gap is a one-line change in either direction and both are audible, so it is here
rather than done.

---

## 14. The Lab's votes and notes — Evan's decisions (7 Nov, and 8 Nov for the totals)

**Built as a draft, applied 9 Nov 2026:** `supabase/migrations/20261109030613_lab_catalog_and_feedback.sql`.
`docs/2026-11-07-lab-catalog-and-feedback.md` has the apply order and the rollback. Evan decided the
three policy questions on 7 Nov and settled the one conflict they left on 8 Nov (§14b); nothing in
this section is waiting on a decision any more.

### 14a. ✅ DECIDED — notes keep their audience; no standing admin access

A note is read through `can_see(author, 'members')`, the profile ladder: an adult's note reaches
members, a minor's or an unknown age's reaches their friends, and its author always. **The admin has
no branch of their own** — they read a note only where the same ladder lets any member read it.
A note the ladder keeps from them reaches them in exactly one way: somebody who can see it
**reports** it, and it then appears in the admin's report queue (`admin_lab_reports`) and nowhere
else. Moderation (`admin_lab_moderate`) acts on a reported note or one the admin can already read;
anything else answers "no such note", the same as a note that does not exist. The admin's per-kind
note counts count only the notes they can read. A removed note stays in the queue so it can be
restored. Tested both in SQL and through the real API (§14e).

### 14b. ✅ DECIDED — every member's vote counts, and members see the actual totals at once

Every member who may vote today counts — adults, minors and unknown ages alike; a suspended
member's earlier votes stop counting while they are suspended. A signed-in member sees the actual
👍 and 👎 totals for every experiment straight away, **zeros included** — a single vote shows as one.
Individual votes are shown to nobody but the voter, and no function returns a list of voters.

**How it got here.** The 7 Nov decision paired "count everybody" with "a total must not reveal
activity the site otherwise hides", and those meet at small numbers: a total of one is somebody's
vote, and a minor's Lab activity is otherwise kept to their friends. The first draft answered with a
floor — no total until three OTHER members had voted — and recorded that even a floor cannot stop
somebody watching a total move while knowing who was online.

**Evan's decision, 8 Nov: no floor.** Show the actual totals immediately, including zero. Evan
accepts that people may infer who voted from a small or moving total; preventing that is not a
requirement for Lab ratings. What stays private is the per-person record — nobody but the voter sees
which way they voted, and there is no list of voters. `lab_vote_floor()` is gone and `lab_totals`
returns `{up, down}` for every member; `src/lab/feedback.test.ts` fails if a floor comes back.

### 14c. ✅ DECIDED — guests browse and play; ratings and notes are members-only

A guest gets the catalog's flags (featured, rough edges, hidden) so retired toys stay hidden for
them too, and nothing counted — no totals and no notes. Every write needs
a session, refused by the grant and again by each function's first line. Playing never needed an
account and still does not.

### 14d. There is no member-to-member block on this site

Friendships here are `pending` / `accepted` only; nothing lets one member stop seeing another. The
Lab honours the rules that DO exist — the visibility ladder, minors' ceilings, suspension and
moderation — and does not claim to honour a block, because there is none to honour. If one is ever
built, `lab_can_read_comment` is the one place that would consult it.

### 14e. How the decisions above were checked, and what that does NOT cover

- **SQL, real Postgres 17** (Supabase's own image, started by the pinned CLI, schema from the repo's
  `sql_paths`): `supabase/tests/lab-feedback.sql`, 130 cases, each rule broken once to watch it fail
  — including a floor put back and a zero total hidden, both of which it names.
- **The real API**: `scripts/lab-feedback-api.mjs` signs accounts up through Supabase Auth and makes
  every call under test through PostgREST with the session Auth issued — guest, separate members, a
  minor, an unknown age, the admin, a suspended member. 59 cases — among them a 0-and-0 total, a
  single vote seen at once by somebody who did not cast it, and the minor's vote in the total; it
  also fails by name when the admin's old reading branch is put back.
- **Not covered:** production's own Auth settings and gateway, which differ from a local stack only
  in configuration; real devices; Firefox and Safari.

### 14f. Smaller calls, recorded so they are not mistaken for accidents

- **An author's delete takes the reports on it too** — a withdrawn note is not kept as evidence.
  The admin's own Remove keeps the note (hidden from everyone but its author) and closes its reports.
- **Limits:** a note is 2–500 characters and nine lines; five notes per ten minutes and twenty a
  day per author; ten reports an hour. Chosen for a site of a few dozen people, not measured
  against any abuse.
- **Favourites live in this browser only** — never sent anywhere, so a second device does not have
  them. The page says so where they are shown. Syncing them is a later decision, not this pass.
  **🕘 Recent** (the last twelve opened, #45) and **🆕 New to you** (which toys arrived since this
  browser first came, #57) follow the same rule and say so on the page. If favourites ever sync,
  these two are the questions to ask alongside it; neither is anybody's work, so neither has to.
- **A suspended author's notes stop reaching other members** — suspension until now only stopped
  writing; this is the first reader to also hide.
- **Hidden means retired:** no new votes or notes, even from the admin, and members cannot read its
  notes; everything already there is kept and returns with a restore.
- **A new toy needs no migration:** the admin's own visit to the Lab registers any id the database
  has not met (`admin_lab_register`). Until then a new toy plays and lists normally but cannot be
  voted on.
