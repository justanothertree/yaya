/**
 * What a failed `functions.invoke` amounts to, read off the error supabase-js hands back.
 *
 * ⚠️ A FUNCTION'S REFUSAL IS IN ITS BODY, NOT IN `error.message`. supabase-js reports a non-2xx
 * from `functions.invoke` as "Edge Function returned a non-2xx status code" and puts the response
 * on the error — so every ceiling a function's RPC raises would arrive as that one useless
 * sentence unless the body is read. The ceilings are written to be read by a person; this is what
 * lets them be.
 *
 * ⚠️ HERE RATHER THAN IN pictures/cloud.ts, where it was born and private, because a second
 * function's client (circuit/chatSongs.ts) needs the same reading and more of it: the STATUS, and
 * whether there was a response at all. Importing pictures/cloud.ts for it would have pulled the
 * picture squeezer and its workbench into the chat's chunk.
 */
export type FunctionFailure = {
  /**
   * The HTTP status, or null when no response arrived at all: a dropped connection, or a preflight
   * the browser refused — which, for a function that is not deployed, is what a 404 LOOKS like from
   * a page (see chatSongs.ts `deployed`).
   */
  status: number | null
  /** the function's own sentence, `{error}` in its body */
  said: string | null
  /** the platform's own code — the `sb-error-code` header, or `code` in its body (`NOT_FOUND`) */
  code: string | null
  /** supabase-js's own message, the last resort */
  message: string | null
}

export async function readFunctionError(error: unknown): Promise<FunctionFailure> {
  const message = (error as { message?: unknown })?.message
  const out: FunctionFailure = {
    status: null,
    said: null,
    code: null,
    message: typeof message === 'string' ? message : null,
  }
  const res = (error as { context?: Response })?.context
  /* a FunctionsFetchError carries the fetch's own TypeError here, which has neither */
  if (!res || typeof res.json !== 'function' || typeof res.status !== 'number') return out
  out.status = res.status
  out.code = res.headers?.get?.('sb-error-code') ?? null
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown } | null
    if (body?.error) out.said = String(body.error)
    if (!out.code && typeof body?.code === 'string') out.code = body.code
  } catch {
    /* not json, or already read — the status is still an answer */
  }
  return out
}

/** The sentence to show for a function that said no, or `fallback` when it said nothing usable. */
export async function sayFunctionError(error: unknown, fallback: string): Promise<string> {
  const f = await readFunctionError(error)
  if (f.said) return f.said
  return f.message && !/non-2xx/i.test(f.message) ? f.message : fallback
}
