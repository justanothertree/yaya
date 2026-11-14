/** this page's address without its hash, for building a link to a Lab toy */
export const here = () => `${location.origin}${location.pathname}`

/** the value of one parameter in a `#lab?…` address, or null */
export function hashParam(name: string, hash = location.hash): string | null {
  const m = /^#lab\?(.*)$/.exec(hash)
  return m ? new URLSearchParams(m[1]).get(name) : null
}

/**
 * The address to show once `id` is picked, or null to leave the address as it is.
 *
 * ⚠️ ONLY ON THE LAB'S OWN PAGE. The Lab also opens inside a canvas window over some other page,
 * and that page's address is not the Lab's to change.
 *
 * ⚠️ AND IT NAMES THE TOY ALONE. Whatever else the address held — a "beat my run" seed, a putt
 * hole — belonged to the toy that was showing, and means nothing to the next one. Picking the
 * toy that is already named changes nothing, so its own settings stay.
 */
export function toyHash(hash: string, id: string): string | null {
  if (!/^#lab(\?|$)/.test(hash)) return null
  if (hashParam('demo', hash) === id) return null
  return `#lab?${new URLSearchParams({ demo: id })}`
}

/**
 * Fired on window when the Lab names a different toy. The address is replaced rather than pushed
 * (see GpuLab's pick), which fires no hashchange, so whoever needs to know listens for this.
 */
export const TOY_EVENT = 'lab:toy'

/** the toy the address names, on the Lab's own page; null anywhere else */
export const currentToy = (hash = location.hash): string | null =>
  /^#lab(\?|$)/.test(hash) ? hashParam('demo', hash) : null
