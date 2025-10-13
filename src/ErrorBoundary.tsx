import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: unknown) { console.error('App error:', error) }
  render() {
    if (this.state.hasError) {
      return (
        <div className="container">
          <section className="card">
            <h2>Something went wrong</h2>
            <p className="muted">Please refresh the page. If the issue persists, let me know.</p>
          </section>
        </div>
      )
    }
    return this.props.children
  }
}
