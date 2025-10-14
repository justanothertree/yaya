import projects from './projects.json'

type Project = {
  title: string
  desc: string
  link: string
  linkText: string
  details?: string[]
}

export function Projects() {
  return (
    <section className="grid grid-3" style={{ gap: '1rem' }}>
      {projects.map((p: Project, i: number) => {
        return (
          <article className="card" key={i}>
            <h2
              className="section-title"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span>{p.title}</span>
            </h2>
            <p className="muted">{p.desc}</p>
            {p.link.startsWith('http') ? (
              <a className="btn" href={p.link} target="_blank" rel="noreferrer">
                {p.linkText}
              </a>
            ) : (
              <a className="btn" href={p.link}>
                {p.linkText}
              </a>
            )}
            {p.details && p.details.length > 0 && (
              <div id={`proj-${i}`} className="reveal reveal-in" style={{ marginTop: '0.75rem' }}>
                <ul style={{ marginTop: 0 }}>
                  {p.details.map((d: string, idx: number) => (
                    <li key={idx} className="muted">
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        )
      })}
    </section>
  )
}
