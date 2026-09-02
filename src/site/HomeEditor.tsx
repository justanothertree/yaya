import { useEffect, useState } from 'react'
import { projects as builtInProjects } from '../sections/work'
import {
  DEFAULT_HOME,
  HOME_DOC_LIMIT,
  safeShotSrc,
  type HomeDoc,
  type ProjectEdit,
} from './homeContent'
import { homeStore, previewHome, saveHome } from './homeStore'

/**
 * Editing the front page, on the front page.
 *
 * ⚠️ SAME IDEA AS THE PROFILE EDITOR, and for the same reason it was rebuilt: what you change has
 * to be visible where it will actually appear. So this panel writes its draft straight into the
 * store the page renders from — type in the heading field and the real heading above changes as
 * you type. Nothing is published until you press Publish.
 *
 * ⚠️ A DRAFT IS NOT A PUBLISH, and the difference is load-bearing here in a way it is not on a
 * profile. This is the public front door, so an accidental keystroke must not be live to the
 * world the moment it happens. Leaving without publishing puts the published text back.
 *
 * ⚠️ Projects are reordered and hidden, never written. The document stores an order, a hidden
 * list and the text that differs — see homeContent. A project added to the repo later still turns
 * up on its own; if this stored copies of them, it never would.
 */

const MAX_PARAGRAPHS = 8

export function HomeEditor({ onClose }: { onClose: () => void }) {
  const published = homeStore.getState().published
  const missing = homeStore.getState().missing
  const [draft, setDraft] = useState<HomeDoc>(published)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [openProject, setOpenProject] = useState<string | null>(null)

  /* the page below renders the draft while this is open, and the published text again after */
  useEffect(() => {
    previewHome(draft)
  }, [draft])
  useEffect(
    () => () => {
      previewHome(null)
    },
    [],
  )

  const size = JSON.stringify(draft).length
  const tooBig = size > HOME_DOC_LIMIT

  const setHero = (patch: Partial<HomeDoc['hero']>) =>
    setDraft((d) => ({ ...d, hero: { ...d.hero, ...patch } }))
  const setAbout = (patch: Partial<HomeDoc['about']>) =>
    setDraft((d) => ({ ...d, about: { ...d.about, ...patch } }))
  const setEdit = (id: string, patch: Partial<ProjectEdit>) =>
    setDraft((d) => ({
      ...d,
      projects: {
        ...d.projects,
        edits: { ...d.projects.edits, [id]: { ...d.projects.edits[id], ...patch } },
      },
    }))

  /** built-in order, with the document's order applied — the list this panel actually shows */
  const ordered = [...builtInProjects].sort((a, b) => {
    const r = draft.projects.order
    const ra = r.indexOf(a.id) === -1 ? Number.MAX_SAFE_INTEGER : r.indexOf(a.id)
    const rb = r.indexOf(b.id) === -1 ? Number.MAX_SAFE_INTEGER : r.indexOf(b.id)
    return ra - rb
  })

  const moveProject = (id: string, dir: -1 | 1) => {
    const ids = ordered.map((p) => p.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setDraft((d) => ({ ...d, projects: { ...d.projects, order: ids } }))
  }

  const toggleHidden = (id: string) =>
    setDraft((d) => ({
      ...d,
      projects: {
        ...d.projects,
        hidden: d.projects.hidden.includes(id)
          ? d.projects.hidden.filter((x) => x !== id)
          : [...d.projects.hidden, id],
      },
    }))

  const publish = async () => {
    setStatus('saving')
    setErr(null)
    const message = await saveHome(draft)
    if (message) {
      setErr(message)
      setStatus('idle')
      return
    }
    setStatus('saved')
    window.setTimeout(() => setStatus('idle'), 3000)
  }

  return (
    <section className="card home-editor">
      <div className="profile-editor-head">
        <h3>This page</h3>
        <p className="muted">
          Changes show above as you type. Nothing is public until you press Publish.
        </p>
      </div>

      {missing && (
        <p className="muted home-editor-note">
          ⚠️ The store for this is not set up yet, so Publish will fail. Everything else works —
          what you change here is a preview in this browser only. The one-time SQL is in the commit
          message that added this.
        </p>
      )}

      <label className="home-field">
        <span className="muted">Headline</span>
        <input
          value={draft.hero.heading}
          maxLength={200}
          onChange={(e) => setHero({ heading: e.target.value })}
        />
      </label>
      <label className="home-field">
        <span className="muted">Underneath it</span>
        <textarea
          rows={3}
          value={draft.hero.blurb}
          maxLength={2000}
          onChange={(e) => setHero({ blurb: e.target.value })}
        />
      </label>

      <label className="home-field">
        <span className="muted">About — heading</span>
        <input
          value={draft.about.heading}
          maxLength={200}
          onChange={(e) => setAbout({ heading: e.target.value })}
        />
      </label>
      {draft.about.paragraphs.map((text, i) => (
        <label className="home-field" key={i}>
          <span className="muted">About — paragraph {i + 1}</span>
          <textarea
            rows={3}
            value={text}
            maxLength={2000}
            onChange={(e) =>
              setAbout({
                paragraphs: draft.about.paragraphs.map((p, n) => (n === i ? e.target.value : p)),
              })
            }
          />
          {/* a grid cell stretches its child, and a destructive action does not want the full
              width of the panel */}
          <button
            className="btn btn-ghost home-field-remove"
            onClick={() =>
              setAbout({ paragraphs: draft.about.paragraphs.filter((_, n) => n !== i) })
            }
          >
            Remove this paragraph
          </button>
        </label>
      ))}
      <button
        className="btn"
        disabled={draft.about.paragraphs.length >= MAX_PARAGRAPHS}
        onClick={() => setAbout({ paragraphs: [...draft.about.paragraphs, ''] })}
      >
        + Another paragraph
      </button>

      <h4 className="home-editor-sub">Projects</h4>
      <p className="muted home-editor-hint">
        Reorder them, hide one, or rewrite what it says. The projects themselves live in the code —
        this only records what you changed, so a new one still appears on its own.
      </p>

      <div className="home-projects">
        {ordered.map((p, i) => {
          const hidden = draft.projects.hidden.includes(p.id)
          const e = draft.projects.edits[p.id] ?? {}
          const open = openProject === p.id
          return (
            <div key={p.id} className={'home-project' + (hidden ? ' is-hidden' : '')}>
              <div className="home-project-head">
                <button
                  className="home-project-name"
                  aria-expanded={open}
                  onClick={() => setOpenProject(open ? null : p.id)}
                >
                  {e.title || p.title}
                </button>
                <span className="home-project-tools">
                  <button
                    className="btn"
                    onClick={() => moveProject(p.id, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${p.title} up`}
                  >
                    ↑
                  </button>
                  <button
                    className="btn"
                    onClick={() => moveProject(p.id, 1)}
                    disabled={i === ordered.length - 1}
                    aria-label={`Move ${p.title} down`}
                  >
                    ↓
                  </button>
                  <button
                    className={'btn' + (hidden ? '' : ' is-on')}
                    aria-pressed={!hidden}
                    onClick={() => toggleHidden(p.id)}
                    title={hidden ? 'Show this project' : 'Hide this project'}
                  >
                    {hidden ? 'Hidden' : 'Shown'}
                  </button>
                </span>
              </div>

              {open && (
                <div className="home-project-body">
                  <label className="home-field">
                    <span className="muted">Title</span>
                    <input
                      value={e.title ?? p.title}
                      maxLength={200}
                      onChange={(ev) => setEdit(p.id, { title: ev.target.value })}
                    />
                  </label>
                  <label className="home-field">
                    <span className="muted">One-liner</span>
                    <input
                      value={e.tagline ?? p.tagline}
                      maxLength={200}
                      onChange={(ev) => setEdit(p.id, { tagline: ev.target.value })}
                    />
                  </label>
                  <label className="home-field">
                    <span className="muted">Write-up</span>
                    <textarea
                      rows={4}
                      value={(e.blurb ?? p.blurb).join('\n\n')}
                      maxLength={4000}
                      onChange={(ev) =>
                        setEdit(p.id, {
                          blurb: ev.target.value.split(/\n{2,}/).slice(0, MAX_PARAGRAPHS),
                        })
                      }
                    />
                    <span className="muted home-editor-hint">A blank line starts a paragraph.</span>
                  </label>

                  {/**
                   * ⚠️ A PATH ON THIS SITE, and the field says so. This value goes into an img on
                   * the public front page: a full url would let the front door pull a picture
                   * from somebody else's server, handing them every visitor's IP and referrer and
                   * control of what looks like my work. safeShotSrc rejects anything that is not
                   * a same-site path, on the way in AND on the way back out of storage.
                   */}
                  {p.shots.map((s, n) => (
                    <label className="home-field" key={n}>
                      <span className="muted">
                        Slide {n + 1} — “{s.label}” picture
                      </span>
                      <input
                        placeholder="/shots/circuit-board.png"
                        value={e.shots?.[n]?.src ?? s.src ?? ''}
                        onChange={(ev) => {
                          const shots = [...(e.shots ?? p.shots.map(() => ({})))]
                          shots[n] = { ...shots[n], src: ev.target.value }
                          setEdit(p.id, { shots })
                        }}
                      />
                      {!!(e.shots?.[n]?.src ?? '') && !safeShotSrc(e.shots?.[n]?.src) && (
                        <span className="profile-editor-err">
                          Needs to be a path on this site, starting with a single /
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="profile-editor-status" aria-live="polite">
        <span className={err || tooBig ? 'profile-editor-err' : 'muted'}>
          {err
            ? `Couldn’t publish — ${err}`
            : tooBig
              ? 'Too much text to store — shorten something.'
              : status === 'saving'
                ? 'Publishing…'
                : status === 'saved'
                  ? 'Published ✓'
                  : `${Math.round((size / HOME_DOC_LIMIT) * 100)}% of the room this page has`}
        </span>
        <span className="home-editor-actions">
          <button className="btn" onClick={publish} disabled={tooBig || status === 'saving'}>
            Publish
          </button>
          <button className="btn btn-ghost" onClick={() => setDraft(DEFAULT_HOME)}>
            Back to the built-in text
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </span>
      </div>
    </section>
  )
}
