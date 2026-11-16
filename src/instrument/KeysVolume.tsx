import { useEffect, useState } from 'react'
import { onMixerChange, setVolume, volume } from '../audio/mixer'

/**
 * How loud your keys are: the one slider, wherever it is offered.
 *
 * ⚠️ IN TWO PLACES ON PURPOSE, AND ONE COMPONENT SO THEY CANNOT DISAGREE (15 Nov 2026). 🎚 Mix
 * is every volume in the song, and ⚙ Sound is everything about how your keys sound, which their
 * volume had been missing from since it left the play bar. Both write the mixer's `instrument`
 * level and both listen for it, so moving one moves the other.
 */
export function KeysVolume({ label = 'Your keys' }: { label?: string }) {
  const [vol, setVol] = useState(() => volume('instrument'))
  useEffect(() => onMixerChange(() => setVol(volume('instrument'))), [])
  return (
    <label className="inst-mix-row">
      <span className="inst-mix-name">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={vol}
        onChange={(e) => {
          const v = Number(e.target.value)
          setVol(v)
          setVolume('instrument', v)
        }}
      />
      <span className="muted inst-mix-pct">{Math.round(vol * 100)}%</span>
    </label>
  )
}
