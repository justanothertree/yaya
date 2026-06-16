// Placeholder for the family "dollar-a-day" investments dashboard.
// The real UI is built later; this keeps the `Investments` named export valid
// so App.tsx's lazy import resolves and the project type-checks / builds.
export function Investments() {
  return (
    <div className="card">
      <h2 className="section-title" style={{ marginTop: 0 }}>
        Investments
      </h2>
      <p className="muted" style={{ marginBottom: 0 }}>
        The family dollar-a-day portfolio is coming soon.
      </p>
    </div>
  )
}
