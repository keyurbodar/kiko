import type { AgentSlug, Envelope, FileRef, RoomEvent, SystemReason } from "@yuki/protocol"
import type { RoomLog } from "./log"
import type { Chain } from "./mail"
import { type RecipientMember, resolveRecipients } from "./recipients"

export function attachedLine(files: readonly FileRef[]): string {
	const list = files.map((f) => `/${f.name} (${f.type || "file"}, ${Math.max(1, Math.round(f.size / 1024))} kb)`).join(", ")
	return `(attached: ${list}. open each with read before you answer about it.)`
}

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

export function withContext(log: RoomLog, e: Envelope): Envelope {
	if (e.from.kind !== "human") return e
	const message = log.message(e.rootId)
	if (!message) return e
	const lines: string[] = []
	const quoted = message.replyTo ? log.message(message.replyTo) : null
	if (quoted) {
		const by = quoted.from.kind === "agent" ? `@${quoted.from.slug}` : quoted.from.kind === "human" ? "the human" : "the room"
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

export type ReminderDelivery = {
	text: string
	target: string
	createdBy?: string
	chain?: Chain | null
	recurring?: boolean
}

/**
 * The chain an agent's reminder wakes into. A one-off continues the chain that made it; a recurring
 * one starts its own root each time, so a chain's limits never count a week of repeats. A reminder the
 * human set starts its own root as the human's.
 */
export function reminderChain(own: string, r: Pick<ReminderDelivery, "chain" | "createdBy" | "recurring">): Chain | null {
	const made = r.chain ?? (r.createdBy === "human" ? { rootId: own, hop: 0, origin: "human" as const } : null)
	return made && r.recurring ? { ...made, rootId: own, hop: 0 } : made
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

	mark(id: string): void {
		const now = Date.now()
		this.storage.sql.exec("INSERT OR IGNORE INTO deliveries (id, at) VALUES (?, ?)", id, now)
		if (Math.random() < 0.02) this.storage.sql.exec("DELETE FROM deliveries WHERE at < ?", now - 30 * 86_400_000)
	}

	notice(id: string, text: string, reason: SystemReason = "run_budget"): RoomEvent | null {
		return this.storage.transactionSync(() => {
			if (this.seen(id)) return null
			const { event } = this.log.addMessage({ from: { kind: "system", reason }, text })
			this.storage.sql.exec("INSERT INTO deliveries (id, at) VALUES (?, ?)", id, Date.now())
			return event
		})
	}

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
