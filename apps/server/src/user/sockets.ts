import type { UserToClient } from "@yuki/protocol"

export type Attachment = { ready: boolean; helloBy?: number }

export function send(ws: WebSocket, frame: UserToClient): void {
  trySend(ws, JSON.stringify(frame))
}

export function trySend(ws: WebSocket, text: string): void {
  try {
    ws.send(text)
  } catch {
  }
}
