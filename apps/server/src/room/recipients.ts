import type { AgentSlug } from "@kiko/protocol"

/** `mentions` are the slugs the whole text names, from `tags`, so a long message routes on all of it. */
export type RecipientMessage = {
	mentions: readonly string[]
	replyToAgent?: AgentSlug
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
	if (message.replyToAgent) chosen.add(message.replyToAgent)
	const addressed = members.filter((m) => chosen.has(m.slug))
	if (addressed.length) return addressed.map((m) => m.slug)
	return members.filter((m) => m.lead).map((m) => m.slug)
}
