import { describe, expect, it } from "vitest"
import { startLegacyUpdate, type LegacySocket, type LegacyUpdateState } from "./legacy-update"

class FakeSocket implements LegacySocket {
  readonly sent: unknown[] = []
  closedWith: number | undefined
  readonly #listeners = new Map<string, Array<(event: { readonly data: unknown }) => void>>()

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }

  close(code?: number) {
    this.closedWith = code
    this.emit("close")
  }

  addEventListener(type: string, listener: (event: { readonly data: unknown }) => void) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener])
  }

  emit(type: string, data?: unknown) {
    for (const listener of this.#listeners.get(type) ?? []) listener({ data })
  }
}

function start() {
  const states: LegacyUpdateState[] = []
  let socket: FakeSocket | undefined
  startLegacyUpdate({
    httpBase: "https://owner.example.workers.dev",
    token: "session-token",
    version: "0.8.0",
    onState: (frame) => states.push(frame),
    connect: (url, protocols) => (socket = new FakeSocket(url, protocols)),
  })
  return { states, socket: socket as FakeSocket }
}

describe("startLegacyUpdate", () => {
  it("greets the old socket, asks it to update, and hands off at restarting", () => {
    const { states, socket } = start()
    expect(socket.url).toBe("wss://owner.example.workers.dev/api/ws")
    expect(socket.protocols).toEqual(["kiko", "session-token"])
    expect(socket.sent).toEqual([])

    socket.emit("open")
    expect(socket.sent).toEqual([
      { t: "hello", lastSeq: 0 },
      { t: "update.start", version: "0.8.0" },
    ])

    socket.emit("message", JSON.stringify({ t: "reset", snapshot: {} }))
    socket.emit("message", "pong")
    socket.emit("message", JSON.stringify({ t: "update.state", stage: "checking" }))
    socket.emit("message", JSON.stringify({ t: "update.state", stage: "uploading" }))
    expect(socket.closedWith).toBeUndefined()
    socket.emit("message", JSON.stringify({ t: "update.state", stage: "restarting" }))

    expect(states.map((s) => s.stage)).toEqual(["checking", "uploading", "restarting"])
    expect(socket.closedWith).toBe(1000)
  })

  it("closes on a failed update and reports the backend's error", () => {
    const { states, socket } = start()
    socket.emit("open")
    socket.emit("message", JSON.stringify({ t: "update.state", stage: "failed", error: "No Cloudflare grant." }))
    expect(states).toEqual([{ t: "update.state", stage: "failed", error: "No Cloudflare grant." }])
    expect(socket.closedWith).toBe(1000)
  })

  it("reports a failure when the socket drops before the update hands off", () => {
    const { states, socket } = start()
    socket.emit("open")
    socket.emit("message", JSON.stringify({ t: "update.state", stage: "authorizing" }))
    socket.emit("close")
    expect(states.map((s) => s.stage)).toEqual(["authorizing", "failed"])
  })
})
