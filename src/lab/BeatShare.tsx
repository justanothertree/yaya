import { useMemo } from 'react'
import { CopyLink } from './CopyLink'
import { here } from './links'
import { ARMS, bannerText, beatLink, beatMessage, shareable, type Beat } from './beat'

/**
 * "Copy a beat-my-run link": a finished game's board and score, as a sentence and a link. Given the
 * link that game answered, the sentence reads as a reply, so whoever finishes a link can send their
 * own result on the same board — any number of friends, each with their own link, no name in any.
 *
 * Nothing is offered for a result whose link would not read back to itself (a score past a bound):
 * a link that opens as no challenge is worse than no link.
 */
export function BeatShare({ beat, answering }: { beat: Beat; answering?: Beat | null }) {
  const ok = useMemo(() => shareable(beat), [beat])
  if (!ok) return null
  return (
    <CopyLink
      text={beatMessage(beat, beatLink(beat, here()), answering ?? undefined)}
      label={`🔗 Copy a “beat my ${ARMS[beat.game].noun}” link`}
    />
  )
}

/**
 * The banner over a toy opened from a link: what the link says, what is the same, and how to win.
 * `today` when the link's board is today's board here, so the finish counts as the reader's own.
 */
export function BeatBanner({
  beat,
  today = false,
  onLeave,
  disabled,
}: {
  beat: Beat
  today?: boolean
  onLeave: () => void
  disabled?: boolean
}) {
  const { lead, body } = bannerText(beat, today)
  return (
    <p className="beat-banner">
      🏁 <strong>{lead}</strong> {body}{' '}
      <button className="btn btn-ghost" onClick={onLeave} disabled={disabled}>
        Leave the challenge
      </button>
    </p>
  )
}
