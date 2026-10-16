import type { AgentSlug, Envelope, FileRef, RoomEvent, SystemEvent, SystemReason } from "@kiko/protocol"
import type { RoomLog } from "./log"
import type { Pending } from "./burst"
import { type RecipientMember, resolveRecipients } from "./recipients"

/** The attached line's budget in the JSON bytes the entry counts. The files past it are counted, not named. */
const MAX_ATTACHED_BYTES = 4 * 1024

export function attachedLine(files: readonly FileRef[]): string {
	const names: string[] = []
	let bytes = 0
	for (const [i, f] of files.entries()) {
		const name = `/${f.name} (${f.type || "file"}, ${Math.max(1, Math.round(f.size / 1024))} kb)`
		bytes += new TextEncoder().encode(JSON.stringify(name)).length + 2
		if (bytes > MAX_ATTACHED_BYTES) {
			names.push(`and ${files.length - i} more`)
			break
		}
		names.push(name)
	}
	return `(attached: ${names.join(", ")}. open each with read before you answer about it.)`
}

const WORKSPACE_LINK = /\]\((?:<(\/[^>\n]+)>|(\/[^)\s<>]+))\)/g

/** The workspace files a human's text links to, as the composer's file chips write them: `[name](/path)`. */
function referencedFiles(text: string, attached: readonly FileRef[] = []): string[] {
	const named = new Set(attached.map((f) => `/${f.name}`))
	const out = new Set<string>()
	for (const m of text.matchAll(WORKSPACE_LINK)) {
		const path = (m[1] ?? m[2])!
		if (!path.startsWith("//") && !named.has(path)) out.add(path)
	}
	return [...out].slice(0, 20)
}

export function route(
	pending: readonly Pending[],
	members: readonly RecipientMember[],
	replyAuthor: (messageId: string) => AgentSlug | undefined,
): Map<AgentSlug, Envelope[]> {
	const out = new Map<AgentSlug, Envelope[]>()
	for (const { envelope: e, mentions } of pending) {
		const replyToAgent = e.replyTo ? replyAuthor(e.replyTo) : undefined
		for (const slug of resolveRecipients({ mentions, ...(replyToAgent ? { replyToAgent } : {}) }, members)) {
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
	const referenced = referencedFiles(e.body, message.files)
	if (referenced.length) lines.push(`(referenced: ${referenced.join(", ")}. open each with read before you answer about it.)`)
	return lines.length ? { ...e, body: lines.join("\n") } : e
}

export class Deliveries {
	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
	) {
	}

	seen(id: string): boolean {
		return this.storage.sql.exec("SELECT 1 FROM deliveries WHERE id = ?", id).toArray().length > 0
	}

	mark(id: string): void {
		const now = Date.now()
		this.storage.sql.exec("INSERT OR IGNORE INTO deliveries (id, at) VALUES (?, ?)", id, now)
		if (Math.random() < 0.02) this.storage.sql.exec("DELETE FROM deliveries WHERE at < ?", now - 30 * 86_400_000)
	}

	notice(id: string, text: string, reason: SystemReason = "run_budget", detail?: SystemEvent): RoomEvent | null {
		return this.storage.transactionSync(() => {
			if (this.seen(id)) return null
			const { event } = this.log.addMessage({ from: { kind: "system", reason }, text, ...(detail ? { event: detail } : {}) })
			this.storage.sql.exec("INSERT INTO deliveries (id, at) VALUES (?, ?)", id, Date.now())
			return event
		})
	}
}
