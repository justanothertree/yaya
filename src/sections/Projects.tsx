
import projects from './projects.json'

type Project = {
  title: string
  desc: string
  link: string
  linkText: string
}

export function Projects() {
  return (
    <section className="grid grid-3" style={{ gap: '1rem' }}>
      {projects.map((p: Project, i: number) => (
        <article className="card" key={i}>
          <h2 className="section-title">{p.title}</h2>
          <p className="muted">{p.desc}</p>
          {p.link.startsWith('http') ? (
            <a className="btn" href={p.link} target="_blank" rel="noreferrer">{p.linkText}</a>
          ) : (
            <a className="btn" href={p.link}>{p.linkText}</a>
          )}
        </article>
      ))}
    </section>
  )
}
