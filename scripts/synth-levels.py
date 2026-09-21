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
"""
# What each instrument actually puts out, from the preset data rather than from `level` alone.
#
# level is PER-PARTIAL gain, and the partials sum — so a patch with four of them is four times
# the amplitude of a single-partial patch at the same level. That is the number the ear hears
# and the one nobody has been reading.
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
    peak = lvl * sum(gains)          # all partials at full envelope
    hold = peak * sus                # what a held note settles to
    rows.append((name, lvl, len(gains), sum(gains), peak, sus, hold))

print('%-10s %5s %3s %6s %7s %5s %7s' % ('preset','level','n','sumG','PEAK','sus','HELD'))
for r in sorted(rows, key=lambda r: -r[4]):
    print('%-10s %5.2f %3d %6.2f %7.3f %5.2f %7.3f' % r)

peaks = [r[4] for r in rows]
print('\npeak amplitude: min %.3f  median %.3f  max %.3f  -> %.1fx spread (%.1f dB)'
      % (min(peaks), statistics.median(peaks), max(peaks), max(peaks)/min(peaks),
         20*__import__('math').log10(max(peaks)/min(peaks))))
lv = [r[1] for r in rows]
print('level alone   : min %.2f  max %.2f  -> %.1fx spread' % (min(lv), max(lv), max(lv)/min(lv)))
