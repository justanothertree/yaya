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

  connect(room: string) {
    if (this.connecting) return
    this.connecting = true
    this.disconnect()
    try {
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.onopen = () => {
        this.connecting = false
        this.handlers.onOpen?.()
        this.send({ type: 'hello', room })
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
