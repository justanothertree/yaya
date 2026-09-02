import { useSyncExternalStore } from 'react'
import { getSupabaseClient } from '../finance/client'
import { DEFAULT_HOME, readHomeDoc, type HomeDoc } from './homeContent'

/**
 * The home page's text, as published.
 *
 * ⚠️ THE PAGE MUST NEVER WAIT FOR THIS. It starts on the built-in defaults, which are the page as
 * written in the repo, and only swaps in whatever is stored once that arrives. A front page that
 * renders empty headings while a fetch is in flight — or forever, if the fetch fails — is a worse
 * page than one that is simply a version behind.
 *
 * ⚠️ Read straight from the table, written only through an rpc. The row is world-readable on
 * purpose: this is the public front page. Writing is the part that needs a gate, and putting that
 * gate in a SECURITY DEFINER function keeps it in one place on the server rather than in a policy
 * that a future table change could quietly widen.
 */

export type HomeState = {
  /**
   * What the page renders: the published document, or a draft while an admin is editing.
   *
   * ⚠️ SEPARATE FROM `published`, and that separation is the whole of the draft guarantee. These
   * were one field, and previewing therefore OVERWROTE the published copy — so closing the editor
   * had nothing to go back to and an unpublished edit stayed on screen looking published.
   * Measured: leaving the editor left the changed headline in place.
   */
  doc: HomeDoc
  /** what the server last gave us, untouched by editing */
  published: HomeDoc
  /** true once we know what the server has (or that it has nothing) */
  loaded: boolean
  /** the store is not set up yet — the one-time SQL has not been run */
  missing: boolean
}

let state: HomeState = {
  doc: DEFAULT_HOME,
  published: DEFAULT_HOME,
  loaded: false,
  missing: false,
}
const listeners = new Set<() => void>()

function set(patch: Partial<HomeState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export const homeStore = {
  getState: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

let started = false

/** Fetch once per page load. Safe to call from several components. */
export function loadHome() {
  if (started) return
  started = true
  void getSupabaseClient()
    .from('site_content')
    .select('doc')
    .eq('id', 'home')
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) {
        /**
         * ⚠️ A missing table is not an error worth showing anyone. Until the one-time SQL is run
         * this is simply a site whose home page comes from the repo, which is exactly what it was
         * before. Only the editor mentions it, because only the editor can act on it.
         */
        set({ loaded: true, missing: true })
        return
      }
      const doc = data?.doc ? readHomeDoc(data.doc) : DEFAULT_HOME
      set({ doc, published: doc, loaded: true, missing: false })
    })
}

/** Publish. Admin-only, enforced on the server — this call simply reports what it says. */
export async function saveHome(doc: HomeDoc): Promise<string | null> {
  const { error } = await getSupabaseClient().rpc('save_site_content', {
    p_id: 'home',
    p_doc: doc,
  })
  if (error) return error.message
  set({ doc, published: doc, loaded: true, missing: false })
  return null
}

/**
 * Show a draft on the real page without publishing it. `null` puts the published text back.
 *
 * ⚠️ Never touches `published`, so leaving the editor is always able to undo an unpublished edit
 * — which is the only thing standing between a keystroke and the public front page.
 */
export function previewHome(draft: HomeDoc | null) {
  set({ doc: draft ?? state.published })
}

/**
 * The published document, re-rendering when it arrives or an admin changes it.
 *
 * ⚠️ `homePanes()` in EvanCook is a plain function, not a component, because canvas mode builds
 * its windows outside the React tree — so it reads `homeStore.getState()` directly and App
 * subscribes on its behalf. Without that subscription the canvas would keep whatever text it was
 * built with and quietly disagree with the same page rendered normally.
 */
export function useHomeDoc(): HomeDoc {
  return useSyncExternalStore(homeStore.subscribe, () => homeStore.getState().doc)
}
