import type { AgentSlug, Message } from "@kiko/protocol"

/** `mentions` are the slugs the whole text names, from `tags`, so a long message routes on all of it. `replyTo` are the agents the message it answers was for. */
type RecipientMessage = {
	mentions: readonly string[]
	replyTo?: readonly string[]
}

export type RecipientMember = { slug: AgentSlug; lead: boolean }

const TAG = /(?:^|[^a-z0-9_@.-])@([a-z0-9-]{1,32})(?![a-z0-9-])/gi

export function tags(text: string): string[] {
	const found: string[] = []
	for (const match of text.matchAll(TAG)) {
		const slug = match[1]?.toLowerCase()
		if (slug === undefined || found.includes(slug)) continue
		found.push(slug)
	}
	return found
}

export function resolveRecipients(message: RecipientMessage, members: readonly RecipientMember[]): AgentSlug[] {
	if (message.mentions.includes("all")) return members.map((m) => m.slug)
	const chosen = new Set<string>(message.mentions)
	for (const slug of message.replyTo ?? []) chosen.add(slug)
	const addressed = members.filter((m) => chosen.has(m.slug))
	if (addressed.length) return addressed.map((m) => m.slug)
	return members.filter((m) => m.lead).map((m) => m.slug)
}

const REPLY_DEPTH = 6

/**
 * Who a reply is for. A reply to an agent's bubble is for that agent. A reply to the human's own
 * message is for whoever that message was for: the agents it tags, and the agents of the message it
 * answered in turn, so a chain of replies keeps talking to the same agent.
 */
export function replyAddressees(find: (id: string) => Pick<Message, "from" | "text" | "replyTo"> | null, id: string | undefined, depth = REPLY_DEPTH): string[] {
	const target = id !== undefined && depth > 0 ? find(id) : null
	if (!target) return []
	if (target.from.kind === "agent") return [target.from.slug]
	if (target.from.kind !== "human") return []
	return [...new Set([...tags(target.text), ...replyAddressees(find, target.replyTo, depth - 1)])]
}
