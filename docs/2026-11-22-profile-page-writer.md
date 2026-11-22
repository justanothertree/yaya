# One writer for a profile page, and 🎵 Put it on my profile

Evan, 21 Nov 2026: "yes to a 'Put it on my profile' button (notes only, nothing new on the
server)". The first version, parked on `instrument/profile-door`, read the page and saved it on its
own. An adversarial review confirmed twelve ways that, or the editor beside it, could lose a song or
a whole page. This is the redesign that review led to: a design workflow mapped the code and the
live SQL, had three designs drawn from different angles, and judged them against every finding.

## The server contracts this rests on

Read from the live definitions with SELECT-only queries on 21 Nov 2026, and pinned by the faithful
double in `src/dev/profileServerDouble.ts`. If any of them changes, the writer is wrong in the
dangerous direction.

1. **`get_profile_blocks` proves whose read it is.**
   - The owner gets an array in `certain` on every block (`[]` when it has no names).
   - Everybody else gets `null` there.
   - A name nobody has gets `[]` with no error, so an empty read is proved by `get_member_profile`,
     asked after it.
2. **`save_my_profile_blocks` replaces the caller's whole page.**
   - It deletes the page and inserts what it is sent, at positions 1..n.
   - It clamps each tier to the member's ceiling.
   - It keeps at most 50 Certain names per block: trimmed, lower-cased, distinct, accepted friends
     only.
   - It returns `[{position, visibility}]`, read after the insert.
   - It takes **no lock and no expected state**, so two overlapping saves can double the page.
3. **Type, size and config are stored as sent.**

## The design (`src/profile/pageWriter.ts`)

One writer per member per tab. The editor's autosave, its save on the way out, and 🎵 Put it on my
profile all go through it. Every job keeps these rules:

- **One job at a time per member.** Jobs run in order, inside a Web Lock where the browser has one,
  so two tabs take turns too.
- **Each job is pinned to the session it started with.**
  - A different account, or none, writes nothing.
  - Every request in the job carries that session's token (`setHeader`).
- **`known` is only ever what the server said.** It is either an owner-proven read, or what a save's
  own answer proves was stored (`pageStore.expectStored`). It is never the copy that was sent.
- **A copy saves only if it descends from `known` and a fresh, owner-proven read still matches.**
  "Descends" means its lineage's version matches. Otherwise the copy is refused, kept, and said.
  Nothing is ever merged.
- **A save whose answer never came** is remembered and decided by the next read. It is neither
  re-sent blindly nor taken for somebody else's change.
- **An editor that leaves with a change that cannot save** hands it to the page (an orphan, with
  Open them again / Let them go). The change is not dropped with the editor.

The status line is derived from the writer, never set:

- Saving…, Saved ✓;
- "Couldn't reach your page to check it. Trying again.";
- a conflict banner with **Reload it**, which says whether anything of yours is unsaved.

### 🎵 Put it on my profile (`src/profile/putOnProfile.ts`)

- **With your page open in an editor in this tab** (a canvas window), the song goes into that
  editor's copy as it stands, unsaved edits included. It is one undoable step, sent at once. Two
  copies are never in play.
- **Otherwise** it is one queued job: read the page, add the song to what is there now, save.
- Your account is taken **when the button is pressed**, before the name is asked. An answer given
  after a switch writes nothing.
- A song of the same name is replaced only after a yes to replacing that song. If the page changed
  while you answered, you are asked again.

### Also in this change

- **Ctrl+Z is scoped to the editor.** It answers only when the key comes from inside the editor,
  or from the page body just after a click inside it. It used to take Paint's, the Circuit's and the
  Instrument's.
- **The read view follows the writer's events**, so a song put on from the Instrument shows without
  a reload.
- **The editor seeds from `writer.load`**, not from the blocks read the seed gate (#446) used. That
  load waits behind any save still in flight, so Done then Edit opens on what that save wrote.

## The twelve findings, and how each is closed

| #   | Finding                                                                  | Now                                                                                    |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1   | A handle rename led to an empty editor whose save wiped the page         | Every seed and every check is owner-proven; an empty read needs `is_me` asked after it |
| 2   | A Put and an autosave held back by the name prompt both passed           | Routed into the open editor as one copy; the job reads the newest draft when it starts |
| 3   | The editor's own save in flight read as "changed elsewhere"              | One queue; the lineage is checked when the job starts, not when the copy was staged    |
| 4   | A refused exit save was dropped silently                                 | Orphan, offered back on the page                                                       |
| 5   | Edit pressed while the exit save was in flight opened an older page      | `load` is queued behind it                                                             |
| 6   | The sent copy was used as the base                                       | `expectStored` from the save's own answer                                              |
| 7   | A failed check read failed open                                          | Fails closed, keeps the copy, retries                                                  |
| 8   | Ctrl+Z anywhere undid and saved the profile                              | Scoped to the editor                                                                   |
| 9   | The exit save was checked against a stale base                           | Same as 3                                                                              |
| 10  | Overlapping autosaves gave false "changed" or false "Saved"              | Same as 3; status derived                                                              |
| 11  | An account switch during Replace? wrote one member's page over another's | Session pinned per job; account taken at the press                                     |
| 12  | "Open it" showed a stale page                                            | The read view follows the writer's events, and the link uses the proven name           |

## The second review, of the writer itself

A review of this design's first build found more ways to lose or misreport a change. Each item in
the first list has a test in `pageWriter.test.ts` under "what the review of the first version found", made red once
by putting the old line back.

- **Undo during a save.** An Undo back to the saved copy while a save was in flight was dropped as
  "nothing to send", so the save landed and the Undo never did. It is compared against the saved
  copy only once nothing of this editor's is in flight.
- **Undo after a lost answer.** It is sent once the next read says what the lost save did.
- **A Put answered by the wrong save.** A Put into an open editor was told "Saved" by an older save
  still in flight. Each waiter now waits for the save that took its own copy.
- **A refused copy on the way out** (the server saying no, not the page changing) was dropped with
  the editor. It is offered back like any other.
- **A job with nothing to do** wiped the "Saved ✓" the last one had earned.
- **No session for a moment** (a token refresh failing offline) read as somebody else signed in,
  which is final. It is a check that could not be made, and is tried again.
- **A job that threw** left the copy on "Saving…" for good. A throw is now a failed check: kept,
  retried.
- **Reload it during a save** must let the copy go with nothing offered back. It also must not be
  sent when a failed check is tried again.
- **A conflict after a refused save** said "Nothing of yours is unsaved". `unsaved` now counts what
  was typed but never landed, not only what is queued.
- **An editor whose copy cannot be sent** (over the size limit) was still handed a 🎵 Put, which
  went nowhere. It is skipped, and the Put reads and saves the page itself.
- **A handle renamed in this tab** is followed once the new name is opened.
- **Open them again** opens the lost copy as a _recovered_ editor. It starts refused and unsaved, so
  its banner says so, and leaving offers it back again. Under React's development double mount, the
  first mount's release offered the copy back beside the editor holding it. Now a recovered copy
  opened again takes the identical, unchanged one over. A changed one is still offered.

And on the page:

- **Ctrl+Z works in the block settings panel.** That panel is portaled out of the editor's box, and
  Undo right after Remove this block is when it matters most. Everything that is one editor carries
  its own `data-profile-editor` id, so two open editors each answer only their own keys.
- **The "didn't save" line is collected, not only heard.** Leaving for another room unmounts the
  page and the editor together, so the exit save's answer reached no listener. The writer keeps it
  until you decide. A different account never sees the last one's. The line is `role="alert"`.
- **No session at all** gives the door "Your session couldn't be read" with **Try again**, rather
  than an editor that can never save.
- **A message the editor could not send** (too big, too many songs) still shows under a conflict
  banner, as "Also: …".
- `AbortSignal.timeout` is used only where it exists (Safari 16+, Firefox 100+).
- A disabled 🎵 Put it on my profile says why: "Play or draw some notes first."

## Checked

**Tests.** All expectations are written from what the double ends up holding and which calls were
made.

- `pageStore.test.ts` (11) uses a fixture off its defaults in every field. Ten of eleven
  perturbations turned it red. The eleventh is covered twice over: a repeated position always leaves
  another position empty, and that is caught too.
- `pageWriter.test.ts` (37). Thirteen perturbations of the first build's rules each turned it red.
  One first stayed green, which is how the "second editor opening on a newer page" test came to
  exist.
  - Twelve more perturbations cover the second review's fixes, and all turn it red.
  - One, letting a discarded copy be put back, first stayed green. Every caller of `discard` today
    has a conflict set, which stops any send on its own. The test that now pins it is a failed
    check followed by a retry, which would have sent the copy that was let go.
- `putOnProfile.test.ts` (9): both roads, the replace question, and an account switch.
- `seedGate.test.ts`: what is left of the gate.

**In the pane (preview member, the writer running on the double):**

- **Editing.** A new block went Saving… then Saved ✓. Done showed it, and Edit reopened on all
  seven blocks.
- **Ctrl+Z.** After a click outside the editor it changed nothing. After a click inside it undid,
  and the undo saved.
- **🎵 Put it on my profile in the Instrument room.** The song block went onto the end of the page
  with every block kept, and the line said so with an Open it link.
- **A Put with the editor open.** The editor's banner appeared at once, saying "Nothing of yours is
  unsaved", with Reload it. At 375 the bar fitted and mobile-audit found nothing. Reload it reopened
  the editor on the page with the song.
- **Ctrl+Z in the settings panel.** Serif, then Ctrl+Z from inside the panel, put the font back to
  the page's, and the undo saved.
- **A change lost on the way out.** A Put from elsewhere, a font change in the now-old copy, then
  leaving for the Instrument and coming back showed "Your last changes didn't save: your page changed
  in another window first", with Open them again and Let them go.
  - **Open them again** opened the copy with the conflict banner. The line went away and stayed away
    (checked at 50ms, 300ms, 800ms and 1.5s), and the writer held nothing.
  - **✓ Done editing**, untouched, offered it back with the Serif change in it.
  - **Let them go** and **Reload it** each left no line and nothing held.

**Bundle.** The double does not ship: a string only it holds (`no function `) is in no built chunk.
The writer is not in the entry chunk either. The registry `App` needs is its own module, and
`unsendable` appears only in `pageWriterLive-*.js`. `preview-me` is in the entry, but it was already
there through `App.tsx` on main (see CLAUDE.md on code splitting); this adds nothing to it.

## Left out, and why

- **A compare-and-swap in `save_my_profile_blocks`** is the only thing that closes the last gap:
  another device saving in the moment between a job's check and its save. Its change is then
  deleted with no message. That is a server change, which this was asked not to make.
  - In prose: the function would take an optional expected fingerprint of the page, lock the
    member's `profiles` row, compare, and refuse with "page changed".
  - **Evan's call.**
- **The chronicle's sharing switch** also writes this table, and a review found it could be saved
  over. It is Chronicle's code, which another thread owns, so it is not routed through the writer
  here.
  - The editor's check catches it: an open editor's next save sees the card and refuses, with the
    banner. A test pins that.
  - Routing it through the writer (`writerFor(uid)` around its `rpc`) would close the remaining
    moment. That's a few lines for that thread.
- **Merging** a refused copy into the page as it is now. A bug in a check refuses; a bug in a merge
  writes a wrong page silently.
- **Tabs still running a bundle from before this ships** save without any check until reloaded.

## Still at risk

- Another device saving in the moment between a check and a save. Only the compare-and-swap above
  closes it.
- Overlapping saves from two devices can double the page. This is detected and said ("saved from two
  places at once"), not prevented.
- A refused change is kept and said, not merged, so Reload drops the typing. The screen says so
  first, and an orphan can be reopened to copy from.
- An edit made in the last 0.7s before the tab closes. This was already true.
- Without Web Locks (Safari before 15.4, Firefox before 96), saves are ordered only within a tab.
- What only a real account can exercise:
  - two real tabs;
  - a phone and a laptop together;
  - a real rename;
  - an account switch during Replace?;
  - a member with a tier ceiling;
  - Firefox and Safari.
