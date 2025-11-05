import type { NetMessage } from './types'

type Handlers = {
  onOpen?: () => void
  onClose?: (ev: CloseEvent) => void
  onError?: (ev: Event) => void
  onMessage?: (msg: NetMessage) => void
}

export class NetClient {
  private ws: WebSocket | null = null
  private url: string
  private handlers: Handlers
  private connecting = false

  constructor(url: string, handlers: Handlers = {}) {
    this.url = url
    this.handlers = handlers
  }

  connect(room: string, opts?: { create?: boolean }) {
    if (this.connecting) return
    this.connecting = true
    this.disconnect()
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
        this.send({ type: 'hello', room, clientId: cid, create: opts?.create })
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as NetMessage
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

  send(msg: NetMessage) {
    try {
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
