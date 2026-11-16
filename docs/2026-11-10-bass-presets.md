# Bass presets: a line and a voice in one pick — 10 Nov 2026

Evan, from the loop: "bass presets". The Bass row offers seven lines and ten voices: seventy
pairings, and nothing saying which of them belong together. A walking line on an 808 is not a
choice anybody makes on purpose.

**Preset** is now the first control in the Bass row. Each of the ten presets is a pairing somebody
would actually play:

| Preset     | Line         | Voice      |
| ---------- | ------------ | ---------- |
| Motown     | Root & fifth | Finger     |
| Rock       | Pulse        | Pick       |
| Funk       | Funk         | Slap       |
| Walking    | Walk         | Upright    |
| Bossa      | Bossa        | Upright    |
| Dub        | Dub          | Sub        |
| Smooth     | Roots        | Fretless   |
| Trap       | Roots        | 808        |
| House      | Pulse        | Synth bass |
| Acid house | Funk         | Acid       |

## How it behaves

- **It sets the two controls beside it**, the line buttons and Sound, rather than being a third
  thing. Whatever a preset picks can still be changed right there.
- **It reads what is loaded.** A bass whose line and voice match a preset shows that preset.
  Change either one and it shows "No preset". With no bass loaded, it shows the pair that will be
  laid next, the way Sound does.
- **One press, one undo.** Laying the line and setting the voice happen in the same press, which
  the room's history already keeps as a single step.
- Every bass voice except the plain Bass appears in at least one preset, so a voice can be found
  by its preset.

## A style plays the preset that shares its name

Found by building the release candidate. The Preset menu reads what is loaded, so after pressing
the **Bossa** style it said "Your own": Bossa laid its line on plain Bass, while the Bossa preset is
on Upright. **Reggae** did the same beside Dub. So:

- **Bossa** now plays Upright, and **Reggae** plays Sub. Bossa nova's bass is an acoustic upright,
  and dub's is a deep sub; those are the "clearly fits" cases. That makes seven styles that pick a
  voice.
- **The Ballad preset is now called Smooth.** The Ballad style plays plain Bass, and a preset with
  its name on Fretless would have read "Your own" the same way.
- A test holds the rule: every style that shares a name with a preset plays that preset (Rock,
  Funk, House, Bossa). Reggae plays Dub, Jazz plays Walking, and Hip hop plays Trap. Removing
  Bossa's voice turns it red.

**"No preset", not "Your own".** The first wording was "Your own", and the release candidate
showed why it was wrong: Pop, Ballad and Country lay plain Bass, which matches no preset, so
pressing one of those styles had the menu credit you with a bass you never touched. "No preset"
is true whether you changed something or the style simply has none.

**Stacked on #147 (the lines) and #153 (the voices)**, since half the presets use them.

## Measured

- **Tests:** each preset is a line and a voice the row offers, no two set the same pair, the
  menu reads a pairing of your own as no preset, and the style lines sit on the voice that style
  is played on. Matching on the line alone turns the "your own" test red.
- **In the room:**
  - Dub on plain Bass read "Your own".
  - Picking Funk pressed the Funk line, set Sound to Slap, and re-laid the bass (8 notes became
    14).
  - Changing Sound to Upright read "Your own". Then pressing Walk read "Walking".
  - Picking Acid house set Funk on Acid.
- **Keyboard:** with Preset focused, an arrow key applies the next preset (House set Pulse on
  Synth bass). As with Sound, the menu lets go of focus afterwards so the keyboard plays notes
  again.
- **375:** the Bass row is four lines (Preset; the line buttons; Sound), 171px.
  `mobileAudit` reports zero; a planted 16px button was reported first, to show the audit was
  working. A screenshot shows nothing crushed.
- **Console:** no errors.
- **Loudness:** the presets use the voices already measured against Keys in #153 and earlier.

## For Evan

- Whether these ten are the right pairings, and whether any is missing.
