// Architecture section 7.1. An envelope is a message as `RoomDO` delivers it to
// an agent. It crosses a Durable Object call, never a client socket.

import type { AgentSlug, MessageId, RoomId } from "./ids"

export type SystemReason = "task_unblocked" | "reminder" | "approval_result" | "run_budget" | "limit" | "files" | "created" | "routine" | "stalled"

/**
 * Architecture section 25.3. Where a run's authority comes from. `human`: a human message is in the chain.
 * `routine`: a routine the human turned on, which may use the tools in `grant` outside kiko. `auto`:
 * anything else (an agent's reminder, a task wake, a stall nudge). The room sets it, and a message an
 * agent sends inherits the origin of its chain, so delegation never widens it.
 */
export type Origin = "human" | "routine" | "auto"

export type Human = { kind: "human" }
export type AgentRef = { kind: "agent"; slug: AgentSlug }
export type System = { kind: "system"; reason: SystemReason }

/** Who wrote a message. The room sets it. Message text cannot change it. */
export type Sender = Human | AgentRef | System

/** Who can react, edit, or own a change in a room. */
export type Actor = Human | AgentRef

export type Envelope = {
	/** Unique per delivery. The dedupe key. */
	id: string
	roomId: RoomId
	from: Sender
	body: string
	replyTo?: MessageId
	/** 0 for human and scheduled messages. */
	hop: number
	/** The human message or schedule that started this chain. */
	rootId: string
	/** Architecture section 16. */
	tainted: boolean
	/** Section 25.3. Absent on an envelope stored before origins: `human` from a human, else `auto`. */
	origin?: Origin
	/** Section 25.3. With origin `routine`: the tools the human let the routine use outside kiko. */
	grant?: readonly string[]
	/** Room sequence of the stored message. */
	seq: number
}
