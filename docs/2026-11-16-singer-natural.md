# The singer, more like a voice: glides, vibrato, word starts

Evan, 16 Nov 2026: make the singing more natural and "vibey", judged against rendered WAVs:
smoother pitch glides between notes, gentle vibrato only on held notes, and clearer consonants at
word starts, keeping the pocket rules and their tests green.

## How it was measured

The lyrics box's own path (`fitSongLyrics` → `singInto`, the late vibrato and the light room) was
rendered offline in the pane and read back in node, from the samples. The test line is "Pull me
close now / dance a-way with me / sing it out loud / home" at 92 bpm: plosive, nasal, hiss and
vowel word starts, steps and leaps of up to a fifth, short notes and a 2.6s hold.

The analyser was checked on a synthetic tone first: a 20-cent, 5.5 Hz vibrato read as 18 cents at
5.5 Hz, a 100ms glide (80ms from 10% to 90%) read as 85ms, and a plain note read 0.

## What changed, and what the audio says

**Glides are an S, not a ramp** (clean and breathy; Glitchy keeps its hard-tune snap, which a test
pins). One exponential ramp is a straight line in cents: it starts at full speed and stops dead.
A raised cosine leaves slowly and settles slowly. A leap wider than a tone starts up to a third
earlier, and still arrives just after the beat. Clean's glide is 85ms (was 70), Breathy's 120ms
(was 110). Into "it", a fifth up, in Clean, the share of the way every 10ms around the vowel:

|        |     |     |     |     |     |     |     |        |     |     |     |     |     |
| ------ | --- | --- | --- | --- | --- | --- | --- | ------ | --- | --- | --- | --- | --- |
| before | −4  | −4  | −3  | 1   | 7   | 14  | 30  | **87** | 94  | 101 | 102 | 102 | 102 |
| after  | −3  | −1  | 2   | 6   | 13  | 23  | 39  | 55     | 93  | 102 | 104 | 104 | 103 |

Its steepest moment fell from 400 to 313 cents per 10ms. Steps of a tone or two barely change in
length; their middle is a little steeper and their ends softer.

**Vibrato** was already only on held notes in the lyrics box (the late vibrato): about 15 cents
at 5.1 Hz at the end of the 2.6s "home", none on 0.65s notes, before and after. Two changes:
a note too short for the vibrato to grow to half its depth gets none, where it got a 3–5 cent
stub; and its speed drifts slowly by about 4%, so it is not a metronome.

**Word starts.** A word's first consonant is about 3.5dB louder than the same one inside a word.
The voice sinks a little further under a word-starting m, n, l or w, and dips to a quarter (not a
half) into a word that starts on its vowel. Consonant against its vowel, high band:

|               | Clean          | Breathy       | Glitchy     |
| ------------- | -------------- | ------------- | ----------- |
| Pull          | −4.7 → −1.4 dB | −19.2 → −16.4 | −5.0 → −3.1 |
| dance         | −7.9 → −4.4    | −5.7 → −3.7   | 0.2 → 1.9   |
| sing          | 19.6 → 22.9    | 0.9 → 4.3     | 12.8 → 16.4 |
| home          | −8.1 → −5.3    | −26.4 → −22.7 | 2.6 → 4.0   |
| dip into "it" | −13.0 → −20.3  | −13.2 → −20.3 | −2.9 → −7.0 |

**A fade found on the way.** Between two vowels ("my own") the small dip was stamped before the
point that set the second syllable's level, so it ramped from the first syllable's own rise: the
voice faded across the whole first vowel and jumped back at the second. Rendered, "my" held its
level halfway through after the fix, where it had fallen 2.0dB (Clean) and 1.5dB (Breathy). The
dip into "own" deepened from −12.0 to −14.7dB (Clean) and −4.0 to −7.1dB (Breathy), and the
largest 5ms rise into it fell from 3.9 to 2.8dB in Breathy.

Overall level is unchanged: RMS within 0.1dB for every voice, nothing clipped.

## Tests

New: the S (well short of a straight line at 10% and 90% of its time), a leap starting earlier
and arriving at the same place, a word's first consonant 3–6dB louder, the voice sinking further
under a word-starting m or l, the hold-then-dip between two vowels, and no vibrato stub. Each was
made to fail with its change taken out. Two were rewritten after their first draft compared
against the constant they test (`WORD_START`) and so stayed green with it set back to 1.

## Not checked

How it sounds to a person. These are measurements; the before/after WAVs went to Evan.
