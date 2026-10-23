import type { SystemEvent } from "@kiko/protocol"
import type { NewMessage } from "./log"

export type Divider = Extract<SystemEvent, { private: true }>

export function dividerMessage(id: string, text: string, event: Divider): NewMessage {
  return { from: { kind: "system", reason: "divider" }, text, clientId: id, event }
}
