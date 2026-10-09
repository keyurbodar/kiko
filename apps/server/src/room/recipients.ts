import { type AgentSlug, slugOfHandle } from "@kiko/protocol"

// Architecture section 7.2. Who receives a human message, as one pure function over the table:
//
//   tags @slug                    the tagged agents
//   replies to an agent's bubble  that agent
//   tags @all                     every agent
//   none of the above             the lead agent
//
// A tag and a reply add up: "@ada" in a reply to bob reaches both. A tag that names no member
// counts as no tag. An agent that is not a recipient is not woken; it reads what it missed in
// its next brief (section 7.4).

export type RecipientMessage = {
	text: string
	/** The agent whose bubble the message replies to. Absent for a reply to the human or to the system. */
	replyToAgent?: AgentSlug
}

export type RecipientMember = { slug: AgentSlug; lead: boolean }

// A tag starts the text or follows a character that cannot be part of an address, so
// "me@ada.dev" is not a tag. It ends where the slug's characters end.
const TAG = /(?:^|[^a-z0-9_@.-])@([a-z0-9-]{1,32})(?![a-z0-9-])/gi

/** The slugs the text tags, lowercased, in order, without repeats. `all` is included when tagged. `@yuki` tags the chief. */
export function tags(text: string): string[] {
	const found: string[] = []
	for (const match of text.matchAll(TAG)) {
		const slug = slugOfHandle(match[1]!.toLowerCase())
		if (!found.includes(slug)) found.push(slug)
	}
	return found
}

/** The members that receive `message`, in member order. Empty only for a room with no members. */
export function resolveRecipients(message: RecipientMessage, members: readonly RecipientMember[]): AgentSlug[] {
	const tagged = tags(message.text)
	if (tagged.includes("all")) return members.map((m) => m.slug)
	const chosen = new Set<string>(tagged)
	if (message.replyToAgent) chosen.add(message.replyToAgent)
	const addressed = members.filter((m) => chosen.has(m.slug))
	if (addressed.length) return addressed.map((m) => m.slug)
	return members.filter((m) => m.lead).map((m) => m.slug)
}
