import type { NetMessage, Settings } from './types'

type Handlers<M> = {
  onOpen?: () => void
  onClose?: (ev: CloseEvent) => void
  onError?: (ev: Event) => void
  onMessage?: (msg: M) => void
}

/**
 * A socket to the relay.
 *
 * ⚠️ GENERIC OVER WHAT TRAVELS DOWN IT, because the relay is not only Snake's. It carries
 * voice signalling, and now the park — which needs the same connect, the same stable client id,
 * the same hello, and the same "prove who you are if you are anyone" that took a real bug to get
 * right (see the note in onopen). A second copy of this class for the park would be a second
 * copy of that bug waiting to be reintroduced.
 *
 * ⚠️ TWO TYPE PARAMETERS, because what a room says is not what it hears: the park sends
 * positions and receives rosters, and one parameter would have forced every message in either
 * direction into one union that neither end actually accepts.
 *
 * ⚠️ IT STAYS IN game/ ANYWAY. Moving it somewhere neutral would be tidier and would touch
 * live multiplayer to buy nothing a comment cannot; the default type parameter means every
 * existing use reads exactly as it did.
 */
export class NetClient<
  M extends { type: string } = NetMessage,
  O extends { type: string } = NetMessage,
> {
  private ws: WebSocket | null = null
  private url: string
  private handlers: Handlers<M>
  private connecting = false

  constructor(url: string, handlers: Handlers<M> = {}) {
    this.url = url
    this.handlers = handlers
  }

  connect(room: string, opts?: { create?: boolean; settings?: Settings }) {
    if (this.connecting) return
    this.disconnect()
    this.connecting = true
    try {
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.onopen = () => {
        this.connecting = false
        this.handlers.onOpen?.()
        // include a stable clientId (from localStorage) so the server can assign a single visitor number
        let cid = ''
        try {
          cid = localStorage.getItem('snake.clientId') || ''
          if (!cid) {
            cid = Math.random().toString(36).slice(2) + Date.now().toString(36)
            localStorage.setItem('snake.clientId', cid)
          }
        } catch {
          // ignore
        }
        // Settings ride along with the hello rather than following it. A room created at
        // defaults and corrected a moment later is a room that can be seeded, joined or
        // started in between; born correct has no such window.
        this.send({
          type: 'hello',
          room,
          clientId: cid,
          create: opts?.create,
          ...(opts?.create && opts.settings ? { settings: opts.settings } : {}),
        })
        /**
         * Prove who we are, if we are anyone — so a round can actually be credited.
         *
         * ⚠️ finalize_round_rpc refuses to write a score against a handle that an account owns
         * unless the relay vouches for the player using it, and until now the relay had nothing
         * to vouch WITH. Two signed-in players could finish a full round and have it credited to
         * neither of them, with nothing on screen to say so.
         *
         * Deliberately after the hello and deliberately not awaited: signing in is optional here
         * and always has been. A signed-out player, an expired session or a failed lookup all
         * end the same way they did before — the round still plays, the results still show, and
         * only an unclaimed handle can be written to.
         *
         * The token is sent over wss and the relay checks it with Supabase rather than decoding
         * it; the account id never comes from anything the client asserts.
         */
        void (async () => {
          try {
            const { getSupabaseClient } = await import('../finance/client')
            const { data } = await getSupabaseClient().auth.getSession()
            const token = data.session?.access_token
            if (token) this.send({ type: 'auth', token })
          } catch {
            // not signed in, or auth unavailable — play on unauthenticated
          }
        })()
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as M
          this.handlers.onMessage?.(msg)
        } catch {
          // ignore
        }
      }
      ws.onclose = (ev) => {
        this.connecting = false
        this.handlers.onClose?.(ev)
      }
      ws.onerror = (ev) => {
        this.connecting = false
        this.handlers.onError?.(ev)
      }
    } catch {
      // fail silently
      this.connecting = false
    }
  }

  /**
   * ⚠️ `O | NetMessage`, because this class sends two of its own messages — the hello and
   * the auth token — whatever else is travelling down the socket. Without the second half a
   * caller with its own outgoing shape could not be constructed at all.
   */
  send(msg: O | NetMessage) {
    try {
      if (import.meta.env.DEV) {
        try {
          console.log('[MP DEBUG] WS send', {
            type: msg.type,
            msg,
            wsReadyState: this.ws?.readyState,
            wsUrl: this.ws?.url,
          })
        } catch {
          // ignore
        }
      }
      this.ws?.send(JSON.stringify(msg))
    } catch {
      // ignore
    }
  }

  disconnect() {
    try {
      this.ws?.close()
    } catch {
      // ignore
    } finally {
      this.ws = null
      this.connecting = false
    }
  }
}
