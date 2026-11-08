# Open decisions

Things that are blocked on Evan rather than on code. Each one names what is already built, what
is actually being asked, and what happens if it keeps waiting.

Last reviewed: 2026-11-07 (ninth pass — Evan answered all three of §14, so they are directions now and §14 says what is left under each; §15 is the new, smaller set of open choices the proposals turned up. §11a is DONE, §11b and §11c are re-measured on top of it, §13 is new; §12 untouched).

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

### 15b. An exercise is a blob, so a set pointing at one has no foreign key

`circuit_people.exercises` is a jsonb array, so `chronicle_sets.exercise_id` cannot be a
reference and nothing stops an exercise being deleted out from under its sets. Today that would
render as "something" in the feed — `chronicle_moments` already has that fallback — and the sets
would count toward their mapped goal for ever with no name on screen.

Three answers, in increasing cost: leave it and let a deleted exercise read as "something";
**capture the name on the set at write time**, which makes the feed honest and the Circuit grid
unable to show it; or lift exercises out of the blob into a table, which is a Circuit migration
and a much larger thing than the workout work itself.

### 15c. Moving a sitting to another activity does not move its sets

`chronicle_entry_move` exists because pressing Start on the wrong thing is the likeliest mistake
a stopwatch allows. With sets, moving a Gym sitting to Drawing takes its minutes to Drawing and
leaves 12 Quad Curl where they were — which is **correct**, because the exercise is still the
exercise and the Circuit grid must not lose them.

It is also the kind of correct that looks like a bug: a goal's number moves and the Circuit's
does not. The question is whether the move dialog says so, offers to take the sets too, or
refuses to move a sitting that has them. The first is cheapest and the third is the only one that
cannot surprise anybody.

### 15d. Is `circuit_logs` ever retired?

The release plan in `docs/2026-11-07-chronicle-recorded-once.md` §2f deliberately stops short of
dropping it: the table holds rows for `circuit_people` that belong to no login, and those keep
working through the old path. So the end state has sets as canonical for everybody with an
account and `circuit_logs` still canonical for everybody without one.

That is a stable place to stop and it is two answers to one question, which this project usually
treats as a defect. Worth deciding now whether the unclaimed people are expected to be claimed
eventually — in which case the split is temporary and fine — or never, in which case the split is
the design and should be written down as such rather than left looking unfinished.

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

### 16d. The stacked drafts only get one of the four CI checks

`lint`, `test` and `build` run on pull requests **to `main`** only; `db guards` runs on every push.
So #36, #37 and #38 — based on each other so each diff is one commit — have had `db guards` in CI
and lint, typecheck, tests and build **locally, at each exact head**. The full set runs on each as
it is retargeted to `main`. Nothing to decide unless you would rather they targeted `main` now,
which would show #33's commits again inside every one of them.

### 16e. Recommendations for §15, so they can be answered with a yes

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
exactly, each turned some red). It also gives a repeating tick-box a streak for the first time.

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
