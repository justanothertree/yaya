/**
 * The relay's flood gate: who is allowed to open a socket, and how the caller is identified.
 *
 * ⚠️ THIS IS HERE BECAUSE IT CANNOT BE CHECKED WHERE IT WAS. ws-server.js opens a listening
 * socket at import, so nothing can ask it a question without starting a server — and the one
 * thing this decision most needed was to be asked. Its own note in that file says the ceiling
 * "cannot be verified from the client side": Render's proxy completes the handshake with the
 * caller and swallows our close, so a refused socket looks open for twelve seconds.
 *
 * ⚠️ AND WHAT THAT COST WAS NOT A BUG BUT A FICTION ABOUT ONE. Three deploys went into fixing a
 * limiter that was working correctly the whole time, and the explanation written down for why
 * it "wasn't working" — that the rightmost x-forwarded-for entry varied per connection, so
 * every caller got a fresh budget — was itself wrong, and ws-server.js retracts it in as many
 * words. Measured instead of reasoned about: Render sends a SINGLE entry holding the client
 * address and no appended hops, with the socket address showing 127.0.0.1 because the proxy
 * reaches the relay over loopback. Leftmost and rightmost are the same value on this
 * deployment, and the choice does not matter today.
 *
 * A decision with that history belongs where a test can call it directly. Nothing here changed
 * when it moved: same window arithmetic, same `<=`, same `<` and `>=` at the two boundaries,
 * which are not interchangeable and are now pinned by tests at both ends.
 *
 * ⚠️ `pid` IS NOT PART OF THE VERDICT ANY MORE, and that is the only difference. The caller puts
 * `process.pid` on its own log line, because an in-memory counter bounds nothing once there is
 * more than one process — if this relay is ever scaled past a single instance, those lines show
 * several pids each counting to its own ceiling, and the per-address limit has to move to shared
 * state or give way to the global one.
 */

/**
 * The address a connection is counted against.
 *
 * ⚠️ IT IS THE FIRST ENTRY, AND ONLY WHEN A PROXY IS TRUSTED. `x-forwarded-for` is a list the
 * client can prepend to, so the leftmost entry is the one the caller claims and the rightmost is
 * whatever spoke to our proxy. Leftmost is chosen because it is the conventional client address
 * and because it stays correct if Render ever starts appending hops — not because the rightmost
 * was measured to be worse; on this deployment they are the same single value. The cost is that
 * it is forgeable, and the global ceiling is what covers that.
 *
 * With `trustProxy` false the header is ignored outright, which is what a relay exposed directly
 * must do — there, the header is simply something the client typed.
 *
 * ⚠️ DO NOT CHANGE WHICH ENTRY THIS TAKES ON REASONING ALONE. Two places report what actually
 * arrives: the `xff` block on the admin-only /relay-config, and the `[relay][addr]` lines the
 * relay prints for its first few connections after a restart. Both exist because this is a
 * header whose shape has been assumed wrongly more than once, in both directions.
 */
export function clientAddr(req, trustProxy = true) {
  const xff = trustProxy ? req?.headers?.['x-forwarded-for'] : null
  if (typeof xff === 'string') {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length) return parts[0]
  }
  return req?.socket?.remoteAddress || 'unknown'
}

/**
 * A sliding-window gate over connections, per address and in total.
 *
 * `perAddr` is the ordinary limit. `globalCap` is the backstop for a forged address: anyone
 * rotating `x-forwarded-for` gets a fresh per-address budget every time, so without it there is
 * no bound on them at all. It sits deliberately far above real use — the busiest hour this relay
 * has ever seen is one player finishing 13 rounds — because a global ceiling is a SHARED FUSE:
 * whoever trips it locks everybody else out too. It exists to stop a flood being unbounded, not
 * to police normal traffic.
 *
 * `now` is a parameter rather than a call to `Date.now()` so a test can move time without
 * sleeping. The relay passes nothing and gets the clock.
 */
export function makeConnGate({ windowMs, perAddr, globalCap }) {
  /** addr -> recent connection timestamps. Emptied by `prune`, which the heartbeat calls. */
  const log = new Map()
  /** every recent connection, regardless of who claimed to open it */
  const all = []

  return {
    allow(addr, now = Date.now()) {
      const recent = (log.get(addr) || []).filter((t) => now - t < windowMs)
      recent.push(now)
      log.set(addr, recent)

      while (all.length && now - all[0] >= windowMs) all.shift()
      all.push(now)

      return {
        ok: recent.length <= perAddr && all.length <= globalCap,
        perAddr: recent.length,
        global: all.length,
      }
    },

    /**
     * Drop what has aged out.
     *
     * ⚠️ The map is itself a leak if nothing empties it — one entry per address, for ever, which
     * is the same shape as the room leak this file once had. Do not let the thing that bounds a
     * flood become the thing a flood grows. An address whose entries have all aged out is
     * deleted rather than left holding an empty array.
     */
    prune(now = Date.now()) {
      for (const [addr, times] of log) {
        const live = times.filter((t) => now - t < windowMs)
        if (live.length) log.set(addr, live)
        else log.delete(addr)
      }
    },

    /** how many addresses are being tracked — the diagnostics endpoint reports this */
    get addresses() {
      return log.size
    },
    /** how many connections are inside the current window, across everybody */
    get inWindow() {
      return all.length
    },
  }
}
