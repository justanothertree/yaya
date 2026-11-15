# The singer, more vibe: two rounds of A/B

Evan, 14 Nov 2026, after hearing #325 and releasing it: make the singer "more vibey", in the
manner of Vocaloid-style pop vocals. Still code only — oscillators, noise and filters; no samples,
no models, no service — and aimed at the performance and the production rather than at new sounds.
#325's diction stays.

`singer-vibe.html` plays today's voice (A, frozen in `src/singerPreview/before/` at the #325 release,
fdd3fba) beside B.

✅ **Released with #329, 14 Nov 2026, and published unlisted at
[evancook.dev/singer-vibe.html](https://evancook.dev/singer-vibe.html)** — Evan played round two
("it's cool") and asked for it live so it can be heard on a phone. It is a second build input in
`vite.config.ts`, linked from nowhere, marked `noindex`, and it saves nothing. Sound starts on a tap,
which is the only moment a phone allows it; on an iPhone the page also declares itself a media
player, so the ring switch does not silence it.

**Every switch is off by default, on the page and in the singer.** When the page was published, the
Sing panel asked for none of them.

## Round three: two of the switches become the Sing panel's sound

Evan, 14 Nov 2026, after playing round two:

- The **late vibrato** and the **light room** are how the Sing panel sings every line now (`SOUND` in
  `SingPanel.tsx`). The light room replaces the part bus's reverb, so the panel's bus has none.
- The **soft echo** stays off.
- **Harmony** is a choice in the panel, Off, Third or Third + octave, and starts on Off.

Checked in the room with the instrument muted:

- Off builds a voice and its room.
- Third adds the harmony.
- Third + octave adds the octave as well.
- Stop leaves 0 in every case.
- The new row fits at 375 with nothing spilling.

**The A/B page kept its sound, and its words were corrected afterwards** (Evan, 14 Nov 2026, with
#326). It used to say A was "the voice on the site now"; since this round the site sings with B's
two switches on. So A is "the voice before the vibe pass", its button reads "A, before", and B's
"Today's" choices read "As A". Nothing it plays changed.

## Round one: Evan preferred A

The first B changed everything at once:

- dips into every note, overshoot on leaps and falls off the ends of phrases;
- a plate, an echo and a sheen of its own on every voice;
- breaths before phrases;
- an optional tight tune.

Evan's verdict:

- **A is better than B.**
- **Tight tune:** he prefers natural. Leave it off, and do not add it to the Sing panel.
- **Breaths:** too much, and they do not sound like real breaths. Out.
- **Harmony:** undecided, so it goes on the A/B page as a choice rather than being decided here.

### Why B lost, measured

Same four lines, same notes, A in the part bus's room as on the site:

| Measure                                                                     | Clean A | Clean B | Breathy A | Breathy B |
| --------------------------------------------------------------------------- | ------- | ------- | --------- | --------- |
| Singing time within 10 cents of its note                                    | 90.5%   | 82.1%   | 87.5%     | 76.3%     |
| How far the gaps between syllables fall below them (P90−P10 of 10ms levels) | 24.9dB  | 17.9dB  | 22.9dB    | 14.9dB    |

- **The dips and falls took B off its notes** for another 8 to 11 points of the time it was singing.
  On a voice this exact, that reads as out of tune rather than expressive.
- **The plate and the echo filled in the silences** that make #325's consonants audible, by 7 to
  8dB. Those silences are most of what "clean" means for this voice.
- **The sheen made it a little brighter** as well (up to 1.4dB on the top-end measure).

Glitchy had no dips and lost only to the room: 25.4 against 21.3dB.

## Round two: today's voice plus one switch at a time

B is today's voice again: the round-one changes are gone from the code, and the Sing panel is
untouched. On top of it are three switches, each off by default, to be heard one at a time.

**With every switch off, B is A.** Measured:

- B's plan is A's, step for step, on all 12 line and voice pairs.
- Their loudness differs by at most 0.22dB, which is the noise between two renders.

The cost to clarity of each switch is measured as above: the change in how far the gaps fall below
the syllables, on Clean.

| Switch                                                                                                                                                                                        | Gaps, against A |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Vibrato: Late** — only long notes waver: it waits 0.5s, grows over 0.55s, at 5.1Hz and about two thirds of today's depth (18 cents on Clean, against 28). Glitchy, which has none, gets 12. | +0.1dB          |
| **Room: Light room** — in place of today's room, which is 22dB under the voice for 2.2s: one 25dB under for 0.9s, answering 20ms late, fed only the voice's middle (400Hz–5kHz).              | +10.1dB         |
| **Room: Soft echo** — today's room, plus one echo half a beat later at 20dB under, alternating sides; the second repeat is faint.                                                             | −1.1dB          |
| **Harmony: Third** — today's harmony option: a voice a third above in the scale, at half the lead's level.                                                                                    | −1.6dB          |
| **Harmony: Third + octave** — that, plus a copy of the tune an octave below, at a third of the lead's level and 9ms late, with no consonant noise of its own so it cannot smear the lead's.   | −1.3dB          |

Round one's B cost 7dB. The light room gains because its short tail is gone before the next phrase,
where today's room is still ringing.

**Loudness.** Before each play, B is measured against A with the same voice and switches, over all
four lines. The measure uses roughly the curve LUFS uses. B is then turned up or down by the
difference, because a harmony or an echo adds level, and the louder side wins an A/B whatever else
it does.

The match holds to about 0.4dB, which is as close as two renders of A come to each other: a doubled
voice wanders at a random rate. Measured on one line rather than four, it was off by up to 0.6dB.

**The first room levels were wrong, and only an exact measurement showed it.** Subtracting two
ordinary renders could not see a reverb this quiet. Two renders with the same random numbers, one
with the send at 0, subtracted sample by sample, could. The values tried first read 18dB and 13dB
under the voice: a "light" room wetter than today's.

**Nothing left behind.** With every switch, on Clean and on doubled Breathy, every voice, room and
echo was let go after its tail and at once on Stop: 0 remaining in all 12 cases.

**Tests.** 59 in `singer.test.ts`, 7 of them new. The code was broken nine ways, once each, and
every break turned its own test red. The breaks were:

- vibrato early, at full depth, or silent on Glitchy;
- the octave not an octave down, carrying consonants, under the harmony too, or on time;
- the room let go before its echo had died;
- a plate that never darkens.

## Not checked

- **How it sounds.** That is for ears.
- Firefox, Safari and a real phone. A line with a room or an echo carries one more convolver or two
  delays.
- **The instrument room, heard.** Round three's sound was checked there for what it builds and lets go,
  with the output muted; nobody has listened to it in the room itself.
- **The live page on a real phone.** It was checked in the production build at 375 with touch
  emulated: the tap starts the sound, nothing is clipped or undersized, a line plays and Stop leaves
  0 voices (with the output muted, so nothing sounded here).

## Afterwards

When the page is no longer wanted, delete `singer-vibe.html`, `src/singerPreview/vibe.ts`,
`src/singerPreview/before/` and the page's line in `vite.config.ts`'s `input`, together.
