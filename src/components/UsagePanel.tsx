import { voiceSession } from '../voice/voiceSession'

/**
 * What the paid services have actually cost this month.
 *
 * Exists so the answer to "am I about to be charged" doesn't require logging into a dashboard
 * and reading a graph. It reports only what this site can MEASURE at the source — relayed
 * WebRTC bytes, which is precisely what Cloudflare bills TURN by — rather than guessing from
 * call minutes or parroting a number from somewhere else.
 */

/** Cloudflare Realtime: 1000GB free per month across TURN and SFU, then $0.05/GB. */
const FREE_GB = 1000
const PER_GB = 0.05

const GB = 1024 * 1024 * 1024

function fmt(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < GB) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / GB).toFixed(2)} GB`
}

export function UsagePanel() {
  const usage = voiceSession.turnUsage()
  const months = Object.keys(usage).sort().slice(-6).reverse()
  const thisMonth = usage[new Date().toISOString().slice(0, 7)] ?? 0
  const gb = thisMonth / GB
  const overage = Math.max(0, gb - FREE_GB)

  return (
    <div className="usage-panel">
      <h3>Call relay usage</h3>
      <p className="usage-hero">
        <strong>{fmt(thisMonth)}</strong> <span className="muted">relayed this month</span>
      </p>
      <p className="muted usage-note">
        {overage > 0 ? (
          <>
            Past the {FREE_GB} GB free allowance — about ${(overage * PER_GB).toFixed(2)} so far.
          </>
        ) : (
          <>
            Free up to {FREE_GB} GB a month, then ${PER_GB.toFixed(2)} per GB. You’ve used{' '}
            {gb < 0.01 ? 'almost none' : `${((gb / FREE_GB) * 100).toFixed(2)}%`} of it.
          </>
        )}
      </p>
      {months.length > 1 && (
        <ul className="usage-months">
          {months.map((m) => (
            <li key={m}>
              <span className="muted">{m}</span> <span>{fmt(usage[m])}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Being straight about what this number is and isn't beats a precise-looking wrong one. */}
      <p className="muted usage-caveat">
        Counts only calls that couldn’t connect directly and had to be relayed — most don’t.
        Measured on this device, so it won’t include other people’s relayed calls.
      </p>
    </div>
  )
}
