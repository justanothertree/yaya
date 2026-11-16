# The sung song, listened to — 15 Nov 2026

Evan asked for a sound pass on the song as the lyrics box sings it, all three voices: syllables
cut off at bar ends, words rushing when a bar has too many, awkward gaps. Still pure Web Audio.

## How it was heard

The pane plays no sound I can hear, so the song was **rendered**: the real `fitSongLyrics` and
`singInto`, into an `OfflineAudioContext`, written out as a WAV and read back sample by sample.
For every syllable the reading asks the audio (not the plan) when the voice comes in, how much of
its slot it fills, where it falls silent, and how fast it lets go. Two laps were rendered back to
back the way `singAlong` schedules them, so the loop's end was heard as well.

Four songs, each in Clean, Breathy and Glitchy (the three agreed within a few milliseconds):

- **built:** 96 bpm, 4 bars. A melody played loose, with a bar of eight short eighths and too
  many words for it.
- **tiled:** 110 bpm. A two-bar keys part played short (each quarter held 60% of its beat),
  repeated under four lines.
- **fast:** 128 bpm. Sixteenths and consonant clusters ("strong streets stretch…").
- **ending:** "you are my star" on short quarters, a bar with no words, and two laps.

## What was wrong, and what it is now

| What the WAV showed (Clean)                    | Before                      | After                  |
| ---------------------------------------------- | --------------------------- | ---------------------- |
| Silence between words inside a line (tiled)    | 85–200ms between most       | 0–5ms                  |
| How much of its slot each word fills (tiled)   | 37–59%                      | 79–100%                |
| Ten syllables on eight eighths (built, bar 3)  | 8 sung, "me home" dropped   | all 10 sung            |
| The last word before a wordless bar ("star")   | 313ms, then nothing         | a full beat, 625ms     |
| A phrase's last vowel falling from −6 to −30dB | 22–26ms, ending on the note | 56–58ms, just after it |

1. **Awkward gaps: the voice stopped with every key.** Most parts here are played short, and the
   voice sang each word only as long as its key was held. Now `legato` (pocket.ts) holds each
   sung note to the next one unless a real rest comes between them (a beat or more, the same
   line `place` draws a breath at). **Where** a word lands is still asked of the notes as played:
   held lengths made the Funk slap bass sing "dark" off the downbeat, and its test caught it.
2. **Words cut off at the end of a line.** The last word before a rest stopped with its short
   note. `ringOut` holds it to the end of its beat, never into the next note and never past the
   loop's end. In the singer, the last vowel of a phrase now fades 80ms past its note (`TAIL`)
   instead of reaching silence exactly on it.
3. **Too many words were dropped rather than sung.** `makeRoom` only ever shares a note a beat or
   longer, so ten syllables on eight eighths lost the last two. `crowd` now shares shorter notes
   too, two syllables at most and never under a sixteenth or 120ms, and lets the words choose
   which: the light ones ("and the", the "-y" of city) take the second halves. Past that, the
   words are still counted as not fitting rather than rushed.

**Fast** needed nothing: seven syllables over sixteen sixteenths land on eighths, and the
clusters compress to about 53ms without eating the vowels.

## Checked

- Each new rule has a test written from the song's shape, and each was broken once to watch it
  fail: legato, ringOut, crowd, crowd blind to the words, the 120ms floor, placing on the played
  lengths, and the tail.
- The renders above are before and after the same code change, on the same seeds.
- In the room on the dev server: the lyrics box says what each bar sings, and ▶ Sing the song
  starts and stops.

## Not checked

The renders were read as numbers, not heard by a person. Firefox and Safari's Web Audio come up
separately, in the browser check.
