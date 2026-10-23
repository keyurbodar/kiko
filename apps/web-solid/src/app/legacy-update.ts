import type { UpdateStage } from "@kiko/protocol"

export type LegacyUpdateState = { readonly t: "update.state"; readonly stage: UpdateStage; readonly error?: string }

export interface LegacySocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: "open" | "close", listener: () => void): void
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void
}

export type LegacyConnect = (url: string, protocols: string[]) => LegacySocket

const LEGACY_SOCKET_PATH = "/api/ws"
const LEGACY_SOCKET_PROTOCOL = "kiko"
const FINAL_STAGES: ReadonlySet<UpdateStage> = new Set(["restarting", "failed"])
const LOST_ERROR = "Kiko lost the connection to your backend before the update finished. Try again."

const browserConnect: LegacyConnect = (url, protocols) => new WebSocket(url, protocols)

const legacySocketUrl = (httpBase: string): string => httpBase.replace(/^http/, "ws") + LEGACY_SOCKET_PATH

function parseUpdateState(data: unknown): LegacyUpdateState | null {
  if (typeof data !== "string") return null
  try {
    const frame = JSON.parse(data) as { t?: unknown; stage?: unknown; error?: unknown } | null
    if (frame?.t !== "update.state" || typeof frame.stage !== "string") return null
    return frame as LegacyUpdateState
  } catch {
    return null
  }
}

export function startLegacyUpdate(options: {
  readonly httpBase: string
  readonly token: string
  readonly version: string
  readonly onState: (frame: LegacyUpdateState) => void
  readonly connect?: LegacyConnect
}): void {
  const socket = (options.connect ?? browserConnect)(legacySocketUrl(options.httpBase), [
    LEGACY_SOCKET_PROTOCOL,
    options.token,
  ])
  let finished = false
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
    socket.send(JSON.stringify({ t: "update.start", version: options.version }))
  })
  socket.addEventListener("message", (event) => {
    const frame = parseUpdateState(event.data)
    if (!frame || finished) return
    finished = FINAL_STAGES.has(frame.stage)
    options.onState(frame)
    if (finished) socket.close(1000, "update handed off")
  })
  socket.addEventListener("close", () => {
    if (finished) return
    finished = true
    options.onState({ t: "update.state", stage: "failed", error: LOST_ERROR })
  })
}
