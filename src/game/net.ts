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

  constructor(url: string, handlers: Handlers = {}) {
    this.url = url
    this.handlers = handlers
  }

  connect(room: string) {
    this.disconnect()
    try {
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.onopen = () => {
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
      ws.onclose = (ev) => this.handlers.onClose?.(ev)
      ws.onerror = (ev) => this.handlers.onError?.(ev)
    } catch {
      // fail silently
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
    }
  }
}
