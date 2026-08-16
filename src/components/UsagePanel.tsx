import { useEffect, useState } from 'react'
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

type Account = {
  configured: boolean
  reason?: string
  error?: string
  from?: string
  to?: string
  egressBytes?: number
  ingressBytes?: number
}

/**
 * Cloudflare's own numbers, fetched through the relay because the analytics token must not be
 * in the browser. One request when this panel opens — nothing is added to the call path, which
 * is the part that has to stay cheap.
 */
function useAccountUsage() {
  const [data, setData] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const base = voiceSession.relayBase()
        if (!base) throw new Error('no relay configured')
        const r = await fetch(`${base}/usage`)
        const body = (await r.json()) as Account
        if (live) setData(body)
      } catch {
        if (live) setData(null)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [])
  return { data, loading }
}

function fmt(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < GB) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / GB).toFixed(2)} GB`
}

export function UsagePanel() {
  const usage = voiceSession.turnUsage()
  const { data, loading } = useAccountUsage()
  const months = Object.keys(usage).sort().slice(-6).reverse()
  const deviceMonth = usage[new Date().toISOString().slice(0, 7)] ?? 0
  /**
   * Cloudflare's figure when we have it, this device's measurement when we don't. Which one is
   * on screen is stated outright — a usage number whose SOURCE is ambiguous is worse than no
   * number, because you can't tell whether a small figure means low usage or a broken meter.
   */
  const accountBytes =
    data?.configured && !data.error ? (data.egressBytes ?? 0) + (data.ingressBytes ?? 0) : null
  const thisMonth = accountBytes ?? deviceMonth
  const gb = thisMonth / GB
  const overage = Math.max(0, gb - FREE_GB)

  return (
    <div className="usage-panel">
      <h3>Call relay usage</h3>
      <p className="usage-hero">
        <strong>{loading ? '…' : fmt(thisMonth)}</strong>{' '}
        <span className="muted">relayed this month</span>
      </p>
      <p className="muted usage-note">
        {accountBytes !== null ? (
          <>Everyone’s calls, from Cloudflare’s own billing data.</>
        ) : data?.configured && data.error ? (
          <>Couldn’t reach Cloudflare ({data.error}) — showing this device only.</>
        ) : (
          <>
            This device only. Add <code>CF_ACCOUNT_ID</code> and <code>CF_ANALYTICS_TOKEN</code> to
            the relay for everyone’s.
          </>
        )}
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
        <ul className="usage-months" title="Measured on this device">
          {months.map((m) => (
            <li key={m}>
              <span className="muted">{m}</span> <span>{fmt(usage[m])}</span>
            </li>
          ))}
        </ul>
      )}
      {/* Being straight about what this number is and isn't beats a precise-looking wrong one. */}
      <p className="muted usage-caveat">
        Counts only calls that couldn’t connect directly and had to be relayed — most don’t, so a
        small number here is the healthy result rather than a broken meter. Relaying is the lowest
        priority route there is, so a call only uses it once every direct option has failed. In a
        call, hover someone’s name to see whether theirs is one of them.
      </p>
    </div>
  )
}
