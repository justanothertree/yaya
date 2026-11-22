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
  singing parts can be set apart, and the fader ramps it while the song is being sung.

## Where it is kept

- **The words' level is on the part, beside its words** (`Layer.wordsGain`), so the room's undo, the
  bench a reload puts back, a kept song and the jam all carry it, as they carry the words. In the
  song format it is `wordsGain` in the long form and `wv` (hundredths, like a part's `v`) in the
  compact one, and absent at 100%. Both are additive: an older bundle reading a newer song ignores
  it. It moves with the words when they're moved to another part.
- **A recording's volume is on its placement**, beside its place, mute, sound and chop, so the bench
  a reload puts back has it. Kept songs don't carry recordings at all (they hold the note parts; the
  audio lives in this browser), so they don't carry a recording's volume either. That's unchanged.
- **Taking a recording off the song and putting it back** returns it at full volume. Its place and
  its sound are kept on the recording itself and come back; its volume is part of how it sits in
  this song.

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
