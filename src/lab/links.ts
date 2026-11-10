/** this page's address without its hash, for building a link to a Lab toy */
export const here = () => `${location.origin}${location.pathname}`

/** the value of one parameter in a `#lab?…` address, or null */
export function hashParam(name: string, hash = location.hash): string | null {
  const m = /^#lab\?(.*)$/.exec(hash)
  return m ? new URLSearchParams(m[1]).get(name) : null
}
