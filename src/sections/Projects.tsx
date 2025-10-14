import { useState } from 'react'
import projects from './projects.json'

type Project = {
  title: string
  desc: string
  link: string
  linkText: string
  details?: string[]
}

export function Projects() {
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  return (
    <section className="grid grid-3" style={{ gap: '1rem' }}>
      {projects.map((p: Project, i: number) => {
        const open = openIdx === i
        return (
          <article className="card" key={i}>
            <h2
              className="section-title"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span>{p.title}</span>
              {p.details && (
                <button
                  className="btn"
                  style={{ padding: '0.3rem 0.6rem' }}
                  onClick={() => setOpenIdx(open ? null : i)}
                  aria-expanded={open}
                  aria-controls={`proj-${i}`}
                >
                  {open ? 'Hide' : 'Details'}
                </button>
              )}
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
            {p.details && (
              <div
                id={`proj-${i}`}
                className={`reveal ${open ? 'reveal-in' : ''}`}
                style={{ marginTop: '0.75rem' }}
              >
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
