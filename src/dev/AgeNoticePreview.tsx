import { AgeBandNotice } from '../components/AgeBandNotice'

/**
 * The unknown-age notice, with invented handles, because the real one is empty and should be.
 *
 * ⚠️ IT IS A SAFETY NOTICE THAT NOBODY CAN LOOK AT. All 14 members have an age band today, so
 * `admin_members_without_age_band` honestly answers `{"count":0,"handles":[]}`; and `#dev-admin`
 * renders AdminPanel with no token, so even that answer never arrives in the pane. Every layout
 * claim about this notice would otherwise be a claim about a `return null`. The first time it has
 * rows will be the next signup — which is exactly when a layout bug is most expensive, because
 * the thing it is hiding is whether a child is visible to the house.
 *
 * The SHAPES are the point, and they are the ones that crowd a row:
 *   - one handle, so the heading has to read "1 member" rather than "1 members"
 *   - a 24-character handle, which is what pushes the two buttons onto their own line at 375
 *   - three rows, because a notice of one tells you nothing about the gap between them
 *
 * Nothing here writes. `onSet` ignores what it is given and resolves after a tick, which is
 * enough to reach both the busy state and the line that says what the choice did — and leaves
 * the other rows waiting, so that line can be read next to one that has not been answered.
 */
const HANDLES = ['mo', 'a_handle_of_24_charsxxxx', 'granny']

export function AgeNoticePreview() {
  const onSet = () => new Promise<void>((resolve) => setTimeout(resolve, 150))

  return (
    <section className="card dev-bench">
      <p className="muted" style={{ marginTop: 0, fontSize: '0.8rem' }}>
        dev preview — the unknown-age notice, invented handles
      </p>
      <AgeBandNotice handles={HANDLES} onSet={onSet} />
    </section>
  )
}
