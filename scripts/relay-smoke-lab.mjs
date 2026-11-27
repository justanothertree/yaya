/**
 * What relay-smoke's knock on a Lab table has to see, decided where a test can ask it.
 *
 * relay-smoke.mjs runs at import — it reads the environment, waits on a live relay and exits —
 * so nothing could put a question to its verdicts. They live here instead, pure, and
 * relay-smoke-lab.test.mjs asks them (CLAUDE.md §2: move the decision out rather than conclude it
 * cannot be tested).
 *
 * ⚠️ THE REFUSAL IS THE PROOF, AND ITS CLOSE IS ONLY PROOF WHERE NOTHING SITS IN BETWEEN. The
 * relay says `members-only` and then `ws.close(1008)` in one breath (refuseLab in ws-server.js).
 * Run against a relay on this machine, both must arrive: a 1008 close frame, promptly. Through
 * Render they do not. Measured on 27 Nov 2026 against the live relay: the door's sentence came
 * 12.2 s into the knock, on its timer, and then no close frame at all — the socket ended 1006 at
 * 32.2 s, with no frame and no reason, which is Render's proxy (connGate.test.mjs has the same
 * proxy swallowing a refused socket's close). The same knock on the same code on this machine
 * closes 1008 in the same tenth of a second as the sentence, 12.0 s after the welcome.
 *
 * So behind Render a missing close frame is a WARNING, never a failure, and nothing else is
 * excused: the sentence must be the door's own, word for word, and it must come when the timer
 * says. A close that does arrive must still be 1008 — a frame with another code is somebody
 * saying something else, which the quirk does not cover.
 *
 * ⚠️ "BEHIND RENDER" IS ASKED OF THE ANSWER, NOT GUESSED FROM THE ADDRESS. Render stamps
 * `x-render-origin-server: Render` on what its proxy forwards (seen on /health, 27 Nov), and the
 * proxy is the thing that drops the frame — so a custom domain in front of Render counts, and a
 * relay on 127.0.0.1 never does.
 */

/**
 * How far either side of the door's timer the sentence may land, measured from the `welcome`.
 * The relay sends `welcome` and starts the timer in the same tick (helloLab in ws-server.js), and
 * both frames travel the same socket, so the gap between their arrivals IS the timer — no network
 * latency in it, only whatever delays one frame more than the other. 1 s early covers a welcome
 * held back on a cold socket; 4 s late covers a busy free instance's event loop. Earlier than that
 * would refuse a friend whose token was still on its way; later is a timer that is not the door's.
 */
export const ON_TIME = Object.freeze({ earlyMs: 1000, lateMs: 4000 })

/** How long after the sentence a close frame has to arrive. The relay sends both in one breath. */
export const CLOSE_GRACE_MS = 5000

/** Did this answer come through Render's proxy? Takes a fetch `Headers` (or anything with get). */
export const viaRender = (headers) =>
  /^render$/i.test(String(headers?.get?.('x-render-origin-server') ?? '').trim())

/** The sentence's arrival, `gapMs` after the welcome's, against a timer of `vouchMs`. */
export function refusalOnTime(gapMs, vouchMs) {
  const secs = (ms) => `${(ms / 1000).toFixed(1)} s`
  if (!Number.isFinite(gapMs)) return { ok: false, why: 'the sentence never arrived' }
  if (gapMs < vouchMs - ON_TIME.earlyMs)
    return {
      ok: false,
      why: `the sentence came ${secs(gapMs)} after the welcome, before the ${secs(vouchMs)} timer`,
    }
  if (gapMs > vouchMs + ON_TIME.lateMs)
    return {
      ok: false,
      why: `the sentence came ${secs(gapMs)} after the welcome, late for the ${secs(vouchMs)} timer`,
    }
  return { ok: true, why: `the door’s sentence ${secs(gapMs)} after the welcome` }
}

/**
 * The close that should follow the sentence. `close` is null when none arrived within
 * CLOSE_GRACE_MS, or `{ code }` as `ws` reported it — 1006 being ws's own word for "the
 * connection ended with no close frame".
 *
 * Returns `{ ok, why }`, plus `warn` when it passed only because of Render's proxy.
 */
export function closeVerdict(close, behindRender) {
  const grace = `${CLOSE_GRACE_MS / 1000} s`
  if (close?.code === 1008) return { ok: true, why: 'then a 1008 close' }
  const noFrame = close === null || close?.code === 1006
  if (noFrame && behindRender)
    return {
      ok: true,
      why: 'no close frame (Render)',
      warn:
        close === null
          ? `no close frame within ${grace} of the sentence — Render's proxy drops the relay's close frame, a known quirk; a local run requires the 1008`
          : `the socket ended 1006, with no close frame — Render's proxy drops the relay's close frame, a known quirk; a local run requires the 1008`,
    }
  if (close === null) return { ok: false, why: `the door spoke and no close came within ${grace}` }
  if (close.code === 1006)
    return { ok: false, why: 'the socket ended 1006, with no close frame, not a 1008 close' }
  return { ok: false, why: `the socket closed ${close.code}, not 1008` }
}
