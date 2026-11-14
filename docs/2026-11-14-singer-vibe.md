# The singer, more vibe: a plan and a prototype

Evan, 14 Nov 2026, after hearing #325 and releasing it: make the singer "more vibey", in the
manner of Vocaloid-style pop vocals. Still code only — oscillators, noise and filters; no samples,
no models, no service — and aimed at the performance and the production rather than at new sounds.
#325's diction stays: nothing here touches a consonant, a formant or a burst.

**A draft, not for merging.** The prototype is in the voice itself, the way #325's was, so the A/B
page can play the real thing: `singer-vibe.html` puts today's voice (A, frozen in
`src/singerPreview/before/` at the #325 release, fdd3fba) beside the prototype (B).

## The plan

Everything on Evan's list, in the order it matters:

1. **The pitch, performed.** ✅ prototype
2. **A room of its own, per voice.** ✅ prototype
3. **Breaths between phrases.** ✅ prototype
4. **A tight tune, as an option.** ✅ prototype, a switch on the A/B page
5. **Harmony stacks and doubles.** Today a harmony is one voice a third above, and only the lead
   can be doubled. Next: a stack (a third and a fifth, or a third and a quiet octave) and a double
   on the harmony too, each slightly detuned and spread wider than the lead.
6. **Tuning the presets by ear**, once Evan has heard B: how deep the dips are, how long the falls,
   how wet the room.
7. **The room's own switch for a tight tune** in the Sing panel, and the echo ducking under the voice
   while it sings.

## What B does now

**The pitch, performed** (`bend` on each voice). A tuned pop vocal does not sit on its notes the way
a keyboard does.

- Every new syllable dips under its note and rises onto it — 0.45 semitones over 90ms on Clean.
  On a repeated note that dip is the only movement there is, and it is what makes each syllable
  start. A step down drops a little past its note and recovers.
- A leap of three semitones or more carries past its note by 0.3 semitones and settles back.
- A phrase's last note, when it is held and open ("go", "sky"), falls away by about a semitone as it
  ends, and fades with it. A word ending on a consonant closes in silence, so it does not fall.
- A held vowel carries straight on to its next pitch, with no dip in the middle of the word.
- The delayed vibrato on long notes is unchanged.

**A tight tune** (`tight`, the A/B page's switch). Every note is reached within 20ms of its beat and
held dead level: no dips, no overshoot, no random cents, no drift. Vibrato comes later and
shallower. The fall at a phrase's end stays, because it is a performance and not a tuning error.

**A room of its own** (`space` on each voice). This is most of what makes a pop vocal sound produced
rather than recorded.

- A lift above 8kHz: the sheen.
- A plate, made from noise like everything else here, that falls 60dB over its decay and darkens as
  it falls.
- An echo in time with the song, alternating left and right: a dotted eighth on Clean and Breathy,
  an eighth on Glitchy.
- Both sends are high-passed, so the low end stays the voice's own.
- The Sing panel's part bus adds no reverb to a voice that brings its own; two reverbs on one voice
  is a wash.

**Breaths** (`inhale`). A breath in before every lead phrase that follows a rest, and before the
first phrase when the line has time in hand. The lead only, once: a doubled lead is one singer, and
a harmony breathing too would be a crowd.

## Measured

- **Level-matched.** B was 0.8–1.3dB louder than A, all of it the plate and the echo, and louder
  wins any A/B. Each B's `out` is brought down by that much. Over the page's four lines, against A
  in the part bus's room, B now reads within 0.3dB RMS on every voice, tight or not.
- **Breaths**, through a line's own render: the loudest stretch sits 19dB under a held vowel on
  Clean, 17dB on Breathy and 24dB on Glitchy. At a third of those levels they could not be heard
  under the echo of the phrase before.
- **Nothing left behind.** Every voice, breath and room is let go when the last echo is 60dB down,
  and at once when stopped. For every voice, natural and tight, a line built 5–7 of them and 0 remained
  after the tail and 0 after a stop.
- **Tests:** 70 in `singer.test.ts`, 18 of them new. Each new behaviour was broken once to see its
  test fail. Two did not at first:
  - The hold test compared against the first note's pitch, which a dip into the next note never
    reaches.
  - The lead-only breath rule was hidden by the harmony resting where the lead rests.

  Both now ask the right question.

## Not checked

- **How it sounds.** I cannot listen. The numbers say B is no louder than A and the shapes are where
  they are meant to be; whether it is more vibe is for ears.
- **The instrument room in real time.** The room's only change is the bus's reverb being turned off
  for these voices.
- Firefox, Safari and a real phone. A line now carries one convolver; that is cheap on a desktop and
  unmeasured on a phone.

## Afterwards

Delete `singer-vibe.html`, `src/singerPreview/vibe.ts` and `src/singerPreview/before/` once the
comparison is done, as #325 did with its own.
