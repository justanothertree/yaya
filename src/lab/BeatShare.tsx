import { CopyLink } from './CopyLink'
import { here } from './links'
import { beatLink, beatMessage, type Beat } from './beat'

/** "Copy a beat-my-run link": a run's seed and score, as a sentence and a link */
export function BeatShare({ beat }: { beat: Beat }) {
  return (
    <CopyLink
      text={beatMessage(beat, beatLink(beat, here()))}
      label="🔗 Copy a “beat my run” link"
    />
  )
}
