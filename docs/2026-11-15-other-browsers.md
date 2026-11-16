# The part menu and the lyrics box in Firefox and Safari's engine — 15 Nov 2026

Evan: "Check the part menu and lyrics box in Firefox and Safari (or WebKit via Playwright) at 375 and
1440, and fix what breaks."

## How it was checked

Playwright, installed in a scratch folder outside the repository (no dependency added here), drove
the room on the dev server through the same steps in each engine at 375×812 (touch) and 1440×900:

- open the part menu from a part's name, and see the piano roll;
- the Notes, Sound and More tabs, with the layout measured on each;
- move the part's volume from the keyboard;
- Escape closes the menu, and focus goes back to the part;
- open the lyrics box from its row, type words into a bar, and see them fitted under it;
- the hint for a line with too many syllables, with its two buttons;
- ▶ Sing the song, then ■.

**Engines:**

- **Firefox 159.0.1**, the copy installed on this machine, driven over WebDriver BiDi. Playwright's
  own Firefox build would not start here ("spawn UNKNOWN").
- **WebKit 27.2**, Playwright's build. It is Safari's engine, not Safari.

## What broke, and the fixes

1. **The whole site was blank in WebKit.** The noise suppressor used in calls declares
   `class … extends AudioWorkletNode` at the top of its module. `voiceSession` imported it with the
   page, and App.tsx imports `voiceSession`. So in a browser with no AudioWorklet, the import threw
   and nothing rendered: `<main>` was empty, with "Can't find variable: AudioWorkletNode" from that
   package. Playwright's WebKit has no AudioWorkletNode. Real Safari has had it since 14.5, but an
   older Safari or an insecure page would fail the same way.
   - **Fix:** the library is imported when a call reaches for the denoiser. The catch around it
     already promised that a call works without it. In the build it is now a chunk of its own
     (`extends AudioWorkletNode` appears 0 times in the entry bundle).
   - `src/voice/loadsWithoutWorklet.test.ts` imports `voiceSession` in node, which has no
     AudioWorkletNode either. With the old static import put back, it fails with "AudioWorkletNode
     is not defined".
2. **Firefox reported an error on every visit to the room:** `registerProcessor … a class with the
same name is already registered`. `startHealth` said it was safe to call twice, but that held
   only one call after the other: a second call made while the first was still loading the worklet
   loaded it again.
   - **Fix:** a second caller now waits on the first.
   - `src/audio/audioHealth.test.ts` starts it twice at once against a fake context and counts one
     load. Without the fix it counts two. On the second Firefox run, the error is gone.
   - In Chrome, both starts return true and the reading is clean.
3. **In WebKit, closing the part menu gave focus to the room, not the part.** Safari does not focus
   a button you click, and neither does Firefox on a Mac. The menu and the lyrics box hand focus back
   to whatever had it when they opened, and in Chrome that is the button.
   - **Fix:** the parts list's buttons that open a panel take focus as they are pressed.
   - In WebKit, Escape now leaves focus on the part's name, as in Chrome and Firefox.

## Results after the fixes

| Step                                    | Firefox 375 | Firefox 1440 | WebKit 375   | WebKit 1440  |
| --------------------------------------- | ----------- | ------------ | ------------ | ------------ |
| Part menu opens, roll shown             | ✓ (sheet)   | ✓ (panel)    | ✓ (sheet)    | ✓ (panel)    |
| Notes, Sound, More tabs                 | ✓           | ✓            | ✓            | ✓            |
| Nothing wider than the menu or the page | ✓           | ✓            | ✓            | ✓            |
| Volume from the keyboard                | ✓           | ✓            | ✓            | ✓            |
| Escape closes, focus back on the part   | ✓           | ✓            | ✓ (fixed)    | ✓ (fixed)    |
| Lyrics: type, fitted, Enter moves on    | ✓           | ✓            | ✓            | ✓            |
| Too-many hint and its buttons           | ✓           | ✓            | ✓            | ✓            |
| ▶ Sing the song and ■                  | ✓           | ✓            | no Web Audio | no Web Audio |

On a phone the piano roll is wider than the sheet in both engines. That is its own sideways scroll
(`.roll-scroll`, `overflow-x: auto`), and it scrolls in both.

## Not checked

- **Real Safari** on a Mac, iPhone or iPad. This machine is Windows, and Playwright's WebKit is
  Safari's engine without Safari's media stack: it has no AudioContext at all. So nothing about how
  the voice or the instrument sounds in Safari was checked, only the layout and the controls.
- WebKit on Windows draws button text in a serif face, because the system font a button asks for
  maps to Times there. Safari has its own system font, so this was not treated as a fault.
- Firefox on a phone. The 375 run is desktop Firefox at a phone's size, with touch on.
