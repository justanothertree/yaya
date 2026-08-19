import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary'
// DEV-only: exposes the profile look helpers on window so they can be exercised without a
// signed-in profile page. Tree-shaken out of production by the import.meta.env.DEV guard inside.
import './dev/lookProbe'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
