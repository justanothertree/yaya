import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary'
// DEV-only: exposes the profile look helpers on window so they can be exercised without a
// signed-in profile page. Tree-shaken out of production by the import.meta.env.DEV guard inside.
import './dev/lookProbe'

/* DEV-only: a call between tabs of this browser (#dev-call?name=Ann) — see dev/labCall.ts. The
   import sits inside the DEV branch, so a production build has neither the branch nor the file. */
if (import.meta.env.DEV) {
  // read now, before the router sends an address it does not know to #home
  const asked = location.hash
  void import('./dev/labCall').then((m) => m.startIfAsked(asked))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/**
     * The last resort, for a crash in the SHELL itself — the nav, the call dock, the backdrop.
     * Pages have their own boundary inside App (see <main>), which is where a broken page is
     * caught so it does not take the call and the music down with it. This one should almost
     * never be what you see.
     */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
