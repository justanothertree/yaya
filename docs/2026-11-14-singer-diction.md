# The singer, made to be understood — 14 Nov 2026

Evan tried the live singer and found the words hard to make out. This is the fix, still in pure
code: oscillators, noise made in the browser, and filters. No samples, no models, no service, and
still no lyric storage.

## What was weakest, and why

Measured before anything changed. Every opening consonant was put before "a", sung at E4 and
rendered offline with the voice from the live site. For each one, three readings:

- **Consonant level:** its loudest 5ms, against the vowel's level.
- **Silence:** how much quiet comes before its release when it follows a vowel.
- **Distance:** for each group of sounds a listener has to tell apart, how different they are. This
  is the RMS distance between log-band spectrograms over 100ms either side of the vowel's start. It
  is a proxy for how separable two sounds are, not a listening test.

Clean voice, today:

| What                 | Measured                                                  | Why                                                                                            |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| m and n              | **0.0dB apart**: the same sound                           | One shared nasal murmur, and the mouth moved straight from it into the vowel                   |
| p, t, k              | **0.0dB apart** once the vowel starts                     | Only a 12ms click differed. The vowel never moved out of the consonant, so it carried no place |
| b, d, g              | 1.2dB apart, the closest pair 0.7                         | The same 12ms click at half level, under a "voice bar" that was really a quiet vowel 18dB down |
| A stop inside a line | **3–7ms** of silence                                      | The voice faded 33ms before the vowel, and the burst came 3ms later                            |
| s, sh                | **26dB** under the vowel, at the same level as each other | Narrow bands (Q 2.5). sh is the loudest hiss in speech; here it was no louder than s           |
| f, th                | **29dB** under at their peak, about 39dB on average       | About as quiet as a pause                                                                      |
| v, z                 | Read as a muffled vowel                                   | The voice ran at 30% through the vowel's own formants, and the hiss was buried under it        |
| l, w                 | The closest glide pair, 2.8dB apart                       | l started from the vowel "ou" and w from "oo"                                                  |

The spelling rules also lost sounds before any audio was made:

- **A closing sh, ch or th was read as its h.** "fish" sang "fih", and "each", "much" and "with"
  ended on a breath.
- **Clusters kept only their first consonant.** "sky" sang "sigh", "play" sang "pay", "street"
  sang "seet".
- **"x" was a single click,** so "six" had no s.
- **Common words came out wrong.** "the" sang "theh" (with a voiceless th), "we" sang "weh", "I"
  sang "ih", "you" sang "yow", "to" sang "tah", "love" sang "lohv", "come" sang "kohm", "nice" sang
  "nike", "phone" sang "pone" and "queen" sang "kuhn".
- **The singer never said when a syllable was a whole word,** so the rule that makes "my" and
  "sky" sing "ai" never ran when singing.

## What changed

**Spelling (`lyrics.ts`).**

- **Place.** Every consonant records where in the mouth it is made: lips, teeth, ridge, palate,
  velum or glottis.
- **Clusters.** An opening keeps up to three sounds ("str") and an ending its last two ("and", and
  "six" as k then s).
- **Endings.** Closing sh, ch, th, ck, ng and x read as themselves. A plural s after a voiced sound
  is a z ("drums").
- **Spelling rules.** c is soft before e, i and y ("nice", "city"), and ph, wh, qu, kn and wr say
  what they spell.
- **Short words.** A word on its own that ends on its vowel says it long: we, go, hi, la.
- **Exceptions.** About fifty common lyric words are written out as their sounds (`SAID`).
- **Whole words.** The flag now reaches the singer, through `assignSyllables` and `fitSyllables`
  both.

**Sound (`singer.ts`).**

- **Place moves the vowel.** At each consonant the formants go to the shape its place makes
  (`locus`, from the locus equations phoneticians fit to speech), and the vowel's first 50ms moves
  out of it:
  - F2 starts low after lips and toward 1.8kHz after the ridge;
  - after the velum F2 and F3 come together;
  - F1 always starts low.

  The vowel also heads for a closing consonant's place before the mouth closes on it.

- **Stops are silence, then a click.** A closure of up to 50ms, then a burst that is at full level
  within half a millisecond and fades over 15ms. Its spectrum depends on the place: low and spread
  for p and b, high for t and d, and for k and g a compact peak on the coming vowel's F2. Then
  breath through the vowel after p, t and k. When the voice was already silent, the closure costs
  no time.
- **A lowpass after the formants** closes for the voice bar of b, d and g (450Hz), half-closes for
  the voice under z, v and the voiced th, and sets each nasal's murmur. m is duller than n.
- **Each hiss by place.** s is a wide high band; sh is lower and the loudest; f and th are flat and
  quiet. ch and j are a closure released into a sh.
- **Glides have their own shapes.** w is lower and further back than any vowel, y is high and
  front, l keeps F3 high, r pulls F3 down to about 1.7kHz, and a closing l is the dark one.
- **Diction per preset.** Clean 1, Breathy 0.8 and Glitchy 0.9 scale all consonant noise against
  the voice.
- **Vowel bandwidths are narrower,** a little clearer: Clean 1 → 0.85, Breathy 1.35 → 1.15 (still
  the softest), Glitchy 0.85 → 0.75.

## Old → new, measured the same way

Clean voice: consonant level against the vowel, and silence before a stop after a vowel.

| Sound | Level, old → new | Silence, old → new                             |
| ----- | ---------------- | ---------------------------------------------- |
| p     | −11 → −16dB      | 7 → 39ms                                       |
| t     | −11 → −9dB       | 3 → 34ms                                       |
| k     | −11 → −14dB      | 4 → 36ms                                       |
| b d g | −18 → −13dB      | a voice bar at −24dB, through a closed lowpass |
| m n   | −9 → −9dB        | —                                              |
| s     | −26 → −17dB      | —                                              |
| sh    | −26 → −13dB      | —                                              |
| f th  | −29 → −24dB      | —                                              |

⚠️ **That is more than "a touch" for the hiss,** and it is deliberate. At −26dB an s was quieter
than the room. In speech an s or sh sits roughly 5–15dB under the vowel, and the new levels are
still at the quiet end of that. If it sounds hissy, the levels are one table (`HISS`).

How far apart the sounds are, in dB (the mean of the pairs, then the closest pair):

| Group     | Clean, old → new      | Breathy               | Glitchy               |
| --------- | --------------------- | --------------------- | --------------------- |
| p t k     | 2.2 → 3.0 (1.5 → 2.4) | 2.1 → 3.0 (1.5 → 2.5) | 1.9 → 3.6 (1.5 → 3.0) |
| b d g     | 1.2 → 2.2 (0.7 → 1.8) | 0.9 → 1.8 (0.6 → 1.4) | 0.6 → 2.4 (0.4 → 1.9) |
| m n       | **0.0 → 2.6**         | 0.0 → 1.9             | 0.0 → 2.6             |
| s sh f th | 4.9 → 6.9 (1.3 → 2.1) | 4.6 → 6.4 (1.2 → 1.9) | 3.5 → 7.6 (0.8 → 2.5) |
| v z       | 2.6 → 6.2             | 1.5 → 6.1             | 1.5 → 5.6             |
| l r w y   | 5.4 → 5.3 (2.8 → 4.3) | 4.6 → 4.1 (3.0 → 3.6) | 5.0 → 4.7 (3.4 → 4.1) |

The glides' average fell slightly in Breathy and Glitchy, while their closest pair (l against w)
moved well apart in all three. f against th stays the closest pair of the hisses; in speech it is
the commonest confusion too.

**Vowels.** The mean distance between seven held vowels rose by 0.1–0.3dB at A3, E4 and C5 (Clean
10.27 → 10.46 at E4). It is a small gain, and narrowing further gave little more.

**Level against Keys.** Measured in the room, through the same output tap, with the old and new
voice in one run on a held vowel at C5:

| Preset  | New vs old voice |
| ------- | ---------------- |
| Clean   | +0.2dB           |
| Breathy | +0.3dB           |
| Glitchy | +0.1dB           |

That is about the run-to-run spread, so `out` is unchanged. Whole lines move by −0.7 to +0.6dB
against the old voice, from the consonants and the respelling.

## How it was checked

- **Tests.** 98 across `singer.test.ts`, `lyrics.test.ts` and `pocket.test.ts`, written from what
  a listener would notice:
  - the silence before a burst;
  - which formant starts where after b, d and g;
  - m against n;
  - each hiss's band;
  - l against r;
  - clusters in order;
  - "fish" ending on a sh;
  - "my" sung as a word.

  Twenty-four rules were each broken once, and each turned at least one test red. One, the free
  closure after silence, stayed green until its test was moved to the start of a line, which is
  where the lead is counted from.

  Reviewing the code found one bug the tests had not reached. A consonant with no time to spare
  (a line opening on "wa" with nothing in hand) moved into its vowel before it had taken its own
  shape, so the vowel was sung at the w's F2, 62% of where it belonged. Its test failed first, at
  a line starting at 1s. At 0s the clamp at the phrase's start hid it.

- **The room.** ▶ Sing then ■ Stop singing leaves 0 voices, and so does a line left to end. Nothing
  new in the console.
- **The A/B page.**
  - Stop, switching lines and the natural end all leave 0 voices, checked with doubled Breathy and
    Spoken.
  - `mobileAudit` reads zero at 375 (touch) and 1440, after a planted 16px button was reported to
    prove the audit was looking.
  - Tab order follows the page.

## The A/B page

`singer-ab.html` is dev-only, like `singer-preview.html`, and a bundled copy is a private claude.ai
page for listening on a phone. It plays four fixed lines with A (today's voice, frozen in
`src/singerPreview/before/`) and B (the new one):

- the cat sat on the mat
- sixty six fish
- we will meet at night
- play the drums and dance

Both use the same notes, the same seed and the same small room. Clean sings alone and Breathy and
Glitchy are doubled, as in the room. "Sung" is a tune and "Spoken" a quick falling line, one
syllable each. Delete the page and `before/` once the comparison is done.

## Not done

- **How it sounds.** The distances are a proxy. Ears decide, and Firefox, Safari and a real phone
  are unheard.
- **Spelling gaps that remain:**
  - Open syllables inside longer words are not lengthened, so "ba-by" sings "bab-ee".
  - "ow" is always the vowel of "now", never the one of "know".
  - "change" loses its j, and a three-consonant ending keeps its last two.
  - A hyphen fixes a split, but nothing fixes a vowel yet.
- **Stress** is unchanged: stressed and light syllables are sung with the same consonants.
