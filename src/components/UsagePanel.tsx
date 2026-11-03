import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { voiceSession } from '../voice/voiceSession'
import { previewMember } from '../dev/previewMember'
/* the prices, the allowances and the arithmetic -- lifted out so a test can ask it, because this
   is money on a screen and the Browser pane cannot answer any of it. See r2Cost.ts. */
import {
  R2_FREE_A,
  R2_FREE_B,
  R2_FREE_GB_MONTH,
  R2_PER_GB_MONTH,
  R2_PER_M_A,
  R2_PER_M_B,
  r2Cost,
} from './r2Cost'

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

type R2 = {
  configured: boolean
  reason?: string
  error?: string
  from?: string
  to?: string
  /** peak payload + metadata over the month, or null when the field was not there */
  bytes?: number | null
  objects?: number | null
  classA?: number | null
  classB?: number | null
  freeOps?: number | null
  /** operations neither price list knows — priced as writes, named so they can be looked up */
  unknownActions?: string[]
}

type Account = {
  configured: boolean
  reason?: string
  error?: string
  from?: string
  to?: string
  egressBytes?: number
  ingressBytes?: number
  /**
   * ⚠️ EGRESS ALONE, AND IT IS A NEW FIELD BECAUSE THE OLD READING WAS WRONG. This panel added
   * `egressBytes + ingressBytes`, and Cloudflare bills Realtime on "data sent from Cloudflare
   * edge to your application" — egress. A relay that has not been redeployed does not send this,
   * which is why it is optional and why the fallback below is explicit rather than a `??`.
   */
  billableBytes?: number
  /** absent on a relay that has not been redeployed since 3 Nov — see the card */
  r2?: R2
}

/** The site's own picture totals, which Cloudflare cannot know: admin-only, no names. */
type Totals = {
  count: number
  ready: number
  pending: number
  stale: number
  bytes: number
  members: number
  members_near_cap: number
  orphans: number
  orphans_oldest: string | null
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
        // admin-gated on the relay, so it needs the caller's session to prove who's asking
        const { data: sess } = await getSupabaseClient().auth.getSession()
        const token = sess.session?.access_token
        const r = await fetch(`${base}/usage`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        const body = (await r.json()) as Account
        if (live) setData(r.ok ? body : { configured: true, error: 'not permitted' })
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

/**
 * ⚠️ "unknown" RATHER THAN A NUMBER, AND THE WHOLE R2 CARD IS BUILT ON IT. The relay answers
 * `null` for a field Cloudflare did not send — a renamed dataset, a token without the R2 scope, a
 * relay not yet redeployed — and this panel's one job is answering "am I about to be charged". A
 * confident zero says do not look, which is the only genuinely dangerous thing it can say. The
 * relay's own `!r.ok` check was added for exactly this, one layer down.
 */
const unsure = (n: number | null | undefined): n is null | undefined =>
  n === null || n === undefined || !Number.isFinite(n)

const count = (n: number) => n.toLocaleString()

/**
 * Stand-in site totals, so the half of this card that is not Cloudflare's can be looked at.
 *
 * ⚠️ `#dev-usage` EXISTS BECAUSE AN ADMIN-GATED SURFACE IS ONE NOBODY CAN CHECK WHILE
 * SIGNED OUT, and without this the whole lower half of the card renders one sentence saying it
 * needs an admin session. That is the trap CLAUDE.md names twice: a room with nothing in it
 * passes every check there is, and a 375px sweep of it reports a flawless zero against a
 * paragraph.
 *
 * The figures are chosen so every branch below is reachable: pictures that are half-finished AND
 * stale, an account near a cap, and an orphan with a date on it. A fixture where all three are
 * zero can only ever show the quiet path.
 *
 * A function rather than a const, and not exported, for the bundle reason in previewMember.ts.
 */
function previewTotals(): Totals {
  return {
    count: 318,
    ready: 314,
    pending: 4,
    stale: 2,
    bytes: 38_400_000,
    members: 9,
    members_near_cap: 1,
    orphans: 2,
    orphans_oldest: new Date(Date.now() - 9 * 86_400_000).toISOString(),
  }
}

/**
 * Stand-in Cloudflare figures, for the workbench only.
 *
 * ⚠️ IT IS LABELLED AS INVENTED ON SCREEN, which is the only thing that makes it safe. A
 * double that looks like a real reading is how a workbench comes to disagree with the site; this
 * one says so in the card, the way ProfileLookPreview's own header does. It exists because the
 * relay does not run locally, so without it half of this card is three lines reading "unknown"
 * and the populated path -- the percentages, the money, the unknown-operation warning -- has
 * never been seen.
 *
 * The numbers are chosen to reach every branch: storage well inside the allowance, writes just
 * PAST theirs (so `owed` is non-zero and the "past the free tier" line renders), reads inside,
 * and one operation name neither price list knows.
 */
function previewR2(): R2 {
  return {
    configured: true,
    from: '2026-11-01',
    to: '2026-11-03',
    bytes: 41_500_000,
    objects: 318,
    classA: 1_240_000,
    classB: 8_900_000,
    freeOps: 412,
    unknownActions: ['PutBlobNextYear'],
  }
}

/** The site's own picture totals. Admin-gated on the server; a member gets "not allowed". */
function usePictureTotals() {
  const [totals, setTotals] = useState<Totals | null>(() =>
    previewMember ? previewTotals() : null,
  )
  useEffect(() => {
    if (previewMember) return
    let live = true
    void getSupabaseClient()
      .rpc('admin_picture_totals')
      .then(({ data, error }) => {
        if (live && !error && data) setTotals(data as Totals)
      })
    return () => {
      live = false
    }
  }, [])
  return totals
}

/**
 * What the pictures have cost, from Cloudflare's numbers and the site's own rows.
 *
 * ⚠️ TWO SOURCES THAT MEASURE DIFFERENT THINGS, AND SAYING WHICH IS WHICH IS THE POINT. R2 knows
 * what is in the bucket; Postgres knows what the site believes is in the bucket. They should
 * agree, and when they do not, the gap IS the finding — an object R2 holds that
 * `member_pictures` has no row for is an orphan nobody is counting, which is why the orphan log
 * exists and why its figure sits in this card rather than in a log file.
 *
 * ⚠️ AND THE STORAGE ALLOWANCE IS A GB-MONTH, WHICH IS NOT WHAT IS MEASURED. R2's free tier is
 * 10 GB-month — a time-average — and the relay reports the PEAK over the month, because the
 * dataset reports a level and summing it would multiply one bucket by the number of days. The
 * peak is always at least the average, so the percentage here reads high rather than low. Said on
 * screen rather than left as a unit mismatch nobody can see.
 */
function PicturesCard({
  r2,
  relayOld,
  noRelay,
}: {
  r2: R2 | undefined
  relayOld: boolean
  /** the relay could not be reached at all, which is a different answer from every other */
  noRelay: boolean
}) {
  const totals = usePictureTotals()
  /* the workbench has no relay, so the Cloudflare half would otherwise be three "unknown"s */
  const invented = previewMember && !r2
  const figures = invented ? previewR2() : r2
  const { storageShare, owed } = r2Cost(figures ?? {})

  return (
    <div className="usage-panel">
      <h3>Pictures (R2)</h3>

      {/* ⚠️ FOUR STATES, AND THE LAST ONE WAS MISSING UNTIL IT WAS LOOKED AT IN THE PANE.
          Not configured, not redeployed, asked-and-failed, and no relay at all -- which is what
          the dev server shows, and what showed the gap: the hero said "unknown" with nothing
          above it saying why. "Unknown" is the right figure and a bare one is a puzzle. */}
      {invented ? (
        <p className="muted usage-note">
          {/* ⚠️ said in the card, not only in a comment. A double that looks like a real
              reading is how a workbench comes to disagree with the site. */}
          dev preview — these Cloudflare figures are invented; the site’s own count below is the
          real shape of the card.
        </p>
      ) : noRelay ? (
        <p className="muted usage-note">
          No relay reachable from here, so there are no Cloudflare figures. The site’s own count
          below is live.
        </p>
      ) : relayOld ? (
        <p className="muted usage-note">
          The relay hasn’t been redeployed since this card was added, so it isn’t reporting R2 yet.
          Everything below the line is the site’s own count and is live.
        </p>
      ) : r2 && !r2.configured ? (
        <p className="muted usage-note">
          Add <code>CF_ACCOUNT_ID</code> and <code>CF_ANALYTICS_TOKEN</code> to the relay for
          Cloudflare’s figures. The same token the call relay uses covers R2.
        </p>
      ) : r2?.error ? (
        <p className="muted usage-note">Couldn’t reach Cloudflare ({r2.error}).</p>
      ) : null}

      <p className="usage-hero">
        <strong>{unsure(figures?.bytes) ? 'unknown' : fmt(figures!.bytes!)}</strong>{' '}
        <span className="muted">
          stored
          {figures && !unsure(figures.objects) ? ` · ${count(figures.objects)} objects` : ''}
        </span>
      </p>

      <ul className="usage-months">
        <li>
          {/* ⚠️ A PEAK AGAINST A GB-MONTH, which is a unit mismatch and is said out loud
              rather than hidden. The allowance is a monthly average; what Cloudflare reports is a
              level, so the relay takes its maximum over the window. The peak is always at least
              the average, so this reads high rather than low -- the only safe direction for a
              figure whose job is "go and look". */}
          <span
            className="muted"
            title="peak this month, against an allowance that is a monthly average"
          >
            Storage
          </span>
          <span>
            {storageShare === null
              ? 'unknown'
              : `${(storageShare * 100).toFixed(2)}% of ${R2_FREE_GB_MONTH} GB-month`}
          </span>
        </li>
        <li>
          <span className="muted">Writes &amp; lists</span>
          <span>
            {unsure(figures?.classA)
              ? 'unknown'
              : `${count(figures!.classA!)} of ${count(R2_FREE_A)} free`}
          </span>
        </li>
        <li>
          <span className="muted">Reads</span>
          <span>
            {unsure(figures?.classB)
              ? 'unknown'
              : `${count(figures!.classB!)} of ${count(R2_FREE_B)} free`}
          </span>
        </li>
        {!unsure(figures?.freeOps) && figures!.freeOps! > 0 && (
          <li>
            <span className="muted">Deletes</span>
            <span>{count(figures!.freeOps!)} · free</span>
          </li>
        )}
      </ul>

      <p className="muted usage-note">
        {owed === null ? (
          <>
            Can’t tell what this would cost while a figure is unknown — which is the point of saying
            unknown rather than zero.
          </>
        ) : owed > 0 ? (
          <>Past the free tier — about ${owed.toFixed(2)} so far this month.</>
        ) : (
          <>
            Nothing to pay. Past the free tier it is ${R2_PER_GB_MONTH}/GB-month, $
            {R2_PER_M_A.toFixed(2)} per million writes and ${R2_PER_M_B.toFixed(2)} per million
            reads. Egress is free.
          </>
        )}
      </p>

      {figures?.unknownActions && figures.unknownActions.length > 0 && (
        <p className="muted usage-note">
          ⚠️ R2 reported operations this doesn’t have a price for, counted as writes to be safe:{' '}
          {figures.unknownActions.join(', ')}. Check Cloudflare’s pricing page and update{' '}
          <code>server/lib/r2ops.mjs</code>.
        </p>
      )}

      {/* ── the site's own count, which Cloudflare cannot know ───────────────────────────── */}
      {totals && (
        <>
          <p className="muted usage-note">
            On the site: <strong>{count(totals.count)}</strong> pictures across{' '}
            {count(totals.members)} {totals.members === 1 ? 'account' : 'accounts'} ·{' '}
            {fmt(totals.bytes)}
            {totals.pending > 0 ? ` · ${count(totals.pending)} half-finished` : ''}
            {totals.stale > 0 ? ` (${count(totals.stale)} stale)` : ''}
          </p>
          {totals.members_near_cap > 0 && (
            <p className="muted usage-note">
              {count(totals.members_near_cap)}{' '}
              {totals.members_near_cap === 1 ? 'account is' : 'accounts are'} past 80% of the 500
              pictures or 50 MB each — worth raising the cap before they meet it.
            </p>
          )}
          {/* ⚠️ The gap between the two sources, and the only reason this card has both. An
              orphan is an object R2 is charging for that Postgres has no row for, so it can
              never be deleted by anything but a sweep. */}
          <p className="muted usage-note">
            {totals.orphans === 0 ? (
              <>No orphaned objects — every delete has reached R2.</>
            ) : (
              <>
                <strong>
                  {count(totals.orphans)} orphaned {totals.orphans === 1 ? 'object' : 'objects'}
                </strong>{' '}
                — R2 still holds {totals.orphans === 1 ? 'it' : 'them'} and nothing on the site can
                reach {totals.orphans === 1 ? 'it' : 'them'} any more
                {totals.orphans_oldest
                  ? `, the oldest since ${new Date(totals.orphans_oldest).toLocaleDateString()}`
                  : ''}
                . They are in <code>picture_orphans</code>.
              </>
            )}
          </p>
        </>
      )}
      {!totals && (
        <p className="muted usage-note">
          The site’s own picture count needs an admin session — it is the one figure here that is
          not Cloudflare’s.
        </p>
      )}
    </div>
  )
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
  /**
   * ⚠️ EGRESS, NOT THE PAIR. This was `egressBytes + ingressBytes`, and Cloudflare bills Realtime
   * on data sent FROM their edge to the application — so the figure on a billing screen was
   * roughly double, in the one direction that makes somebody go and check a dashboard for
   * nothing. Checked against Cloudflare's own docs rather than inferred from the field names.
   *
   * `billableBytes` is what a redeployed relay sends. The fallback is `egressBytes`, which is the
   * same number by the same rule — written out rather than left as a `??` chain so that the
   * reading is explicit at both ends of the version gap.
   */
  const accountBytes =
    data?.configured && !data.error ? (data.billableBytes ?? data.egressBytes ?? 0) : null
  const thisMonth = accountBytes ?? deviceMonth
  const gb = thisMonth / GB
  const overage = Math.max(0, gb - FREE_GB)
  /* a relay from before 3 Nov sends neither field; `configured: false` is a different answer */
  const relayOld = !!data?.configured && !data.error && data.r2 === undefined

  return (
    <>
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
              This device only. Add <code>CF_ACCOUNT_ID</code> and <code>CF_ANALYTICS_TOKEN</code>{' '}
              to the relay for everyone’s.
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
          {/* ⚠️ THE ALLOWANCE IS SHARED AND THIS USED TO ASK ABOUT ONE PRODUCT. The 1,000 GB covers
            TURN and SFU together — "they do not have independent free tiers" — so a figure built
            on the TURN dataset alone is measured against the wrong denominator. Both are fetched
            now. Nothing here uses the SFU today, which is exactly why it was easy to miss. */}{' '}
          Covers TURN and the SFU, which share the one allowance, and counts only what Cloudflare
          sent out — that is the half they bill.
        </p>
      </div>
      <PicturesCard r2={data?.r2} relayOld={relayOld} noRelay={!loading && data === null} />
    </>
  )
}
