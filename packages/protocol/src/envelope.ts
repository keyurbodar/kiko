import type { Origin } from "@kiko/agent/envelope"
import type { AgentSlug, MessageId, RoomId } from "./ids"

export type SystemReason = "task_unblocked" | "reminder" | "approval_result" | "run_budget" | "limit" | "files" | "created" | "routine" | "stalled"

export type { Origin }

export type Human = { kind: "human" }
export type AgentRef = { kind: "agent"; slug: AgentSlug }
export type System = { kind: "system"; reason: SystemReason }

export type Sender = Human | AgentRef | System

export type Actor = Human | AgentRef

export type Envelope = {
	id: string
	roomId: RoomId
	from: Sender
	body: string
	replyTo?: MessageId
	hop: number
	rootId: string
	tainted: boolean
	origin?: Origin
	grant?: readonly string[]
	seq: number
}
