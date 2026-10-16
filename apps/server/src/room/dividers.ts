import type { SystemEvent } from "@kiko/protocol"
import type { NewMessage } from "./log"

export type Divider = Extract<SystemEvent, { private: true }>

/** A line the transcript draws as a divider. The id makes a repeat delivery store nothing. */
export function dividerMessage(id: string, text: string, event: Divider): NewMessage {
	return { from: { kind: "system", reason: "divider" }, text, clientId: id, event }
}
