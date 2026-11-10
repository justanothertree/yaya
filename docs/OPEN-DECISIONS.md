# Open decisions

Things that are blocked on Evan rather than on code. Each one names what is already built, what
is actually being asked, and what happens if it keeps waiting.

Last reviewed: 2026-11-09 (two ninth passes written in parallel, merged. ⚠️ **TWO SECTIONS ARE NUMBERED 14**: the Lab's votes and notes, which an applied migration cites, and Chronicle's first three calls, which Chronicle's code and docs cite as §14a–c. Each keeps its number, and Chronicle's run on to §20, all answered by 9 Nov. From the Lab's pass: the vote floor dropped on 8 Nov. From both: §11a DONE, §11b–c re-measured, §13 new; §12 untouched).

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

---

> ⚠️ **A second §14.** Chronicle's sections below were written in parallel with the Lab's §14 above, and
> both numbers are cited elsewhere — the Lab's by an applied migration — so neither moves. Here,
> §14–§20 are Chronicle's.

## 14. Three Chronicle calls, from the daily-flow pass (2026-11-07)

Added closing the pass written up in `docs/2026-11-07-chronicle-the-daily-flow.md`.

✅ **ANSWERED BY EVAN, 7 Nov 2026 — all three.** They are directions now rather than questions,
and each entry below keeps its reasoning with the answer written in, because the reasoning is
what the build has to satisfy. What is left under each is a BUILD, not a decision; the choices
the proposals then turned up are §15.

|                            | answered                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14a weekdays               | a schedule change affects **future occurrences, not past completion history**                                                                                 |
| 14b a note with no sitting | **private by default, in the export, never automatically on anybody's timeline**                                                                              |
| 14c the workout model      | **Circuit supplies the exercise definitions; Chronicle owns the sessions and the progress** — plus "record once, see it in both places", counted exactly once |

**Nothing here has been applied to the database.** The models, permissions, isolated tests and
release plans are in `docs/2026-11-07-chronicle-the-daily-flow.md` §5a and
`docs/2026-11-07-chronicle-recorded-once.md` §2–3.

### 14a. ✅ Weekdays — answered: future occurrences only. What is left is the build

`chronicle_goals.repeat_every` is `1..52` and only **1** is honoured, deliberately — "every other
week" needs a PHASE and a repeating goal has no anchor to take one from. Selected weekdays is the
same gap wearing a different hat, and it is the one example in the brief the model genuinely
cannot express today.

**The proposal, with its DDL, isolated permission test and rollback, is §5a of that file.** The
column is the small half and can be applied inert — nullable, read as "every day", which is
today's behaviour. What needs deciding is not the column.

⚠️ **SUPERSEDED 8 Nov: A COLUMN CANNOT KEEP THE RULE BELOW.** One `days` value on the goal says
what the schedule IS, and the mark row judges thirty-one days of what it WAS — so the answer that
follows rules the column out. The replacement is a history table, one row per change, in
`docs/2026-11-08-chronicle-weekdays.DRAFT.sql`, and its client half is written and tested in
`src/chronicle/weekdays.ts`. Both unapplied and unwired; see §16b and §16c for what is left.

✅ **ANSWERED: a schedule change affects future occurrences, not past completion history.** So
`days` is read FORWARD only — the windows already behind you keep the verdict they were given
under the schedule in force at the time, and a goal that becomes Tuesdays-only today does not
retroactively un-miss last Wednesday or re-miss last Tuesday. That is the stronger of the two
readings and it rules out the cheap implementation, which is to filter every window by today's
mask: a streak is thirty-one windows of history and filtering it is exactly the rewrite this
answer forbids. The honest shape is that the mask carries the date it took effect, so a window is
judged by the mask that was in force when it closed.

⚠️ **What a Monday means to a Tuesday goal** is the other half, and getting it wrong is
destructive in the one way the brief rules out. `late()` and `pastIn()` read "the window closed unfinished";
with a mask they must read "the window closed unfinished **and it was one of yours**". The wrong
reading turns one goal into six overdue rows a week — and rewrites the streak history of
something somebody has actually been keeping, silently, the moment the column arrives. So the
client half is not a follow-on patch; it is the part that has to be right first.

**Cost of waiting:** weekday goals get written as daily ones and read as missed four days in five,
which is what the seed's own "Swim on Tuesdays · EVERY DAY" row has been demonstrating.

### 14b. ✅ A dated note with no sitting — answered: private, exported, never shared

Asked for as "writing a note must not require starting a timer". Today every journal entry hangs
off a `chronicle_entries` row, and `chronicle_note_add` checking that row's owner **is** the
security model for a deny-all table. A note with no sitting has no owner to check, so this is a
schema change however small the UI is.

The schema is the easy part (a nullable `entry` with an `owner` and a `day`, or a second table).
The decision is what a note that is not about a sitting IS, because three readers would have to
be told:

- **the day log** — does a note appear as a row in a list whose every other row is a span with a
  length? The design doc already refused this for ratings and built `chronicle_moments` instead,
  precisely so nothing fabricated could get into the totals;
- **the export** — a new top-level list, and `chronicle_import`'s add-never-replace rule applied
  to it;
- **`chronicle_friends_log`** — which carries **no note at all** today, because the profile card
  promises that. A standalone note is more personal than a sitting's note, not less, so the
  default has to be that it never crosses, and that needs saying rather than inheriting.

✅ **ANSWERED: private by default, in the export, never automatically on anybody's timeline.**
That settles all three readers — and `chronicle_notes` turns out to already carry
`owner uuid not null`, so ownership is a column rather than something derived from the entry and
the change is two `alter table`s. See §3 of `docs/2026-11-07-chronicle-recorded-once.md`, which
also says why "`chronicle_friends_log` happens to carry no note" needs a TEST rather than a
sentence. **Not applied.**

**What is left:** the build, plus §15a — a note with no sitting has no length, and the day log
draws spans.

**And the pain is smaller than it was** as of this pass: ✎ Note on the running header opens the
journal on the sitting you are in without stopping it, and the journal is drawn first inside that
dialog. "I had an idea" at a bus stop with no timer running still has nowhere to go.

### 14c. ✅ Which module owns "what I did today" — answered: Chronicle owns the session

The brief said to reuse the Circuit's exercise and session definitions for a workout flow. Having
read both: **the Circuit has the exercise definitions and no session, and Chronicle has the whole
session and no exercise library.**

|                      | Circuit                                                    | Chronicle                                                                  |
| -------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| a named thing you do | `Exercise` — name, unit, points multiplier, grid position  | `Activity` — name, category, colour, metric, per-sitting target            |
| how it is recorded   | `DayLog` → `LogEntry {eid, val}`, typed into a number grid | a sitting with a start, an end, an amount, a rating, a journal and a photo |
| a timer              | none                                                       | the whole stopwatch, surviving reload and tab close                        |
| who sees it          | shared, scored, other people's columns — 707 logs          | one person's own record, private by default                                |

So "reuse the Circuit's exercises" means deciding which of the two owns the day, which is
**decision 3 from the design doc's §2, still open**: _"should the Circuit sit on chronicle now?"_

- ~~**Chronicle keeps its own activities** and the Circuit's per-exercise breakdown stays a
  separate record of the same hour.~~ Not chosen.
- ✅ **CHOSEN: Chronicle reads Circuit exercises.** One gesture logs both, and the points grid
  gets a timer.

⚠️ **AND THE OBJECTION TO IT IS WHAT THE MODEL HAS TO ANSWER**, so it is kept here rather than
struck out: this gives two tables an opinion about the same minutes, which is the "one home for a
thing" rule in CLAUDE.md §5 pointed at data. The answer is §2a of
`docs/2026-11-07-chronicle-recorded-once.md` — a single `chronicle_sets` row is canonical for a
quantity of one exercise on one day, whichever interface typed it, with `entry` nullable so a set
from the grid and a set from the timer are the same row and not two that have to agree. A sitting
with sets has no separately writable amount, and the tally reads set rows with no sitting through
one `entry is null` predicate in one place. **The proposal is not applied.**

**What is left:** the build, in the three inert steps of §2f — and the two things it surfaced,
§15b and §15c.

---

## 15. What the Chronicle proposals turned up (2026-11-07)

Four smaller choices, each surfaced by writing the models in §14's answers down properly. None
blocks the other work; each is the kind that is cheap now and expensive once there are rows.

### 15a. A note with no sitting, in a list whose every row has a length

The day log draws spans. A standalone note has no start, no end and no duration, which is
precisely why `chronicle_moments` exists as a second list rather than as rows in the first one —
so nothing fabricated could reach the totals.

A note is the same shape of problem with a different answer available: it genuinely belongs to
the day, and a reader skimming the day wants it in the middle of what they were doing, not in a
separate panel. The two honest options are **a row in the log with a time and no length** (which
means the log's own renderer learns a third row type, after the sitting and the moment) or **a
fold of its own above the log**. Not deciding it means the schema can land and nothing can draw
it.

✅ **ANSWERED BY EVAN, 8 Nov 2026:** _"Standalone private notes may appear as moment rows in the Day
log, with a genuine timestamp and no duration. Don't invent a time where only a date is known."_
So the log learns a third row type, and it adds nothing to any total. **The second sentence is a
real constraint, not a restatement:** a day note carries the moment it was WRITTEN and the day it
is ABOUT, and those differ whenever somebody writes about yesterday, or a file puts one back. Only
a note written during the day it is about has a time on that day; any other is drawn with the
date it was written and no clock time, rather than placed at a time the record does not hold.

### 15b. An exercise is a blob, so a set pointing at one has no foreign key

`circuit_people.exercises` is a jsonb array, so `chronicle_sets.exercise_id` cannot be a
reference and nothing stops an exercise being deleted out from under its sets. Today that would
render as "something" in the feed — `chronicle_moments` already has that fallback — and the sets
would count toward their mapped goal for ever with no name on screen.

Three answers, in increasing cost: leave it and let a deleted exercise read as "something";
**capture the name on the set at write time**, which makes the feed honest and the Circuit grid
unable to show it; or lift exercises out of the blob into a table, which is a Circuit migration
and a much larger thing than the workout work itself.

✅ **ANSWERED BY EVAN, 8 Nov 2026:** _"Exercise records retain stable exercise identity plus a
snapshot of the name when recorded. Deleting an exercise definition must not destroy historical
records. Never reconnect exercises by matching names."_ That is the middle answer: `exercise_id`
stays the identity, the name is copied onto the set when it is written, and a set whose exercise
has gone reads by that copy. **The last sentence rules out a tempting repair:** an exercise deleted
and re-created with the same name is a different exercise, and its old sets stay attached to the
old id under the old name rather than being folded into the new one.

### 15c. Moving a sitting to another activity does not move its sets

`chronicle_entry_move` exists because pressing Start on the wrong thing is the likeliest mistake
a stopwatch allows. With sets, moving a Gym sitting to Drawing takes its minutes to Drawing and
leaves 12 Quad Curl where they were — which is **correct**, because the exercise is still the
exercise and the Circuit grid must not lose them.

It is also the kind of correct that looks like a bug: a goal's number moves and the Circuit's
does not. The question is whether the move dialog says so, offers to take the sets too, or
refuses to move a sitting that has them. The first is cheapest and the third is the only one that
cannot surprise anybody.

✅ **ANSWERED BY EVAN, 8 Nov 2026:** _"Moving a sitting between activities does not change which
exercises its sets represent. Explain that consequence in the move UI. Editing its start across a
date boundary must update associated set dates atomically, keeping feeds and tallies consistent
without duplicates."_ So the first option, plus the case §16e added: the move dialog says the
sets stay with their exercise, and a start edited across midnight moves the sets' day in the same
statement as the sitting — one function, one transaction, so no reader can see the two disagree,
and the set rows are updated in place rather than re-inserted, so nothing can count twice.

### 15d. Is `circuit_logs` ever retired?

The release plan in `docs/2026-11-07-chronicle-recorded-once.md` §2f deliberately stops short of
dropping it: the table holds rows for `circuit_people` that belong to no login, and those keep
working through the old path. So the end state has sets as canonical for everybody with an
account and `circuit_logs` still canonical for everybody without one.

That is a stable place to stop and it is two answers to one question, which this project usually
treats as a defect. Worth deciding now whether the unclaimed people are expected to be claimed
eventually — in which case the split is temporary and fine — or never, in which case the split is
the design and should be written down as such rather than left looking unfinished.

✅ **ANSWERED BY EVAN, 8 Nov 2026:** _"Account-linked people may use canonical sets while unclaimed
people retain circuit_logs. Develop the model locally, but keep account-claim migration separately
reviewable: verified ownership/claim permissions, idempotent operation, preservation of legacy data
and a recovery plan. Do not invent claiming access or delete legacy records. Park claim-dependent
work if those requirements remain unresolved."_ The split is the design. **Claiming is the part
that is parked unless its four requirements can be met from what exists**: who may claim a
`circuit_people` row is not something this project has decided (§3 is still open — no family
account is linked to a real person), so a claim function would be inventing that permission. The
sets model is built without it; the migration that moves a claimed person's rows is written up
separately, as its own reviewable item, and is not a step any other release depends on.

---

## 16. Chronicle, the continuous pass (2026-11-08)

Concrete recommendations, each parked on its own so the frontend work around it keeps moving.
**Nothing in this section has been applied to any database**, and none of it blocks the four
draft PRs (#33 → #36 → #37 → #38), which are frontend only.

### 16a. Real signed-in checks need one line in a workflow — may I add it?

This machine has no Docker and no Postgres, so there is no local Supabase to test against, and
the brief rules out writing fixtures into production. **But CI already has the environment:** the
`db guards` job runs `supabase start` and `supabase db reset` — a throwaway database built from
these migrations and the seed, with members in it — and then runs exactly one SQL file,
`supabase/tests/visibility-guards.sql`, through psql.

**Recommendation:** add one step to `db-guards.yml` that runs `supabase/tests/chronicle-*.sql`
the same way. That gives the start → switch → note → amount → stop flow a real run, as a
simulated member against the real functions, on every push, without a credential or a byte of
production. It is a workflow change, which the brief reserves for you; until then the evidence
for everything server-side stays "mocked".

**Cost of waiting:** none of the four drafts gains real signed-in evidence before you press the
buttons yourself — the test steps in #33's description are still the only path to it.

✅ **UPDATE 8 Nov — THE TEST EXISTS AND HAS RUN, so this is now a one-line ask.**
`supabase/tests/chronicle-daily-flow.sql` (#51, independent, based on `main`) acts as a seeded
member on the real functions: start, switch, a mis-press, a note on each sitting, a count written
twice, the read-back, a goal counting it once, stop — and a second member refused at every door.
It ran five times in the `db guards` job's throwaway database, through a scratch branch whose copy
of the one file that job runs included this one, so **no workflow file changed**: clean twice,
"holds · 0 failures"; with an additive count writer, exactly the three count checks failed; with a
writer that skipped the owner check, exactly the two security checks failed. What is left is the
step that makes it run on every push:

```sh
          psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/visibility-guards.sql
          psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/chronicle-daily-flow.sql   # the new line
```

— the second line added inside the existing "Run the visibility guards" step, because `DB_URL`
is a shell variable that step works out for itself; a separate step would not have it. And `chronicle/ci-probe-flow`
is scratch, never to be merged — yours to approve deleting.

✅ **DONE 8 Nov — approved as a narrowly scoped change.** #67, stacked on #51 because it runs the
file #51 adds: the one line inside the existing step, the step renamed to say so, and the header
line. Its own `db guards` run used the workflow at that commit and printed both verdicts in one
job — `all visibility guards hold · 0`, then `the chronicle daily flow holds · 0`. The failing
direction was shown before it existed, by the scratch runs above: the same `psql -v
ON_ERROR_STOP=1 -f` on this file failed the job when the test raised.

### 16b. A weekday schedule edited today — does it take effect today or tomorrow?

Your rule settles every CLOSED day: they keep the schedule they were judged under. Today is the
one day it does not reach, because today's window is still open.

- **Today (recommended).** "From today I swim on Tuesdays", said on a Tuesday, makes today due —
  which is what the sentence means. The cost: a goal finished this morning under "every day" and
  then changed to exclude today stops counting today, so its streak may drop by one.
- **Tomorrow.** Today keeps the old schedule whatever happens; nothing that already happened
  today can be re-judged. The cost: the Tuesday example above does nothing until next week.

The client half (`weekdays.ts`) is indifferent — it judges each day by the entry in force — so
this is decided entirely by the date the form sends. The draft writer refuses anything before
UTC's yesterday, which permits either.

### 16c. A goal CREATED as "Tuesdays" — what does it say about the days before it existed?

The mark row looks back 31 days whether or not the goal existed then; today a new daily goal
that counts an activity shows those days as missed — `streakAsks` asks about every window back to
31 regardless of when the goal was made. A Tuesday goal given its schedule from today would be judged "every day"
for the thirty days before it, and show twenty-six misses for Mondays it never asked about.

**Recommendation:** at creation only, the form writes the schedule from the earliest date there
is, so the goal's first schedule is its schedule for all of the past. That is not a rewrite of
history — there is none before the goal — but it does mean the draft writer must allow one
backdated row in exactly that case (a goal with no schedule rows yet, created today), and that
exception is the kind that wants deciding rather than discovering.

✅ **ANSWERED 8 Nov, for 16b and 16c together — and the answer differs from what I recommended in
two places, so those two are held rather than built.** Your words: _"Weekday schedule edits take
effect today for the current and future occurrences, but must not rewrite earlier history or erase
a completion already recorded today. New goals must not create missed occurrences before their
creation date."_

- **Agreed, and already how `weekdays.ts` works:** an edit takes effect today; every earlier day
  keeps the schedule it was judged under, because the schedule is a history and `maskOn` reads the
  entry in force on each day.
- **Different — today's completion.** My "today" accepted a cost: a goal finished this morning and
  then edited to exclude today "stops counting today, so its streak may drop by one", because
  `scheduledMarks` turns a met off-day into `off`. Your rule forbids exactly that. See 16f.
- **Different — before creation.** My "yes" only stopped OFF-days before creation reading as
  misses, by back-dating the first schedule row; a SCHEDULED day before creation would still have
  been a miss, as it is for every new daily goal today (the 31-day row asks about every window back
  to 31 regardless of when the goal was made). Your rule removes every miss before creation, for
  every goal, which is better — and it makes the back-dated row and the draft writer's exception for
  it unnecessary. See 16g.

### 16d. The stacked drafts only get one of the four CI checks

`lint`, `test` and `build` run on pull requests **to `main`** only; `db guards` runs on every push.
So #36, #37 and #38 — based on each other so each diff is one commit — have had `db guards` in CI
and lint, typecheck, tests and build **locally, at each exact head**. The full set runs on each as
it is retargeted to `main`. Nothing to decide unless you would rather they targeted `main` now,
which would show #33's commits again inside every one of them.

### 16e. Recommendations for §15, so they can be answered with a yes

✅ **ALL FOUR ANSWERED 8 Nov 2026** — each answer is written under its own question in §15a–d, in
Evan's words. 15a and 15b are as recommended; 15c is as recommended, with "atomically" and "without
duplicates" made explicit; 15d is as recommended, with the claim itself parked behind four
requirements.

- **15a, where a standalone note goes:** a row in the day log with a time and **no length**,
  drawn like a moment (the rating rows already are) — not a fold. A note belongs to the day,
  and the Journal half (#37) is where it would also be listed beside every other note — which
  `journalRows` will need teaching, since today it only reads notes that hang off a sitting.
- **15b, exercise identity:** keep `exercise_id` (the blob's ids are stable — `Exercise.id`) and
  **capture the name on the set when it is written**, so a deleted exercise still reads by name.
  Lifting exercises out of the blob is a Circuit migration and not worth it for this alone.
- **15c, moving a sitting:** the move dialog **says so** — "the 12 Quad Curl stay with Quad Curl"
  — rather than refusing or offering to move them. And a related case surfaced since: editing a
  sitting's START across midnight must move its sets' day in the SAME call, because the day a set
  counts for is a local date the client computes, and two writes would leave a window where the
  Circuit grid and the sitting disagree about which day the reps were. The recorded-once proposal
  stored that day as "carried rather than derived"; for a set that has a sitting it should follow
  the sitting.
- **15d, `circuit_logs`:** treat the split as **the design**, and say so in the migration: sets
  are canonical for a person with an account, `circuit_logs` stays canonical for an unclaimed one.
  Claiming a person migrates their rows at that moment, in the claim function — one path, at the
  one point the answer changes.

### 16f. A day that was met, under a schedule that now calls it off — met, or off?

Your rule says an edit must not erase a completion already recorded today. Two ways to keep that,
which differ on every OTHER day too:

- **A met day is met, whatever the schedule says (recommended).** One rule with no special day:
  today's finished goal stays finished and keeps counting toward the streak after an edit, and so
  does an extra swim on a Wednesday for a Tuesdays goal. Nothing that was done is ever drawn as
  "off". The cost: a streak can include days the schedule did not ask for.
- **A met off-day is shown as done but skipped by the streak, like an off day.** The streak stays
  strictly about the schedule. The cost: today's completion stops counting toward the streak after
  the edit, which may be what you meant by "erase".

`scheduledMarks` changes by one line either way. Nothing is built until you choose.

✅ **ANSWERED BY EVAN, 8 Nov 2026 — the first option:** _"Keep earned completions and their streak
credit when a schedule edit makes a completed day an off-day. Never erase earned history through a
scheduling change."_ So a met day is drawn met and counts toward the streak whatever the schedule
now says about it. **How it is built:** the rule is "a met day is met", with no special case for
the day of the edit — because the only day an edit can reach is today (every earlier day keeps the
schedule it was judged under), and a rule with a special case for today would be one that changes
its answer at midnight. **One consequence to know about:** the same rule means an extra swim on a
Wednesday, for a goal that has always been Tuesdays, also counts toward the streak. Nothing
was erased there, so the decision does not forbid it — but it does not ask for it either. It is
queued in the integration queue as a yes/no rather than decided here.

### 16g. A day before a goal existed that the record shows as met — met, or blank?

Removing misses before creation needs the goal's creation date in the room (`chronicle_goals_mine`
does not send `created_at` today — a reader change, the marks reader could carry it). The open half
is the days the RECORD answers for: you drew yesterday, and today you make "draw every day".

- **Blank (recommended).** The goal did not exist, so it neither met nor missed; the row starts on
  the creation day and so does the streak. It reads your "don't invent historical successes" the
  strict way.
- **Met.** It is a true fact about the record, and it is what the 31-day row shows today. The cost:
  a goal made this morning can open with a ten-day streak.

This changes what every NEW goal looks like on the 31-day row, weekdays or not, so it can ship
before weekdays do.

✅ **ANSWERED BY EVAN, 8 Nov 2026 — the first option:** _"Periods before a goal's creation are not
applicable—neither successes nor misses. Older activity records remain intact, but don't
manufacture a retroactive goal streak."_ So a window that ended before the goal's creation day is
drawn as neither met nor missed, and a streak cannot reach back past it. The window that CONTAINS
the creation day is judged normally, because the goal existed during it: a weekly goal made on a
Wednesday is asked about that whole week. **What it needs:** the goals reader has to send
`created_at`, which it does not today, so this rides in the weekday draft's reader change. Until
that is applied the room has no creation date and draws every window as it does today — the
same answer it gives now, not a new wrong one.

---

## 17. A repeating goal ticked by hand never resets — found 8 Nov 2026

**This is a live defect, not a proposal for something new**, and it is the first example in the
brief Chronicle was rebuilt from: _"Floss every day: simple check-off."_

`chronicle_goals` keeps one `done_at` and one `progress` per goal. A one-off goal has one window,
so that is right. A **repeating** goal moved by hand — a tick-box, or a count moved with − and + —
keeps the same flag and the same count in every window after the first. "Floss every day", ticked
once, reads ticked on every later day; "Stretch 20 minutes a day" starts day two at yesterday's
total. Goals the **record** answers for are unaffected, because the tally is asked per window.

**Evidence:** read from `chronicle_goal_progress` and from `finished()` in goal.ts, and shown in
the preview double, which keeps the same single flag: a new daily tick-box ticked on Today was
already ticked on Tomorrow. **Not exercised against production**, by instruction. The workaround
today is to untick and re-tick each day — which still shows the goal as done every morning.

**The fix is written and tested, and not applied:** one row per goal per window,
`docs/2026-11-08-chronicle-repeat-marks.DRAFT.sql`, with its client half in
`src/chronicle/marks.ts` (9 tests; four perturbations, one of them reproducing today's behaviour
exactly, each turned some red). It also makes a streak POSSIBLE for a repeating tick-box, which has never had the history
for one — the room does not draw that row yet.

### 17a. Approve the per-window marks table?

**Recommendation: yes, before anything else on the Chronicle list.** It is the difference between
the daily check-off working and working once. Three inert steps, each revertible on its own.

### 17b. What to do with the repeating goals that already carry a tick or a count

Nothing is deleted either way. **Recommendation:** copy a repeating goal's existing `done_at`
into a mark for the window that contains it — a true fact, it was done then — and leave its
`progress` on the row, unread, because nothing records which window a hand-moved count belonged
to and assigning one would invent a history.

### 17c. Hide "every day" on tick-box goals until 17a lands?

It would stop new goals being made that work once. **Recommendation: no** — it would hide what
the existing ones are, and it is a change to undo the day the fix ships. Better to ship 17a.

✅ **UPDATE 8 Nov — 17a approved for implementation and local testing, and done; applying it is
the next approval (17d).** Built on `chronicle/marks-wired`, draft PR #73, stacked on the frontend
tip (#43):

- **The draft is runnable**, in three steps that are each inert alone: the table, writer, reader and
  the export/import carrying `marks` (`docs/2026-11-08-chronicle-repeat-marks.DRAFT.sql`); the room
  (#73's frontend commit); and the profile reader
  (`docs/2026-11-08-chronicle-repeat-marks-profile.DRAFT.sql`), which must land after the room or
  every repeating goal on every profile would read ○.
- **The window is keyed by goal, scope and local date, and carries its two instants**, so the
  server can tell which mark is current without knowing anybody's zone, and refuses a window that
  has not begun.
- **Evidence:** `supabase/tests/chronicle-repeat-marks.sql`, as a seeded member against the real
  functions in CI's throwaway database, with the drafts applied: clean twice; seven faults put in,
  each named by its own check; and the standing visibility guards, the daily flow and the
  export/import round trip all still hold with the drafts in place. In the preview double, desktop
  and 375: Floss unticked today though its row says done, ticked for one day only, "opens tomorrow"
  on the Tomorrow tab.

**17b, done differently from the recommendation above — and the reason is your own rule.** I
proposed copying the row's `done_at` into a mark for the window containing it. The server cannot
place it honestly: the window is local, and an 8pm tick in California is the next day in UTC. So
nothing is copied. The reader hands the row's `done_at` to the room as `legacy`, and the room lights
the one local window containing it; a mark, once there is one, wins. Evidence preserved, placed
where it is true, nothing written on anybody's behalf, nothing invented. The row's `progress` is
still not read for a repeating goal. One visible consequence: a profile cannot place the old tick
either, so a goal ticked under the old room reads ○ to friends for the rest of that one window.

**17c is moot** once 17d is done.

**One behaviour to know about:** the Tomorrow tab no longer ticks a repeating goal. It shows
tomorrow's own window, which has not begun, so the box and ± are disabled and say "opens tomorrow".
Before, ticking it there ticked the one shared flag — today's too.

### 17d. Approve applying step 1 to production?

**Recommendation: yes, then deploy the room, then step 3.** In that order each step is inert alone,
and the rollback for each is written in its file. Two things to know first:

- **The substitutions into `chronicle_export` and `chronicle_import` were matched against CI's
  database**, which is built from the schema baseline, not from production. The migration raises
  if any substitution does not match exactly once, so a production function that has moved on stops
  it rather than being half-patched — but it is worth one read-only look at production's text
  (`pg_get_functiondef`) before applying, which I have not done, by instruction.
- **The room must not ship before step 1.** Until the table exists, every tick on a repeating goal
  would come back refused.

---

## 18. A note with no session — built as a draft (2026-11-08)

§14b's three rules were settled, so the build went ahead as a draft: #76, with
`docs/2026-11-08-chronicle-day-notes.DRAFT.sql` and `supabase/tests/chronicle-day-notes.sql`.
**Nothing is applied.** The room's door is the Journal: a box at the top, day notes listed beside
session notes, and ✎ Note with nothing running opening that box. The test asks "never on anybody's
timeline" two ways: as a census of every function that names the table, and as a friend reading
a member who is sharing a session. The test first insists the friend's readers did return that
session, so an empty answer cannot pass for privacy.

### 18a. Approve applying the day-notes draft?

**Recommendation: yes, after #73's step 1 or before it — the order does not matter, and both have
run.** It changes a live table: `entry` becomes nullable, and a column and a CHECK are added. Every
existing row satisfies the CHECK. The rollback is written in the file, and its last step deletes
what people wrote, so that step says to export first and ask.

### 18b. §15a is still open, and #76 does not need it

Where the **Day** log draws one of these — a row with a time and no length, or a fold of its own
— is still §15a, recommended in §16e. Until it is answered, a note with no session lives in the
Journal only, which is a complete feature on its own rather than half of one.

✅ **ANSWERED 8 Nov (§15a) and built** — #84, stacked on #76: a moment row in the Day log, with a
time only when the note was written during that day. See §19.

---

## 19. Chronicle, the evening pass of 8 Nov 2026 — what was built, and what is asked

Built under the answers recorded in §15 and §16, each as a draft PR. **Nothing is applied to any
database, merged or deployed.**

| PR  | Branch                     | On  | What                                                                         |
| --- | -------------------------- | --- | ---------------------------------------------------------------------------- |
| #83 | `chronicle/weekdays-wired` | #73 | weekdays and creation dates (§16b, §16c, §16f, §16g), with a runnable draft  |
| #84 | `chronicle/day-log-notes`  | #76 | a note with no session as a moment in the Day log (§15a), frontend only      |
| #85 | `chronicle/sets-model`     | #43 | step 1 of recorded-once (§15b, §15c, §15d), with a runnable draft            |
| —   | on #73                     | —   | daily, weekly and monthly marks asked separately, at every boundary and zone |

How they fit together, and what CI says about the combined tree, is
`docs/2026-11-08-chronicle-integration-queue.md`.

### 19a. An extra session on a day the schedule never asked about — does it count?

Your §16f answer keeps an earned completion when an edit makes its day an off day. It is built as
**"a met day is met"**, because the only day an edit can reach is today and a special case for
today would change its answer at midnight. The same rule also counts a Wednesday swim for a goal
that has always been Tuesdays.

- **Count it (recommended, as built).** One rule, and nothing done is ever drawn as off. The cost
  is that a streak can include days the schedule never asked for.
- **Do not count it.** An off day stays a short tick even when met, except a day that an edit
  turned off after it was met. The cost is a second rule that compares the schedule row's `set_at`
  with when the day was met.

### 19b. A friend's view of a weekday goal on its off day

`get_member_chronicle` counts a repeating goal as open when its current window has no mark. The
server has no zone, so it cannot tell a member's Wednesday from their Tuesday, and on a friend's
view of a profile a Tuesdays goal still reads as open on a Wednesday. The member's own room is
right.

- **Leave it (recommended for now).** The friend's count is off by one on off days, and only there.
- **Store a time zone name on each profile** so the server can work out the member's local day.
  That is a new column of personal data and a settings screen, which is your call rather than mine.

### 19c. Apply the weekday draft?

**Recommendation: yes.** Apply it in any order with the other three drafts, then deploy the room
(#83, which needs #73's room). It adds a table, a writer and two fields to the goals reader. Until
the room ships, a goal with no schedule reads exactly as today. The rollback is written in the file.
The same caveat as §17d applies: the substitutions were matched against CI's database, so a
read-only look at production's `pg_get_functiondef` first is worth one call.

### 19d. Apply the sets draft (step 1 of recorded-once)?

**Recommendation: yes, whenever convenient. Nothing reads the table yet**, so applying it changes no
number on any screen. #85's room only reads it to explain a move and to carry a moved sitting's
sets. Step 2, where the tally, the Circuit grid and the day's feed read sets, is the next build. It
changes three live readers, and each will be its own reviewable draft.

### 19e. The claim migration (§15d) is parked, and here is exactly why

§15d asks for verified ownership and claim permissions, an idempotent operation, preserved legacy
data and a recovery plan before a claimed person's `circuit_logs` move to sets. The last three can
be written. **The first does not exist:** `claim_person` lets any member of a group that contains
an unclaimed person claim that person, first come, with no check that they ARE that person. Moving
history on claim would hand somebody's whole log to whichever relative pressed the button first.

**Question: what should make a claim verified?** For example, an admin approves it, or the person
being claimed confirms it from their own account. Until that is decided, sets stay writable only
for a person `owner_user_id` already names (#85), `circuit_logs` stays canonical for everybody
else, and nothing is migrated.

### 19f. Device and signed-in checks, for whenever you are on the site

None of this can be exercised signed in from here, by instruction. Once the drafts are applied and
the room deployed:

1. Make a daily goal, tick it, then edit it to leave today out. It should stay ticked and say "not
   due today".
2. Look at the Tomorrow tab when tomorrow is an off day. The goal should not be there.
3. On yesterday's Day log, press ✎ Note and write something. Yesterday's log should then show it
   with "written <today>" and no time.
4. On a phone: the seven day toggles and the note row's ✎.
5. Link an exercise in an activity's editor; start that activity; count a few sets; Undo one. Then
   open the Circuit: the cell should say how much came from sessions, and typing a total below it
   should be refused, saying so.
6. With sets counted on a sitting, change its activity in its editor: the move sentence should say
   the sets stay with their exercises. (Until the counter could write sets this had no device check.)
7. On a sitting with counted sets, Account → ⬇ Save a copy, then ✕ one set in the sitting's editor,
   then ⬆ Put one back with that file. The set should stay out, the sitting's count should not move,
   and the toast should not claim the file added anything it did not.
8. On a Circuit cell that holds sessions, tap "change them there". Chronicle should open on that
   day's log, not today's. Then type a total into the cell and wait for "Saved ✓": the line saying
   how much came from sessions should still be there.
9. On a phone, open a past day in the Circuit log that has a workout saved. The date row should
   wrap, with "Saved ✓" whole on the second line rather than cut off at the edge.
10. On a Circuit day with a photo, type one number, then clear every number. The day and its photo
    should still be there. (Before this, the board forgot the photo after one typed save, and
    clearing then deleted the day, with its comments.)
11. Open the Circuit, follow a cell's "change them there", take a set back in Chronicle, and come
    back to the Circuit. The cell should show the new total without a reload, and typing into it
    should save the first time (§20b). Try it once with the canvas on, where the Circuit stays
    mounted, and once with it off.

The preview now has a stand-in for the signed-in Circuit board (`src/dev/circuitPreview.ts`), and
8–10 were driven there first. It shares Chronicle's preview store and runs the real adapter, so it
is evidence about the frontend; it is not a session, and the server's half is the SQL tests.

### 19g. Sets, step 2: three questions before anything reads them

Step 2 is where the numbers people see start reading sets:

- a sitting's count, and the goals that count it;
- the Circuit grid;
- the day's workout line.

Writing it down properly turned up three things the recorded-once proposal assumes without
saying. Each changes what a number on screen means, so **step 2 is parked on these and nothing
else**. Step 1 (#85) does not depend on them.

1. **Units.** A set carries its exercise's unit (reps, min, sec, mi, km, hr), and a sitting's
   count carries its activity's one metric. "12 Quad Curl + 30 sec Plank" is not a number of
   anything, so which sets add up to a sitting's count, and to a goal counting it?
   **Recommendation:** an exercise can only be linked to an activity whose metric is its own
   unit. Plank does not link to Gym, and it still counts in the Circuit, where points use `mult`.
2. **A grid cell is a day's total; sets are separate entries.** For a person with an account,
   when they type 20 into Quad Curl's cell and 12 came from a Chronicle sitting, what is written?
   **Recommendation:** one set with no sitting, holding the difference (8). A cell can never be
   set below what sittings counted on that day; lowering that part is done by editing the
   sitting. Nothing typed in the grid deletes a sitting's sets.
3. **The logs an already-linked person has.** Until those `circuit_logs` rows become sets, the
   grid would show a day's legacy total and its sets side by side for the same exercise.
   **Recommendation:** for a person `owner_user_id` already names, run step 3 of the proposal
   before the grid reads sets: one set per `{eid, val}`, and `circuit_logs.entries` frozen rather
   than dropped. It is a migration of existing records, so it would be its own reviewable draft
   with a dry-run count, and applying it would be its own approval. It is NOT the claim migration
   in §19e. Nobody becomes linked by it, and an unclaimed person's logs stay exactly where they
   are.

✅ **ANSWERED BY EVAN, 9 Nov 2026 — all three, with rules.** Evan's words, then what each means for
the build. Approved for implementation and isolated testing only; nothing here is approval to
apply anything to production.

1. _"UNITS: YES. Link exercises to activities only when their actual normalized units match.
   Don't infer compatibility from names or mix seconds with reps. Preserve unmapped legacy
   records; queue ambiguous mappings instead of guessing."_
   - One normalisation table, in SQL and in TypeScript, kept in step by a test. An exercise's unit
     and an activity's metric each map to a canonical unit or to nothing.
   - A link needs both to map and to agree. "Nothing" never matches anything: an exercise in
     `other`, or an activity counting "laps", is listed as **needs a decision** rather than linked.
   - Names never take part, and an unlinked exercise's records stay exactly where they are.
   - The check runs at write AND at read, because either side's unit can change after linking.
2. _"GRID EDITS: YES, WITH THESE RULES. If sessions contribute 12 and I enter 20, store an
   editable manual contribution of 8. Saving 20 again must still total 20—not 28. Later sessions
   add normally; don't keep adjusting the manual contribution to hold the total at 20. Reject
   totals below the session contribution with a clear explanation and a discoverable way to
   correct the underlying sessions. Don't silently clamp the number, delete sessions or overwrite
   their recorded amounts. Enforce permissions and concurrent-update correctness on the server
   too."_
   - A cell is written as a TOTAL. The server works out `manual = total − sessions` against the
     sessions as they stand, and stores the manual part.
   - A second save of the same total writes the same manual part, so the total stays 20.
   - A later session adds to the total; the manual part is untouched until the cell is typed
     into again.
   - A total below the sessions is refused, naming the session amount, with a link to that day
     in Chronicle.
   - The client sends what it SAW (sessions and manual). If either has moved, the save is refused
     and the cell shows the new figures, rather than guessing which of two meanings "20" had.
3. _"EXISTING LOGS: YES TO A SEPARATE CONVERSION DRAFT. … Preserve originals and stable source
   identifiers. Re-running conversion must not duplicate records. Reconcile amounts by person,
   exercise, day and unit. Preserve date-only records without inventing times; report records
   that cannot be converted rather than dropping them. Keep the existing reader until conversion
   is validated, then switch without missing or double-counting records. Freezing legacy writes
   belongs to that coordinated future cutover—not an independent production change now."_
   - Its own branch and its own draft.
   - Each set made from a log carries the log's id and the entry's position as its source. A
     unique key on that source makes a re-run add nothing.
   - Duplicate rows for one person and day are summed per exercise and reported.
   - `__total__` entries, exercises no longer on the person's list, and units that do not
     normalise are reported, never dropped.
   - The grid reads the legacy log until a person is marked converted, in the same transaction
     as their conversion. After that it reads sets only, so there is no window in which a day is
     read twice or not at all.
   - Nothing freezes or deletes legacy writes.

**Built on 9 Nov, as three follow-on branches from the integration boundary, none applied:**

- `chronicle/sets-links`: links (1).
  - A unit table kept identical in SQL and TypeScript.
  - Counted sets written through into their sitting's amount, so no reader of an amount changed.
  - Goals adding the grid's typed part by local day.
  - The counter's sets mode, and the activity editor's "From the Circuit" row.
- `chronicle/sets-grid`: cells (2).
  - circuit_session_sums, behind the Circuit's own see rule.
  - circuit_cell_set storing total − sessions under a lock every set writer shares, with stale and
    below-sessions saves refused.
  - The board showing totals.
  - A cell saying "12 from Chronicle sessions · change them there".
- `chronicle/sets-conversion`: the separate conversion proposal (3), and the switch every reader
  makes at its marker.

---

## 20. Chronicle — every open question, in one place (9 Nov 2026)

✅ **RELEASED 9 Nov:** 17d, 18a, 19c, 19d and 20c are applied to production and the room is deployed
(#101), following `docs/2026-11-09-chronicle-release-plan.md`, which records each step's checks.
§19f's device checks are the part only a signed-in phone can make.

✅ **ALL ANSWERED 9 Nov, as recommended.** Evan's words: "These answers are NOT approval to apply
anything to production." Applying 17d, 18a, 19c, 19d and 20c is one release, approved as one
step against `docs/2026-11-09-chronicle-release-plan.md`. Each row's own section holds the
reasoning.

| §   | Question                                                                       | Answer                                                                              |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 17d | Apply the per-window marks draft (step 1)?                                     | Yes, as part of the release plan                                                    |
| 18a | Apply the day-notes draft?                                                     | Yes, as part of the release plan                                                    |
| 19a | Does an extra session on a day the schedule never asked about count?           | Yes, as built                                                                       |
| 19b | A friend's view of a Tuesdays goal on a Wednesday: leave it, or store a zone?  | Leave it. No stored time zone                                                       |
| 19c | Apply the weekday draft?                                                       | Yes, as part of the release plan                                                    |
| 19d | Apply the sets draft (step 1)?                                                 | Yes, as part of the release plan                                                    |
| 19e | What makes claiming a Circuit person verified?                                 | An admin approves it, or the person confirms from their own account. Not yet built  |
| 20a | A set counted in Chronicle shows in that person's Circuit column. OK?          | Yes: the number only; the session's details stay private                            |
| 20b | The board does not see Chronicle's sets until it reloads. Realtime, or reload? | Reload the board when the Circuit opens again; no realtime. Built as a draft (#100) |
| 20c | Apply the links draft, then the grid draft?                                    | Yes, after 19d, links then grid, as part of the release plan                        |
| 20d | The conversion: when, and with which freeze?                                   | No conversion until Evan picks a cutover date                                       |

✅ **20e, answered 9 Nov: keep it as built.** A restore leaves out a converted person's sets with no
sitting. The question was what to do after a converted cell is retyped: restoring an older file put
the replaced sets back beside the new manual part, and a cell converted at 10, retyped to 25 and
restored read 35. It only acts on a converted person, so like the rest of the conversion it waits
for the 20d cutover.

Device and signed-in checks are §19f, and grow with each build.
