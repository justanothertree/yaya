import {
  createElement,
  lazy,
  useSyncExternalStore,
  type ComponentProps,
  type ComponentType,
  type LazyExoticComponent,
} from 'react'

/**
 * A lazily-loaded page that survives a bad moment on the network.
 *
 * ⚠️ SUSPENSE HANDLES *PENDING*, NOT *REJECTED*. A lazy import that has not arrived yet shows the
 * fallback; a lazy import that FAILS throws, and the nearest error boundary swallows the page. One
 * dropped request — a phone changing masts, a flaky cafe router — used to mean a dead page until a
 * manual refresh, and a refresh is the exact thing worth avoiding, because it ends calls and stops
 * the music.
 *
 * ⚠️ THE COMMON CAUSE IS A DEPLOY, NOT THE NETWORK. Chunk filenames carry a content hash, so a tab
 * opened before an update is holding URLs that no longer exist on the server.
 *
 * ⚠️ THE BROWSER REMEMBERS A FAILED MODULE, AND THIS IS THE WHOLE DESIGN. Measured, not assumed:
 * with the file restored and answering 200, `import('/assets/PaintRoom-DCT7zjH9.js')` still failed,
 * while the SAME url with `?retry=1` on the end loaded fine. Once a module script fails, the
 * browser's module map holds that failure against that exact specifier for the life of the page.
 * So plainly retrying the same import can never work, and neither can any "try again" button built
 * on one — a different specifier is the only way back to the network, which is what the cache-bust
 * below is for.
 *
 * ⚠️ Only the failing chunk's own url gets the query. Its imports resolve normally and stay shared,
 * so recovering a page does not hand it a second private copy of the audio graph or the call.
 *
 * ⚠️ React.lazy also caches a rejection forever — its own separate layer of the same trap. The
 * generation counter throws the failed wrapper away so a retry reaches the loader at all.
 */

const RETRIES = 2
const BACKOFF_MS = 400

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Why a page would not load, so the boundary can say something true about it. */
export type LoadFailure = 'gone' | 'offline' | 'broken'

export class PageLoadError extends Error {
  reason: LoadFailure
  constructor(reason: LoadFailure, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'PageLoadError'
    this.reason = reason
  }
}

let generation = 0
const listeners = new Set<() => void>()
const getGeneration = () => generation
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Discard every failed page load so the next render genuinely reaches the network again. */
export function retryLazyPages() {
  generation++
  listeners.forEach((l) => l())
}

/** Browsers word this differently, so match the vocabulary they share. */
export function isChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err ?? '')
  /* "unable to preload css" is the same failure wearing a different coat: a page with its own
     stylesheet chunk fails on the STYLESHEET before its javascript is ever requested, and says so
     in wording that shares none of the vocabulary of a failed module. Measured on Snake. */
  return /chunkload|dynamically imported module|module script failed|importing a module|unable to preload/i.test(
    msg,
  )
}

/**
 * The asset the browser names in the failure, which is the one to ask for again.
 *
 * ⚠️ Absolute url OR root-relative path. A failed module is reported with a full url, a failed
 * stylesheet with a bare `/assets/….css`, so matching only the first form silently skipped every
 * css failure and sent it to the generic "had a problem" wording.
 */
function assetFrom(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return msg.match(/https?:\/\/[^\s'")]+|\/[^\s'")]+\.(?:js|mjs|css)/)?.[0] ?? null
}

const isCss = (asset: string) => /\.css(\?|$)/i.test(asset)
const bustedUrl = (asset: string, tag: string) =>
  `${asset}${asset.includes('?') ? '&' : '?'}retry=${tag}`

/**
 * Put the stylesheet back by hand, under a url the browser has no failure recorded against.
 *
 * ⚠️ Vite's preloader marks a dependency as seen BEFORE it knows whether it loaded, so a retry
 * skips the stylesheet rather than re-requesting it — the page would come back unstyled. Adding
 * the link here means the styles are really present before the page is asked for again.
 */
async function addStylesheet(asset: string, tag: string): Promise<void> {
  const href = bustedUrl(asset, tag)
  /**
   * ⚠️ Confirm it is really css before trusting a <link> to tell you. Measured: with the file
   * deleted and the host falling back to index.html, the browser accepted that page AS a
   * stylesheet, fired `load`, and left an empty sheet behind — 0 rules, no error anywhere. Waiting
   * on `onload` alone would therefore report success and hand back a page with no styling, which
   * reads as a broken site rather than a stale tab.
   */
  const res = await fetch(href, { cache: 'no-store' })
  if (!res.ok || !/css/i.test(res.headers.get('content-type') ?? ''))
    throw new Error(`stylesheet unavailable: ${asset}`)

  await new Promise<void>((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onload = () => resolve()
    link.onerror = () => reject(new Error(`stylesheet still unavailable: ${asset}`))
    document.head.appendChild(link)
  })
}

/**
 * Stylesheets that failed and have not been put back yet.
 *
 * ⚠️ A RECOVERED PAGE MUST BRING ITS STYLES WITH IT. Vite marks a dependency as seen before it
 * knows whether it loaded, so once a stylesheet has failed, every later attempt at that page
 * skips it — the javascript comes back, the page renders, and none of its own css is there.
 * Measured on Snake: after recovery `.snake-toolbar` was laid out as `display: block` instead of
 * `flex`, because its 10kb chunk had been quietly written off. So a failure is remembered here and
 * retried on the next successful load, where the network is evidently working again.
 */
const pendingCss = new Set<string>()

async function restorePending(tag: string): Promise<void> {
  for (const asset of [...pendingCss]) {
    try {
      await addStylesheet(asset, tag)
      pendingCss.delete(asset)
    } catch {
      /* still unreachable — keep it for the next time a page loads */
    }
  }
}

/**
 * Whether the file is missing or the network is. Worth one HEAD request, because it decides
 * whether a retry could ever help — a deploy needs new html, a dead connection just needs a
 * moment — and it is the difference between a useful sentence and "something went wrong".
 */
async function diagnose(url: string): Promise<LoadFailure> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    if (!res.ok) return 'gone'
    /**
     * ⚠️ A MISSING CHUNK USUALLY ANSWERS 200, NOT 404. Static hosts serve single-page apps by
     * falling back to index.html for anything they cannot find — Netlify, Vercel, Cloudflare and
     * vite preview all do it — so the request for a chunk deleted by a deploy comes back as a
     * page, cheerfully, with an ok status. Measured here: the deleted file returned 200 text/html.
     * Trusting the status alone would call every stale deploy 'broken' and offer a retry that
     * cannot work, so what matters is whether the answer is JAVASCRIPT.
     */
    const type = res.headers.get('content-type') ?? ''
    return /javascript|ecmascript/i.test(type) ? 'broken' : 'gone'
  } catch {
    return 'offline'
  }
}

/**
 * The module a page's chunk exports, kept GENERIC so the picker below is properly typed. Widening
 * it to `Record<string, unknown>` would make every `(m) => m.Thing` an `unknown`, and every page's
 * props would collapse to `any` at its render site.
 */
/**
 * ⚠️ THE EXPORT IS PICKED HERE, NOT IN THE LOADER. This used to read
 * `import('./X').then((m) => ({ default: m.X }))`, which put the mapping inside the thunk — so the
 * recovery path, which imports a DIFFERENT url, came back with the raw module and no `default` at
 * all, and React failed on an undefined component type. Measured: the retry fetched the chunk
 * successfully and the page still broke. Keeping `pick` out here means both routes to the module
 * end up shaped the same way.
 */
async function loadPage<M, T>(
  load: () => Promise<M>,
  pick: (mod: M) => T,
  bust: number,
): Promise<{ default: T }> {
  const shape = (mod: M) => {
    const component = pick(mod)
    if (!component) throw new Error('page module loaded but its export was missing')
    return { default: component }
  }

  /* a page loading proves the network is back, which is the moment to reclaim anything a previous
     failure had to give up on */
  const finish = async (mod: M) => {
    if (pendingCss.size) await restorePending(`restore.${bust}`)
    return shape(mod)
  }

  try {
    return await finish(await load())
  } catch (first) {
    const asset = assetFrom(first)
    /* nothing named means the page's own code threw, not a fetch — there is nothing to re-request */
    if (!asset || !isChunkError(first)) throw first
    if (isCss(asset)) pendingCss.add(asset)

    for (let attempt = 0; attempt < RETRIES; attempt++) {
      await sleep(BACKOFF_MS * (attempt + 1))
      const tag = `${bust}.${attempt}`
      try {
        /* a stylesheet cannot be imported, so put it back by hand and ask for the page again —
           the loader skips the dependency it already believes it has and fetches the javascript */
        if (isCss(asset)) {
          await addStylesheet(asset, tag)
          pendingCss.delete(asset)
          return shape(await load())
        }
        return await finish((await import(/* @vite-ignore */ bustedUrl(asset, tag))) as M)
      } catch {
        /* keep going; the diagnosis below explains the final failure */
      }
    }
    throw new PageLoadError(await diagnose(asset), first)
  }
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any --
   mirrors React.lazy's own signature: narrowing the props to `unknown` here would erase every
   page's props at the call site, which is worse than the `any` React itself uses. */
export function lazyRetry<M, T extends ComponentType<any>>(
  load: () => Promise<M>,
  pick: (mod: M) => T,
) {
  const built = new Map<number, LazyExoticComponent<T>>()

  return function RetryablePage(props: ComponentProps<T>) {
    const gen = useSyncExternalStore(subscribe, getGeneration, getGeneration)
    let Page = built.get(gen)
    if (!Page) {
      Page = lazy(() => loadPage(load, pick, gen))
      built.clear() /* only the newest generation is ever rendered */
      built.set(gen, Page)
    }
    return createElement(Page, props)
  }
}
