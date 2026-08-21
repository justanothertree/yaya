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
- [ ] ⚠️ **Canvas edge case I fixed but could only test synthetically**: start dragging a window
      and, _without releasing the mouse_, toggle Canvas off in the cog menu. Nothing should break
      or feel stuck afterwards.

## 4. Chat and calls

- [ ] Open a conversation. Messages load.
- [ ] 🔒 **Click someone's name on a message** → their profile opens.
- [ ] 🔒 **In The Lounge, names must NOT be clickable** — that is the pseudonym. If a Lounge name
      links anywhere, tell me immediately.
- [ ] Send a message. It appears, and your own message renders as yours (right-aligned), not as
      someone else's.
- [ ] Unread badges still count correctly, including for the Lounge.
- [ ] 🔔 **Call sound**: cog menu → toggle "Call sound" on. It should play a ring when you switch
      it on. Then have someone start a call and check you hear it. ⚠️ I tuned this blind — I can
      only confirm it produces clean audio, not that it sounds good. Frequencies are four numbers
      at the bottom of `src/voice/ringtone.ts`.
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

## 9. Still waiting on a decision

See `docs/OPEN-DECISIONS.md` — the price feed key, person colours in light theme, and the
`activity_visibility` default.

⚠️ **The price feed is the one with a running cost**: prices have been stale since 2026-08-16 and
drift further every day, so every investments figure is priced from an old cache.
