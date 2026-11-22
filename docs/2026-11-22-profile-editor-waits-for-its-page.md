# The profile editor waits for its page

Found 22 Nov 2026 while designing "Put it on my profile" (see the plan's step 0). It is on main,
live, and has nothing to do with that feature, so it ships on its own.

## What could delete a page

1. Your own page opens straight into the editor (`opensInEdit`), and it does so when the profile
   request (`get_member_profile`) answers.
2. The blocks are a separate request (`get_profile_blocks`), and `blocks` starts as `[]`.
3. `ProfileBlocksEditor` copies `initial` into its own state once, at mount
   (`useState(initial)`), and nothing re-mounts it when the blocks arrive.
4. On an empty page the starters panel opens by itself.
5. `save_my_profile_blocks` deletes every block and inserts what it is sent.

So whenever the profile answered before the blocks, the editor opened on an empty page, and the
first starter picked or block added saved a page holding only that. Every other block was gone. A
blocks read that failed did the same, permanently, since `blocks` stayed `[]`.

## What happens now

- The editor mounts only from a good read of the page being shown (`seededFor === u`).
- Until then it shows "Opening your page…".
- If the read fails it shows "Your page didn't open." with Try again, which reads the blocks once
  more without clearing the rest of the page.
- A read that is not the owner's never seeds the editor. `get_profile_blocks` gives the owner an
  array in `certain` on every block and everybody else `null`, so a `null` means a visitor's view
  (a name that changed hands between the two requests). Saving from it would have put somebody
  else's blocks on your page. That case shows "Your page isn't under this name any more. Reload
  the site to open it."
- An empty page is accepted on the profile's word that it is yours (`is_me`, from the same
  navigation): `[]` carries no `certain` to prove whose it is.

The rule is pure, in `src/profile/seedGate.ts`.

## Checked

- `seedGate.test.ts`, 6 tests, built on what the server really answers. Three perturbations each
  turned them red: an error beside an array accepted, a `null` list read as empty, and a good read
  of one page opening another.
- **In the pane, `#profile?u=preview`, with the preview's blocks read slowed to 1.5s.** The preview
  used to answer at once, which could never show this bug, so it now answers later like the real
  read, and slow or failing on request: `localStorage` `dev_profile_blocks` = `slow` | `fail`.
  - **With main's behaviour put back from a copy:** the editor opened on an empty page with the
    starters showing, and three seconds later, long after the read had answered, it was still
    empty.
  - **With the gate:** Edit pressed at 152ms showed "Opening your page…" until the read arrived
    at about 1.5s, then the editor opened on the real blocks. No starters at any point.
  - **With the read failing:** "Your page didn't open. Try again". Try again, with the read
    working, opened the editor on the real blocks.
  - **At 375:** Try again is 93×36 and mobile-audit found nothing.
- **The knob does not ship.** A production build contains neither of its strings; the door's copy
  is there.

## Not here

The rest of the profile save model — overlapping saves, a save from another tab or device, the
Instrument's "Put it on my profile" — is the larger plan this was found in. It has not been built.
