export function Resume() {
  return (
    <section className="grid grid-2" style={{gap:'1rem'}}>
      <div className="card">
        <h2 className="section-title">About</h2>
        <p className="muted">Replace this with your summary. Keep it concise and outcome-oriented.</p>
        <ul>
          <li>Role: Frontend Developer</li>
          <li>Location: Remote / City</li>
          <li>Contact: you@example.com</li>
        </ul>
      </div>
      <div className="card">
        <h2 className="section-title">Skills</h2>
        <p>React, TypeScript, Vite, HTML/CSS, Canvas, GitHub Actions</p>
      </div>
      <div className="card" style={{gridColumn:'1 / -1'}}>
        <h2 className="section-title">Experience</h2>
        <ul>
          <li><strong>Company A</strong> — Your role (20XX–20XX) — Key achievements</li>
          <li><strong>Company B</strong> — Your role (20XX–20XX) — Key achievements</li>
        </ul>
      </div>
    </section>
  )
}
