import { useState, useSyncExternalStore } from 'react'
import type { KitStore, Named } from './savedKits'

/**
 * Save what you have set up, and press one to get it back.
 *
 * ⚠️ ONE COMPONENT FOR EVERY ROOM, because the interaction is genuinely the same one: name it,
 * keep it, press it, delete it. What differs between Paint and the instrument room is only what a
 * kit CONTAINS, which is why capture and apply are handed in rather than known here — this file
 * has no idea what a brush or an octave is, and cannot fall out of step with either.
 *
 * Deliberately not a dialog. These are settings you change while working, so a row that sits with
 * the other controls costs one press; anything modal costs three and stops being used.
 */
export function KitBar<T extends Named>({
  store,
  capture,
  apply,
  describe,
  placeholder,
}: {
  store: KitStore<T>
  /** Everything currently set up, under this name. */
  capture: (name: string) => T
  apply: (kit: T) => void
  /** The one-line summary under the name — what pressing it will actually do. */
  describe: (kit: T) => string
  placeholder: string
}) {
  const kits = useSyncExternalStore(store.subscribe, store.all, store.all)
  const [name, setName] = useState('')

  const save = () => {
    if (!name.trim()) return
    store.save(capture(name))
    setName('')
  }

  return (
    <div className="kitbar">
      <div className="kitbar-save">
        <input
          className="kitbar-input"
          value={name}
          maxLength={40}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            /* the site reads arrow keys as navigation and space as a shortcut in both of these
               rooms, and this is a text field */
            e.stopPropagation()
            if (e.key === 'Enter') save()
          }}
        />
        <button className="btn" disabled={!name.trim()} onClick={save}>
          Save
        </button>
      </div>
      {kits.length > 0 && (
        <div className="kitbar-list">
          {kits.map((k) => (
            <div className="kitbar-kit" key={k.name}>
              <button className="kitbar-btn" onClick={() => apply(k)}>
                <span className="kitbar-name">{k.name}</span>
                <span className="kitbar-desc muted">{describe(k)}</span>
              </button>
              <button
                className="btn btn-ghost kitbar-del"
                onClick={() => store.remove(k.name)}
                aria-label={`Delete ${k.name}`}
                title="Delete"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
