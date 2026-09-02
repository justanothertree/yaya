import { Component, type ReactNode } from 'react'
import { PageLoadError, retryLazyPages, type LoadFailure } from './lazyRetry'

/**
 * What a visitor sees when something below here throws.
 *
 * ⚠️ SCOPE IS THE WHOLE POINT. A boundary around the entire app turns any one broken page into a
 * dead site: the call ends, the music stops, and the only way back is a refresh. Calls and audio
 * deliberately live ABOVE the pages (see CallDock and AudioDock in App) precisely so they outlive
 * whatever screen you started them on — and a top-level boundary throws that design away at the
 * first thrown error. So the page-level one sits INSIDE the shell, and a page that breaks takes
 * only itself down.
 *
 * ⚠️ IT HAS TO BE ABLE TO RECOVER. React keeps a boundary tripped once it catches, so without a
 * reset a single bad page stays broken behind every tab clicked afterwards — the boundary is still
 * holding an error from a screen you have already left. `resetKey` clears it on navigation.
 *
 * ⚠️ IT ONLY OFFERS WHAT CAN ACTUALLY WORK. A chunk that 404s after a deploy cannot be retried at
 * all (see lazyRetry: the browser holds the failure against that url for the life of the page), so
 * that case gets a refresh button and no false promise. A page that failed because the network
 * dropped genuinely can be retried, so that one gets both.
 */

type Props = {
  children: ReactNode
  /** Changes when the visitor moves somewhere else, which clears a stale failure. */
  resetKey?: string | number
  /** True for the boundary inside the shell, where a call may still be running above it. */
  scoped?: boolean
}
type State = { error: unknown; had: boolean }

const WORDING: Record<LoadFailure | 'unknown', { title: string; detail: string }> = {
  gone: {
    title: 'The site updated while you were here',
    detail:
      'This tab is still running the old version, so that page is no longer where it was. Refreshing picks up the new one.',
  },
  offline: {
    title: "Couldn't reach the site",
    detail: 'That page still needs to be fetched, and the connection dropped on the way.',
  },
  broken: {
    title: "That page wouldn't start",
    detail: 'It downloaded, but something in it failed on the way up.',
  },
  unknown: {
    title: 'That page had a problem',
    detail: 'The rest of the site is fine — this is just the page you were opening.',
  },
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, had: false }

  static getDerivedStateFromError(error: unknown) {
    return { error, had: true }
  }

  componentDidCatch(error: unknown) {
    console.error('App error:', error)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.had && prev.resetKey !== this.props.resetKey) this.clear()
  }

  /** Navigating away: the next page's chunk is its own, so nothing needs re-fetching. */
  clear = () => this.setState({ error: null, had: false })

  /**
   * The button. Unlike a navigation reset this DISCARDS the failed page load first, because React
   * caches a rejected lazy component permanently — without it the button would appear to do
   * something and then show the same error forever.
   */
  tryAgain = () => {
    retryLazyPages()
    this.clear()
  }

  render() {
    if (!this.state.had) return this.props.children

    const reason = this.state.error instanceof PageLoadError ? this.state.error.reason : 'unknown'
    const { title, detail } = WORDING[reason]
    /* a chunk that is genuinely gone needs new html — offering a retry would be a button that
       cannot succeed */
    const canRetry = reason !== 'gone'

    return (
      <div className="container">
        <section className="card">
          <h2>{title}</h2>
          <p className="muted">{detail}</p>
          {this.props.scoped && (
            <p className="muted">
              Anything already running — a call, or the music — is still going, and refreshing is
              what would stop it. Finish up first if you're in the middle of something.
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {canRetry && (
              <button className="btn" onClick={this.tryAgain}>
                Try again
              </button>
            )}
            <button className="btn" onClick={() => window.location.reload()}>
              Refresh the page
            </button>
          </div>
        </section>
      </div>
    )
  }
}
