# Testing checklist — changes from 2026-08-19 → 2026-08-21

Everything below is already live. This is what I could not verify myself, ordered so the riskiest
and most visible things come first.

**Why so much of it needs a human:** almost all my checking ran in a hidden browser pane, where
CSS transitions freeze, `requestAnimationFrame` never fires and screenshots do not work. I
confirmed _values_ — contrast ratios, class names, focus targets, row counts — far more than I
confirmed _appearance_. Anything below marked 👀 is specifically "does this look right", which is
the part I am least able to judge.

Legend: 👀 appearance · 🔒 security · ⚠️ could be wrong in a way that matters

---

## 1. Start here — five minutes, the changes you did not ask for

These are visible changes I made on my own judgement. If any look wrong they are one-line
reverts; say so rather than living with them.

- [ ] 👀 **Home page project buttons** ("Open the app", "Play now", "Try the demo") now have
      **dark text instead of white**. Reason: white measured 1.67:1 on the amber and 2.28:1 on the
      green — genuinely hard to read. Does it look deliberate or broken?
- [ ] 👀 **The Circuit, everywhere the purple accent is a background** — active tab, primary
      buttons, today's marker on the board — now has **dark text instead of white** (3.99 → 4.80).
      The purple itself is unchanged.
- [ ] 👀 **Alt theme (✦)** — button text flipped to **white** (was 3.36:1, now 5.70:1).
      Check a few buttons in that theme.
- [ ] 👀 **Light theme (☀)** — I never designed against it, only measured it. Have a general look
      for anything that reads badly.

## 2. Investments — the priority module ⚠️

- [ ] Open **#investments** signed in. It should load normally.
- [ ] 👀 Signed-out demo still shows sample figures with a "Set aside" stat (renamed from
      "Worth today").
- [ ] **Admin → Fund tab** exists and renders. ⚠️ I could not see this at all — it needs an admin
      session I do not hold, so this is entirely unverified visually.
- [ ] In Admin → Fund, record a small test contribution (e.g. $1 today). Expect: it appears in the
      list, shows a per-person split, and the hero number changes from "Nothing recorded yet".
- [ ] Remove that test entry again. Expect: list empties, back to "Nothing recorded yet".
- [ ] With nothing recorded, a member's investments page should say **"Still being set up"** and
      show **no ahead-or-behind number**. That is deliberate.
- [ ] ⚠️ **Hand one account to a real person** (Investments admin → edit → Member picker). Expect:
      it saves. If Investments could not be switched on for them you should now see a muted
      ⚠️ warning saying so and pointing at Admin → Members — previously that failed silently.

## 3. Circuit

- [ ] Board loads, standings look right, day squares fill correctly.
- [ ] Click a person's name → their stats sheet opens. ⚠️ This is now a `<button>` rather than a
      span; check it still looks like plain coloured text and is not shifted or boxed.
- [ ] Sub-tabs (Board / Log / Feed / Charts / Reviews / Pool) all switch and **render content**.
      The original bug was the whole section going invisible.
- [ ] Log a workout. Expect an "Undone"-style toast to still appear on undo.
- [ ] Charts → hover a point on **points-per-day**. The tooltip should size sensibly, especially in
      a narrow canvas window.
- [ ] Canvas mode: drag a window, resize it, "Fit to content", "Tile", "Fit all".
- [x] ~~Drag a window and toggle Canvas off mid-drag~~ - Evan: not physically possible, the cog
      menu can't be reached with the mouse already down. The guard stays (it costs nothing and
      covers a stray pointercancel), but there is nothing to test by hand.

## 4. Chat and calls

- [ ] Open a conversation. Messages load.
- [ ] 🔒 **Click someone's name on a message** → their profile opens.
- [ ] 🔒 **In The Lounge, names must NOT be clickable** — that is the pseudonym. If a Lounge name
      links anywhere, tell me immediately.
- [ ] Send a message. It appears, and your own message renders as yours (right-aligned), not as
      someone else's.
- [ ] Unread badges still count correctly, including for the Lounge.
- [x] ~~Call sound~~ - confirmed working 2026-08-21.
- [ ] A real call still connects, with audio and screen share.

## 5. Snake

- [ ] Game loads and plays. ⚠️ It is now lazy-loaded, so there may be a brief "Loading the game…"
      on first open — that is expected, but tell me if it is slow or janky.
- [ ] Score saves at the end of a run. Expect "Score saved!".
- [ ] 🔒 **Play signed out using a name somebody has claimed.** Expect it to be REFUSED with
      _"…belongs to a member — sign in as them to post under it."_ Previously anyone could
      overwrite a member's best score.
- [ ] Play signed out under an unclaimed name — that should still save normally.
- [ ] ⚠️ **Multiplayer**: scores under a claimed handle currently do NOT record, by design, because
      the relay does not vouch for identity yet. Confirm that is acceptable for now.

## 6. Keyboard and screen reader (optional, but this is the part I changed most)

- [ ] Tab through the site without a mouse. You should be able to reach everything.
- [ ] On the Circuit board, Tab to a person's name and press Enter → sheet opens.
- [ ] With the sheet open, Tab repeatedly — focus should stay **inside** the dialog.
- [ ] Press Escape → sheet closes and focus returns to the name you opened it from.
- [ ] Navigate between pages; the browser tab title should change ("Investments · Evan Cook").
- [ ] Number keys should do NOTHING now. They used to jump between sections.

## 7. Admin

- [ ] Admin panel loads; Invites / Members / Snake names / **Fund** / Usage tabs all render.
- [ ] **Usage tab** — should show real Cloudflare numbers or an explicit error. ⚠️ It must never
      show a confident "0" when the token is bad; that was the bug. If it shows 0, check whether
      that is genuinely your usage.
- [ ] Snake names tab still lists handles.

## 8. Already verified by me — no action needed

Recorded so you do not spend time re-checking:

- 🔒 Relay is up after your redeploy (HTTP 200), `/usage` correctly returns 403 "admin only"
  without auth, `/ice` returns 200 with STUN fallback for signed-out visitors.
- 🔒 Nobody but an admin can read `list_members` / `admin_get_member`; a non-admin reading
  `profiles` gets exactly their own row.
- 🔒 Anon cannot read any of the eight circuit tables, nor `player_registry.user_id`.
- 🔒 Self-joining a circuit without an invite code is refused; joining WITH the code still works.
- 🔒 A forged Snake round cannot write to a claimed account; an unclaimed name still records.
- 🔒 No secrets are committed, and none ever were anywhere in git history.
- All 10 routes render; every route has exactly one `<h1>`; zero contrast failures in dark theme.

## 8b. Second round — from your 2026-08-21 testing

- [ ] ⚠️ **Joining a call somebody else started.** The one that failed: connecting → reconnecting
      → failed, stuck until your friend cancelled and re-called. Two changes — ICE candidates
      that arrive before the offer they belong to are now held instead of discarded, and
      signalling messages are handled strictly in order per peer. **I could not reproduce your
      exact failure**, so this is the defect I found and proved, not a certainty that it was the
      one that bit you.
- [ ] If a call fails again: it should now rebuild itself once, about six seconds in — the row
      goes back to "connecting" with nobody hanging up. That is what your friend was doing by
      hand. Tell me if it still needs a human.
- [ ] 🆕 **Circuit invite over DM.** Circuit → Circuits → "✉️ Invite a friend" on a circuit you
      own → pick someone. They get a card in your DM saying "🏆 Join the circuit"; tapping it
      joins them and says so. Only accepted friends are listed — same rule as the Snake
      challenge, so this reaches nobody you couldn't already message.
- [ ] Open one of those links while **signed out**: it should say "Sign in and you'll join that
      circuit", then actually join once you do. Either way the code should disappear from the
      address bar.
- [ ] ⚠️ **Snake's "Challenge a friend" still works and still looks right.** Its popover styling
      moved out of `game.css` into `components/InviteFriends.css` so the Circuit could share it.
      If that panel looks unstyled, the move is why.
- [ ] **Sign in with canvas windows already open.** They should stop saying "sign in" the moment
      you do. ⚠️ The fix I am least able to check — driving a real sign-in needs a session I do
      not hold.
- [ ] Open the canvas **signed out**: Chat / Ratings / People / Profile / Account are no longer
      offered in the Windows menu. Investments still is — it has a real demo to show rather than
      a locked door. (Verified in the dev preview, both signed in and out.)
- [ ] **Number keys 1–5 no longer jump between sections.** Arrow Left/Right still do; the `?`
      help card should no longer mention numbers.
- [ ] **Contact form**: a failure now says what the form service said, in brackets. If it
      mentions a limit, that is Formspree's free monthly cap rather than a bug — which would
      also explain "some emails but maybe not all of them".
- [ ] **Snake settings carry into a room.** Set a game up in solo, then create a room: it should
      be born with those settings instead of snapping back to 30 / 4 apples at the countdown.
      ⚠️ Needs the Render redeploy to take effect.
- [ ] **Apples in race + crash.** Should be there now, and in classic + crash too.

## 8c. Third round - prices, profile, banner

- [ ] **Investments prices move again** (crypto only until the Finnhub key is in Vault). BTC,
      ETH, DOGE, XRP and ZORA are live as of 2026-08-21; the ~170 stock symbols still show their
      2026-08-16 prices, so any figure mixing the two is part fresh and part stale until the key
      lands. Put it in: Supabase dashboard -> Project Settings -> Vault -> New secret, named
      exactly `finnhub_api_key`. Nothing else to do; the next nightly run picks it up.
- [ ] **Profile page on a phone.** The identity header used to give the name about 60px while
      two buttons kept their full width; the action buttons now wrap onto their own line and
      share it. Check it reads right and that nothing looks stranded.
- [ ] **Nothing runs off the right edge any more.** The cards below the header were overflowing
      by ~14px and being clipped with no way to scroll to them - measured, then fixed. Worth a
      look on your actual phone, which is the size I cannot emulate honestly.
- [ ] **The banner has room now.** Taller on narrow screens (5:2, min 9rem) and 7:2 once there
      is width, and it fills its card rather than floating in it. Several of the looks - Rays,
      Rings, Ember - are built from shapes anchored below the box, which is why a short strip
      showed a sliver of something bigger. If any style still reads as cropped, say which one:
      they are eight separate recipes in `src/profile/look.ts` and can be tuned one at a time.

## 8d. Customize-your-page editor, on a phone

- [ ] **Profile -> Customize page, on your actual phone.** Each block's row header used to be one
      unwrapping line: the label beside five controls (up, down, size, who-can-see, remove) that
      measured 277-297px against a ~311px content box. The label always lost, so you were
      arranging blocks you could no longer tell apart. The controls now drop to their own line
      and the who-can-see dropdown takes the slack.
- [ ] **The mood emoji picker** (on a Status block) - 13 buttons that were 38x28. Now 40x40.
- [ ] **The banner colour slider** - was a 10px-tall track. Now ~26px of grab area with a bigger
      handle. Still under 40px, deliberately: the track IS the colour spectrum and a fat bar
      reads worse. Tell me if it's still fiddly and I'll go taller.
- [ ] **"+ Bio" / "+ Banner" etc and Save** were 34-36px, now 40.
- [ ] Desktop is unchanged - verified at 1280: label and controls still share one line, slider
      and emoji back to their smaller sizes.

## 8e. Profile + editor, second pass (the design one)

Measured on a 375px viewport, before -> after:

|                               | before               | after                 |
| ----------------------------- | -------------------- | --------------------- |
| Customize editor, 6 blocks    | 2011px (2.5 screens) | 680px (0.84)          |
| Per-block chrome              | 113px x 6 = 678px    | one 71-84px line each |
| "add a block" row             | 192px of 7 buttons   | 53px, one button      |
| A profile with nothing shared | 524px, 3 empty cards | 242px, one sentence   |

- [ ] **Customize page, on your phone.** Blocks are a collapsed LIST now - tap one to open it,
      one at a time. A collapsed row shows what it holds ("Aurora", the first words of your bio,
      your status), so the list is scannable instead of six identical toolbars.
- [ ] Reorder with the up/down arrows while blocks are collapsed - the open one should travel
      with its content, not stay open on whatever moved into its slot.
- [ ] "+ Add a block" opens the seven choices; picking one adds it AND opens it for editing.
- [ ] Inside an open block: **"Who can see this"** is now a named setting rather than a bare
      dropdown in the toolbar. **"Width" is hidden on a phone** - every size renders as one
      full-width column below 700px, so the control provably did nothing there.
- [ ] **A profile with nothing in common** (a new member, say) should read as one line:
      "Nothing in common yet - no circuits together, no ratings you can see, no Snake score."
      It used to be three headed cards each saying no.
- [ ] **A profile WITH things** should be unchanged: real cards for circuits, movies and Snake,
      the head-to-head line and the Beat button. Verified, but worth your eyes.
- [ ] Desktop unchanged - verified at 1280: compact rows, Width control present, one-line
      headers.

## 8f. The bio that wasn't saving

**It was saving.** Your bio is in the database and always was - "yaya?!", plus a status, a
banner on Rings/hue 220, stats, activity, guestbook and trophies. Seven blocks, positions 1-7,
all intact. What was broken is that the Save button sat at the very BOTTOM of a 2011px panel on
a phone, under seven "+ block" buttons. You typed at the top and never reached it.

So there is no Save button any more.

- [ ] **Type in a bio and just stop.** It saves itself about three quarters of a second later.
      The line where the button was says "Saving..." then "Saved" - and if it fails it says so
      in the service's own words rather than going quiet.
- [ ] **Type and immediately tap "Done editing"** (inside that three quarters of a second). It
      should still save, AND the page behind should show the new text rather than the old.
      That was the same bug waiting to be reintroduced, so it is worth actually trying.
- [ ] **Remove a block** - the one action that can lose something, so it is the one that keeps
      an explicit step: "Undo removing X" appears where the button used to be. Tapping it puts
      the block back where it was.
- [ ] Drag the banner colour slider around. One save, not two hundred - the debounce coalesces
      it. (Check the network tab if you care to.)
- [ ] Everything else - reorder, add, who-can-see - saves the same way, no button.

## 8g. Editing shows the page; sizes actually differ; activity says what you did

- [ ] **Customize page now shows your real blocks**, not a list of labels. Each row is the block
      exactly as a reader sees it - same component, same data - with the controls around it.
      Tap one to open its settings underneath.
- [ ] **The three widths were two.** `small` and `medium` were literally the same CSS rule
      (`span 1`), so two of the three choices did nothing. Now: one column / two columns / full
      width, and the button says that instead of "small". Check on desktop.
- [ ] **Blocks no longer inherit their neighbour's height.** Grid items stretch to the tallest
      in the row by default, so a one-line Status beside a Guestbook was rendered Guestbook-tall.
      Measured at 1280: blocks sharing a row are now 70px and 156px rather than both 156px.
- [ ] **The activity feed says what you did.** Was "Logged a workout in The Crew". Now
      "2.5 mi Miles walked - 40 pts - The Crew - 8/21/2026", resolved against your own exercise
      list and points.
- [ ] 🔒 **Check what a non-member sees.** You are set to public, so a signed-in stranger DOES
      see the workouts - that is what you asked for - but the circuit NAME comes back null for
      them. A group name involves people other than you, so it needs shared membership. Verified
      both directions with simulated sessions. Tell me if you want it stricter or looser.
- [ ] A person in two circuits used to appear TWICE per workout (once per group). Now once, with
      the shared circuit names joined.

## 8h. Contact form, and forgotten passwords

- [ ] **Send yourself a real message through the contact form.** It should say sent, and appear
      under **Admin -> Messages** whether or not the email arrives. That is the point: the
      message is stored here first now, and Formspree is only the ping.
- [ ] Check the email still turns up too. If it doesn't, the message is still in Admin - tell me
      and we can drop Formspree entirely or point the ping somewhere else.
- [ ] In Admin -> Messages, "Mark done" moves one to the Done list. Nothing is ever deleted.
- [ ] 🔒 **Forgot your password?** on the sign-in page. Put YOUR email in, press it, and follow
      the link - it should sign you in and land you on Account, where the change-password form
      already is. ⚠️ I did not test the actual send: firing a reset email is not something to do
      on someone's behalf without asking.
- [ ] Press it with the email box empty - it should ask you to fill it in rather than doing
      anything.
- [ ] 🔒 Note it says the SAME thing whether or not the address has an account. That is
      deliberate - otherwise the login box answers "is this person a member here?" for anyone
      who asks, and your members are your friends and family.

## 8i. Import from the site; activity defaults to private

- [ ] **Admin -> Import.** Pick your Cash App CSV. It should read the file and show you a summary
      WITHOUT writing anything - source, rows, kept, sells, skipped, net invested, date range.
      Compare it to the terminal output you already have; the numbers should be identical,
      because it is literally the same parser.
- [ ] Expand "Show a raw example of each skipped kind" and check nothing real is being thrown
      away. That is the cheapest catch there is.
- [ ] ⚠️ **If a ⚠️ collapsed block appears, read it before pressing Import.** Those are rows the
      parser refused to guess about - in a Robinhood file they can be a genuine second purchase,
      because their rows carry no transaction id and no time of day.
- [ ] Press **Import these N trades**. It should report "X new, Y already present" plus the
      even-split across your active accounts. Re-running the same file should then report
      everything as already present, not a second copy.
- [ ] Try a CSV that isn't a broker export - it should say so plainly rather than failing oddly.
- [ ] 🔒 No service-role key anywhere in this flow. Being signed in as admin is the credential,
      and the relay holds the key. Verified: the endpoint returns 403 to an unauthenticated
      request, on the live relay.
- [ ] 🔒 **activity_visibility now defaults to private** for anyone new. Your 7 existing members
      were deliberately NOT changed - a default governs someone who hasn't decided, and rewriting
      the people already here would take away sharing they may be relying on. If you'd rather
      move them too, say so and I will.

## 8j. Reconcile — checking it yourself

- [ ] **Admin -> Reconcile.** Should open on "All 7 checks clear". Those are the integrity tests
      I ran by hand on 2026-08-23, now standing: over-allocation, negative holdings, allocations
      predating their account, uneven splits, unpriced holdings, stale prices, and — added
      2026-08-24 — the family being credited with more of a position than you still hold.
- [ ] **Tick a few rows against Robinhood and Cash App.** Avg cost is what the family paid for
      what they still hold, so it should match your broker's average on a position that is
      entirely theirs. WEN is the one to start with: it should read $8.02.
- [ ] 🔒 **The real check is the last three columns**: theirs + yours = the whole position. If
      those add up, the split is right by construction. Verified in the database at
      $13,749.54 + $6,731.14 = $20,480.68, to the cent.
- [ ] Toggle "Show everything you hold" - the bottom row's last figure is then what your two
      brokers add up to between them. Worth checking against their home screens.
- [ ] A **red number in the "Yours" column** means more was allocated than you hold. That is
      always a bug, never a fact - tell me if one ever appears.
- [ ] ⚠️ **Small negatives in "Yours" are normal and are NOT red.** 23 positions sit a few
      ten-thousandths of a unit below zero from rounding — 56 cents across all of them, 13 cents
      at worst. Before 2026-08-24 the column flagged those, so opening this tab showed 23 red
      numbers for half a dollar. It now reds past a dollar per position, the same threshold
      check #7 uses, so the badge and the column always agree.
- [ ] What check #7 is really for: **selling out of something they part-own without splitting
      the sale.** You keep the money, they keep shares you no longer have, and all six of the
      other checks still pass — only the total gives it away.

## 8k. The review that stays put

- [ ] ⚠️ **Admin → Import now opens with a list of trades to sort** — 106 of them on the first
      visit, across 45 symbols, dated 2025-12-10 to 2026-08-20. They have always existed; there
      was simply no way to reach them. Until each is answered it counts as yours by default, so
      if any of them were meant for the family, the family's numbers are low by that much.
- [ ] The tab bar says **Import (106 to sort)** before you open it. That count and the list are
      computed from the same rule in the database, so if they ever disagree, tell me.
- [ ] ⚠️ **"Mine" is now a real answer.** It used to write nothing, which left the trade
      looking exactly like one you had never seen — so it would have come back at you every
      week forever. Tap "Mine" on one, reload the page, and it should be gone for good.
- [ ] "All theirs" and "Part…" behave as before. All three now stamp the trade as decided.
- [ ] Twelve at a time, with **"Show 12 more · N still to sort"** at the bottom. 106 rows at
      once is a wall rather than a list.
- [ ] **Only trades from 2025-12-10 onward are ever offered.** Anything older cannot be the
      family's — no account existed to allocate it to — and the database would refuse it. Your
      2021 Robinhood history is not a pile of questions.
- [ ] **Messages (2 unread)** on the tab bar, and **⚠️ Reconcile (n)** if a check ever fails.
      Reconcile has no number today because all six pass.
- [ ] 🔒 The badge only exists for you: a non-admin asking gets "admin only", signed-out gets
      "permission denied". Verified in the database, and the panel still loads with no badges
      when the call is refused.
- [ ] ⚠️ **The one thing I could not check myself**: how the review card actually looks with
      real rows in it, since it needs your admin session. The styling and mobile widths are
      verified (no sideways scroll at 375px), the content is not.

## 8l. The demo was lying, and so was the rollup

- [ ] ⚠️ **Open Investments signed out** (or in a private window). It should now read:
      "There's $803.85 in the fund for 4 people right now — those shares are +2.7% up on the
      $783.00 they cost. The money put in so far is $157.00 short of the dollar-a-day promise."
      **Before today it said "gain +$803.85" and "behind the promise −$940.00"** — a gain equal
      to the whole portfolio and a shortfall equal to the whole promise, sitting above its own
      chart which said $783 in and $940 promised.
- [ ] Check the three tiles against the chart yourself: 803.85 − 783.00 = 20.85, 940 − 783 = 157,
      157 ÷ 4 = 39 days. Every number on that screen should reconcile with every other one.
- [ ] Expand the four demo people: −$24, −$85, −$53, +$5. Those add to −$157.
- [ ] 🔒 **The real fix is behind the demo.** `portfolioTotals` was adding `contributed ?? 0`,
      so an account whose contribution isn't known counted as having had nothing put in. Any
      real account in that state would have dragged the family total to "behind by everything".
      It now refuses to answer instead, and the page says "Still being set up".
- [ ] ⚠️ If you ever see **"Still being set up"** on your own signed-in view, that is this new
      refusal firing — it means one of your accounts has no contribution figure, not that
      something is broken. Tell me and I will find which one.
- [ ] The wording changed: it says "in the fund" for what it's worth and "the money put in" for
      what you contributed. Those are different numbers and the old sentence used one word for
      both.

## 8m. The contact form

- [ ] **Send yourself a test message.** It should arrive as before, and appear in Admin ->
      Messages.
- [ ] Send **four in a row from the same address**. The fourth should be refused with "your
      earlier messages did arrive — this address has sent three within the hour". That wording
      matters: the first three DID reach you.
- [ ] ⚠️ **Then send one from a different address — it must still work.** That is the whole
      point of the change. The old limit was 20 an hour counted across _everybody_, so one
      spammer could silence the form for every real visitor for an hour, and this is the only
      public way to reach you.
- [ ] The refusal appears in brackets inside "That didn't send — nothing has been lost, your
      message is still in the form."

## 8n. The chart and the sentence above it

- [ ] ⚠️ **This one only shows up after you sell something for the family.** The chart's "Worth"
      line includes cash from sales; the sentence above it counts only the shares, on purpose
      ("never overstate what somebody has"). Both are deliberate — but both were called "Worth",
      so the day you sell, the chart sits above the card with nothing explaining the gap. Sell 4
      of 10 shares at cost and the chart would say $120 where the card says $60.
- [ ] **Hover the chart after any sale**: under "Worth $X" there should now be a quieter line
      reading "$Y in shares + $Z cash". Those two add to $X, and $Y is what the card above says.
- [ ] With no cash (which is today — family cash is $0.00) that breakdown line should NOT
      appear. Verified on the demo.
- [ ] The legend hint for the green line now says "…plus cash from any sales". It used to claim
      the line was holdings only, which stopped being true a while ago.

## 8o. Cash, on the card a family member actually reads

- [ ] ⚠️ **The one that mattered most.** "Worth today" on a person's own card is the SHARES
      only — cash from sales is deliberately left out so the headline never overstates what
      somebody has. The fund-level card did explain the cash… and **a family member never sees
      the fund-level card**: it only renders for someone with more than one account, and they
      have exactly one. So when you sold something of theirs, their number dropped by the whole
      position and nothing anywhere told them where the money went.
- [ ] After any sale, their card should now read **"Plus $X in cash from sales — still yours,
      waiting to be invested."** directly under the big number. Verified rendering at 375px and
      1280px with a temporary $42.50 (reverted).
- [ ] The ⓘ panel now says ahead/behind compares **what has been put in**, not the value, and
      explains why cash sits outside "worth today". The old wording said "compares it", where
      "it" was the value — the exact thing you said ahead/behind must never be about.
- [ ] With no cash the line does not appear at all.

## 9. Still waiting on a decision

See `docs/OPEN-DECISIONS.md` — person colours in light theme, the LCID designation, and the
`activity_visibility` default for the seven existing members.

✅ **The price feed is healthy again** — 178 of 180 symbols refreshed within the last two days,
most recently 2026-08-23 21:16 UTC. It had been stale since 2026-08-16; the Vault key and the
move into Postgres fixed it. Check #6 on the Reconcile tab is what will tell you if it stops.
