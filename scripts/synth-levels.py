"""
What each instrument actually puts out.

  python scripts/synth-levels.py

⚠️ `level` IS PER PARTIAL, AND THE PARTIALS SUM, so reading that column on its own tells you
nothing: a four-partial patch at 0.30 is louder than a one-partial patch at 0.50. PEAK is
level x sum(gains) — what the ear gets at the top of the envelope — and HELD is that times the
sustain fraction, which is what a note in a LOOP settles to and therefore what you actually
hear in a song.

⚠️ THE TWO COLUMNS DISAGREED, which is how the imbalance stayed hidden. In September the peaks
were already inside 2.5x and looked fine; held notes ran 0.052 to 0.636, so a whistle layer sat
three times under an organ one and the fader (then capped at 1.5) could not close the gap.
Reported as "the layer volume is almost not loud enough for some of the instruments".

Some spread is deliberate — a bass patch is meant to sit under a bell, and low frequencies read
louder than their amplitude. Even up the ones that are quiet in BOTH columns and leave the rest.

⚠️⚠️ THIS SCRIPT MULTIPLIED BY A NUMBER THE AUDIO CODE DIVIDES OUT. Corrected 2026-11-05.

PEAK was `level x sum(gains)`, and the sentence under it — "a four-partial patch at 0.30 is
louder than a one-partial patch at 0.50" — stopped being true when `noteOn` started NORMALISING
the partials. synth.ts does this, and names the variable:

    const partialSum = sh.partials.reduce((n, x) => n + x.gain, 0) || 1
    ...
    const share = part.gain / partialSum
    ...
    const peak = sh.level

So a partial's `gain` is its SHARE OF THE TIMBRE and nothing else; adding a fifth partial changes
what a patch sounds like and not how loud it is. The normalisation was added to stop pads
clipping — "four pad notes reached 1.008 and clipped, where one bell note reached 0.28" — and
from that day this column was measuring a quantity that no longer existed. It is the shape
CLAUDE.md warns about by name: a measured claim whose falsifier landed in a different file.

PEAK is `level` now and HELD is `level x sustain`. sumG is kept because it still says something
about the patch — just not about its loudness.

⚠️ AND EVEN CORRECTED, THIS IS NOT A LOUDNESS METER. Measured the same day with an analyser on
the synth's own output tap, one note held three seconds, maximum taken:

      preset    level   measured   ratio
      reed       0.42      0.349    0.83
      keys       0.50      0.297    0.59
      organ      0.30      0.144    0.48
      accordion  0.44      0.144    0.33
      strings    0.26      0.079    0.30
      drone      0.20      0.026    0.13

`level` is where the envelope PEAKS, which a slow-attack patch behind a lowpass never reaches in
the shape the ear integrates. The remaining ~6x is attack, filter and detuned partials beating
rather than summing. So the table tells you what a patch is ASKING for; the analyser tells you
what it gets.

The imbalance is real either way: the complaint this script came from — "the layer volume is
almost not loud enough for some of the instruments" — is still true of the sound, and the layer
fader is capped at 2x against a measured 13x spread. Re-levelling thirty presets against
measurement changes every saved song and loop, so it is Evan's call and is not guessed at here.
"""
# What each preset ASKS for, read out of the patch data. See the header for why that is not the
# same as what it gets, and for why PEAK is `level` rather than `level x sum(gains)`.
import io, re, statistics

s = io.open('src/audio/synth.ts', encoding='utf-8').read()
body = s[s.index('const SHAPES'):]
body = body[:body.index('\n}\n')]

rows = []
for m in re.finditer(r'\n  (\w+): \{(.*?)\n  \},', body, re.S):
    name, b = m.group(1), m.group(2)
    lvl = re.search(r'level:\s*([0-9.]+)', b)
    if not lvl: continue
    lvl = float(lvl.group(1))
    gains = [float(g) for g in re.findall(r'gain:\s*([0-9.]+)', b)]
    sus = float(re.search(r'\n\s*s:\s*([0-9.]+)', b).group(1)) if re.search(r'\n\s*s:\s*([0-9.]+)', b) else 0.0
    peak = lvl                       # noteOn normalises the partials: `const peak = sh.level`
    hold = peak * sus                # what a held note settles to
    rows.append((name, lvl, len(gains), sum(gains), peak, sus, hold))

print('%-10s %5s %3s %6s %7s %5s %7s' % ('preset','level','n','sumG','PEAK','sus','HELD'))
for r in sorted(rows, key=lambda r: -r[4]):
    print('%-10s %5.2f %3d %6.2f %7.3f %5.2f %7.3f' % r)

peaks = [r[4] for r in rows]
print('\npeak amplitude: min %.3f  median %.3f  max %.3f  -> %.1fx spread (%.1f dB)'
      % (min(peaks), statistics.median(peaks), max(peaks), max(peaks)/min(peaks),
         20*__import__('math').log10(max(peaks)/min(peaks))))
holds = [r[6] for r in rows if r[5] > 0]
print('held, sustaining: min %.3f  max %.3f  -> %.1fx spread'
      % (min(holds), max(holds), max(holds)/min(holds)))
print()
print('PEAK is what a preset ASKS for. Measured output ran 0.026-0.349 across six presets')
print('on 2026-11-05 -- a 13x spread against this table\'s 3.1x. See the header.')
