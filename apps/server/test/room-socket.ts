export class RoomSocket extends EventTarget {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  private readonly socket: WebSocket
  private readonly roomId: string
  private pending: string[] = []
  private hello: number | undefined
  private subscribed = false

  constructor(url: string | URL) {
    super()
    const parsed = new URL(url)
    const parts = parsed.pathname.split("/")
    this.roomId = parts[1] === "room" ? parts[2]! : parts.at(-1)!
    this.socket = new WebSocket(url)
    this.socket.onopen = (event) => { this.onopen?.(event); this.dispatchEvent(new Event("open")) }
    this.socket.onerror = (event) => { this.onerror?.(event); this.dispatchEvent(new Event("error")) }
    this.socket.onclose = (event) => { this.onclose?.(event); this.dispatchEvent(new CloseEvent("close", { code: event.code, reason: event.reason })) }
    this.socket.onmessage = (event) => {
      const frame = JSON.parse(String(event.data))
      if (frame.t === "reset" && this.hello !== undefined && !this.subscribed) {
        this.socket.send(JSON.stringify({ t: "subscribe", roomId: this.roomId, lastSeq: this.hello }))
        return
      }
      if (frame.t !== "room" || frame.roomId !== this.roomId) return
      if (!this.subscribed) {
        this.subscribed = true
        for (const raw of this.pending.splice(0)) this.send(raw)
      }
      const message = new MessageEvent("message", { data: JSON.stringify(frame.frame) })
      this.onmessage?.(message)
      this.dispatchEvent(message)
    }
  }

  get readyState() { return this.socket.readyState }
  close(code?: number, reason?: string) { this.socket.close(code, reason) }
  send(raw: string) {
    let frame: { t?: string; lastSeq?: number }
    try { frame = JSON.parse(raw) } catch { this.socket.send(raw); return }
    if (frame.t === "hello") {
      this.hello = frame.lastSeq ?? 0
      if (this.subscribed) this.socket.send(JSON.stringify({ t: "subscribe", roomId: this.roomId, lastSeq: this.hello }))
      else this.socket.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
      return
    }
    if (!this.subscribed && this.hello !== undefined) { this.pending.push(raw); return }
    this.socket.send(JSON.stringify({ t: "room", roomId: this.roomId, frame }))
  }
}
