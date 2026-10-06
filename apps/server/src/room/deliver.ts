import type { AgentSlug, Envelope, FileRef, RoomEvent, SystemReason } from "@kiko/protocol"
import type { Authority } from "../lib/origin"
import type { RoomLog } from "./log"
import type { Chain } from "./mail"
import { type RecipientMember, resolveRecipients } from "./recipients"

/** How an envelope names the files a message carries. Paths are as the agent's file tools take them. */
export function attachedLine(files: readonly FileRef[]): string {
	const list = files.map((f) => `/${f.name} (${f.type || "file"}, ${Math.max(1, Math.round(f.size / 1024))} kb)`).join(", ")
	return `(attached: ${list}. open each with read before you answer about it.)`
}

/**
 * Architecture section 7.2 over a human burst. Each envelope goes to the members `resolveRecipients`
 * picks for it, and each member gets its own envelopes in one `receive()` call. A member that is not
 * in the result is not woken. `replyAuthor` names the agent whose bubble a message replies to.
 */
export function route(
	envelopes: readonly Envelope[],
	members: readonly RecipientMember[],
	replyAuthor: (messageId: string) => AgentSlug | undefined,
): Map<AgentSlug, Envelope[]> {
	const out = new Map<AgentSlug, Envelope[]>()
	for (const e of envelopes) {
		const replyToAgent = e.replyTo ? replyAuthor(e.replyTo) : undefined
		for (const slug of resolveRecipients({ text: e.body, ...(replyToAgent ? { replyToAgent } : {}) }, members)) {
			out.set(slug, [...(out.get(slug) ?? []), e])
		}
	}
	return out
}

/**
 * What the agent needs to read a human message the way the human sees it: the bubble it replies
 * to, and the files it carries (each one opens with read). Added after routing, so a quoted
 * "@ada" never addresses ada. The envelope id is unchanged, so a repeat is still ignored.
 */
export function withContext(log: RoomLog, e: Envelope): Envelope {
	if (e.from.kind !== "human") return e
	const message = log.message(e.rootId)
	if (!message) return e
	const lines: string[] = []
	const quoted = message.replyTo ? log.message(message.replyTo) : null
	if (quoted) {
		const by = quoted.from.kind === "agent" ? `@${quoted.from.slug}` : quoted.from.kind === "human" ? "the human" : "the room"
		// A quote names the exact words the human answers; without one, the start of the whole message.
		lines.push(
			message.quote
				? `(replying to ${by}, about this part: "${message.quote.replace(/\s+/g, " ").slice(0, 600)}")`
				: `(replying to ${by}: "${quoted.text.replace(/\s+/g, " ").slice(0, 400)}")`,
		)
	}
	if (e.body.trim()) lines.push(e.body)
	if (message.files?.length) lines.push(attachedLine(message.files))
	return lines.length ? { ...e, body: lines.join("\n") } : e
}

// Architecture section 14. Deliveries from outside the room (reminders today) arrive
// at least once. Each has a stable id, and `deliveries` remembers every id the room
// has stored, so a repeat stores and sends nothing.

export type ReminderDelivery = {
	text: string
	/** `human`, or the agent slug the reminder is for. */
	target: string
	/** `human`, the agent slug that set it, or `ext:<name>` for an extension's trigger. Absent from an older sender. */
	createdBy?: string
	/** The chain the agent that set it was working on (section 25.3). Null or absent for one set before chains. */
	chain?: Chain | null
	/** A recurring reminder: each occurrence starts its own root. */
	recurring?: boolean
	/** The authority of the run it wakes. Absent: `auto`. An extension's trigger is a routine granted its tools. */
	authority?: Authority
}

export class Deliveries {
	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
	) {
		storage.sql.exec("CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, at INTEGER NOT NULL)")
	}

	seen(id: string): boolean {
		return this.storage.sql.exec("SELECT 1 FROM deliveries WHERE id = ?", id).toArray().length > 0
	}

	/** Remembers a delivery id, so a repeat delivers nothing. Ids older than a month are let go now and then. */
	mark(id: string): void {
		const now = Date.now()
		this.storage.sql.exec("INSERT OR IGNORE INTO deliveries (id, at) VALUES (?, ?)", id, now)
		if (Math.random() < 0.02) this.storage.sql.exec("DELETE FROM deliveries WHERE at < ?", now - 30 * 86_400_000)
	}

	/** Stores a system line once per id. Returns the event, or null for an id seen before. */
	notice(id: string, text: string, reason: SystemReason = "run_budget"): RoomEvent | null {
		return this.storage.transactionSync(() => {
			if (this.seen(id)) return null
			const { event } = this.log.addMessage({ from: { kind: "system", reason }, text })
			this.storage.sql.exec("INSERT INTO deliveries (id, at) VALUES (?, ?)", id, Date.now())
			return event
		})
	}

	/**
	 * Stores a reminder as a message from `system:reminder`. Returns the event to
	 * publish, or null when the id was delivered before.
	 *
	 * ASSUMPTION: an agent-target reminder is also a room message for now, addressed
	 * to the agent by name. The envelope to the agent's inbox comes with the delivery task.
	 */
	reminder(id: string, reminder: ReminderDelivery): RoomEvent | null {
		return this.storage.transactionSync(() => {
			if (this.seen(id)) return null
			const text = reminder.target === "human" ? `reminder: ${reminder.text}` : `reminder for @${reminder.target}: ${reminder.text}`
			const { event } = this.log.addMessage({ from: { kind: "system", reason: "reminder" }, text })
			this.storage.sql.exec("INSERT INTO deliveries (id, at) VALUES (?, ?)", id, Date.now())
			return event
		})
	}
}
