# A volume for every part of the song

Evan, 21 Nov 2026: "Easy volume for every part of a song (each vocal or voice clip, the lyrics
track, and each instrument part), shown on that timeline. It should be saved with the song."

## What was missing

- **Instrument parts** had a fader already: on the row on a desktop, in 🎚 Mix and in the part's ⋯.
- **A recording** had a mute and nothing else. Its placement carried a `gain` the scheduler read,
  but nothing set it, a reload dropped it, and Mix said "as recorded".
- **The words** had no level at all. Every part's words were sung through one shared bus at a fixed
  0.9.

## What happens now

- **Every row of the timeline has a fader**: each part, the words, and each recording. All are the
  same 0–200% travel a part's fader always had, and 🎚 Mix lists the same ones, writing the same
  values.
- **On a phone, 🎚 Volume swaps every row's bars for its fader**, in the same place, and back. A
  phone row is a name, about three bars and two buttons; a fader beside those would leave the bars a
  sliver. A desktop row has room for both and shows both, so the button is not there.
- **A recording's volume is heard at once.** It is a node in front of the take's own sound chain
  that lives as long as the take is on the song, ramped where it stands. Before, a take's gain was
  read when each pass was scheduled, so it could only ever change from the next time round.
- **The words' volume is heard at once too.** Each part's words now have a bus of their own, so two
  singing parts can be set apart, and the fader ramps it while the song is being sung. A level
  changed any other way (an undo, a jam partner) reaches the singing within the sing-along's own
  tick, rather than at the next lap.

## Where it is kept

- **The words' level is on the part, beside its words** (`Layer.wordsGain`), so the room's undo, the
  bench a reload puts back, a kept song and the jam all carry it, as they carry the words. In the
  song format it is `wordsGain` in the long form and `wv` (hundredths, like a part's `v`) in the
  compact one, and absent at 100%. Both are additive: an older bundle reading a newer song ignores
  it. It moves with the words when they're moved to another part.
- **A recording's volume is on its placement**, beside its place, mute, sound and chop, so the bench
  a reload puts back has it. Kept songs don't carry recordings at all (they hold the note parts; the
  audio lives in this browser), so they don't carry a recording's volume either. That's unchanged.
- **Taking a recording off the song and putting it back** brings it back as loud as it was. The
  volume is also kept on the recording itself, like its place and its sound. It's written once the
  fader stops, not as it moves, because each write rewrites the stored recording; settled before
  the take is put back or the page goes away; and in one write with its place.
- **On a reload the bench decides**, 100% included, because that is the level the take was last
  left at. A new placement starts at whatever its recording last kept, which can be older: a fader
  moved back to 100% just before the page went away. Only a level that differs is set, so a reload
  does not rewrite every recording it puts back.

## Checked

- `partVolume.test.ts`, the looper itself with the audio graph stood in for:
  - a take's volume is ramped on the node that stays, and kept between 0 and 2;
  - setting one on a take that isn't on the song changes nothing;
  - the words' level moves with the words, and the part they leave keeps none;
  - a reload puts a take back as loud as it was left.
- **The round trips were fed values off their defaults.** The song format's "every field" fixture
  has words at 45%; the bench fixture has words at 160% and a take at 55%.
- **Eleven perturbations, each went red:** each field dropped from each writer and reader (`toSong`,
  the long reader, `packSong`, the compact reader, `songToLayers`, `packWork`, `readTakes`, the
  reload wiring), the level left behind by a move, the node not turned, and the clamp removed.
- **In Chrome, measured at the takes' bus:** a take's constant tone read 0.2146, and turned to 25%
  in the same pass it read 0.0537, a ratio of 0.250. A stretch with no take read 0.
- **The words, at the synth's pre-limiter peak** with every other part muted: 0.554 at 100% and
  0.145 at 25% (two laps, ratio 0.262). At 0 only the metronome's 0.018 was left.
- **Saved and put back.** Set through its real slider to 70%, the words were written as `wv: 70`. A
  take at 60% was written as `gain: 0.6`. After a reload both rows' faders read 0.7 and 0.6.
- **Phone, 375, touch:** 🎚 Volume put a 105×36 fader in every row's place, with the ruler hidden but
  undo and redo where they were. mobile-audit over the song found nothing in 27 controls. Switched
  back, the bars came back at their size with each recording over its place.

## After review

An independent review before release found four things here, all fixed and checked:

- **The take fader's ramp started at the audio clock's current time**, which is behind the render
  head, so each move landed half its distance in one sample. It starts `SAFE_START` ahead now, the
  house rule in synth.ts. The test's stand-in records when a ramp begins, and stamping it at the
  clock turns it red.
- **A take came back at full volume after being taken off and put back.** The volume is now kept
  on the recording (above). Lifted and put back in the test it returns at 0.3; never written, or
  written on every move, or ignored on the way back, each turns it red.
- **The phone Volume view could leave the bars and the ruler out of step**, because hiding the bars
  drops their scroll. Scrolled 22px, switched to Volume and back at 375, every strip and the ruler
  read 22 again, with bar 2 and its ruler mark on the same pixel.
- **A words level changed by an undo or the jam was only heard from the next lap.** Changed at 30%
  into a lap without the fader, the rest of that lap peaked at 0.26 of the lap before, against
  0.94 before the change.

### And after the verification pass

A skeptic per fix found the reload half of the kept volume wrong: the bench writes 100% as no gain
at all, the restore only set a gain it was given, and a new placement now starts at the
recording's kept level. So a take turned down once, then put back to 100% just before the page
went away, came back at the old level and wrote it into the bench. The bench now decides,
including 100%. A test turns a take down on its recording, leaves it at 100% on the bench, and
reloads; skipping the 100% case turns it red. The owed writes (place and volume) became one queue
in looper.ts, settled before a take is put back and on pagehide, with four perturbations each
turning the tests red.
