// The chat list's activity line and mentions of the human. The room classifies its newest
// activity into a `ChatLast` and counts mentions with these functions, and the client uses the
// same ones for the open room, so both read a message the same way. Pure and small, so a client
// bundle that imports them pulls in no dependency.

import type { FileRef } from "./room"

/** What the newest thing in a chat was. */
export type LastKind =
	| "text"
	| "photo"
	| "video"
	/** Pictures and clips together. */
	| "album"
	| "file"
	| "voice"
	| "audio"
	/** A message that is only a link. */
	| "link"
	/** An agent reacted to one of the human's messages. */
	| "react"
	| "joined"
	| "left"
	/** The human renamed the group. */
	| "renamed"
	/** A group with nothing in it yet. */
	| "created"
	/** A message from the room itself: a reminder, a limit, a file notice. */
	| "notice"

/**
 * The newest activity of a chat, as data. The client words it (DM or group, `you:` or a name),
 * so the wire holds no sentence. Old rows have none and show `lastPreview`.
 */
export type ChatLast = {
	from: "human" | "agent" | "system"
	/** The agent's display name, when `from` is `agent`. */
	name?: string
	kind: LastKind
	/** The text or caption, the reacted message's text, the new title, or the notice. One line, clipped. */
	text?: string
	/** The file's name, for one `file` or `audio`. */
	file?: string
	/** How many pictures, clips, or files, when more than one. */
	count?: number
	/** For `react`. */
	emoji?: string
	/** Epoch milliseconds. */
	at: number
}

const MAX_TEXT = 120
const URL_ONLY = /^https?:\/\/\S+$/i

/** One line of at most `max` characters. */
export function oneLine(text: string, max = MAX_TEXT): string {
	const flat = text.replace(/\s+/g, " ").trim()
	return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/** A file's name as the human gave it: the room path's last part, without an upload prefix. */
export function fileName(path: string): string {
	const m = /^attachments\/[0-9a-z]+-(.+)$/.exec(path)
	return m ? m[1]! : (path.split("/").pop() ?? path)
}

type Files = readonly Pick<FileRef, "name" | "type">[]

/** The activity one message is. */
export function messageLast(m: { from: ChatLast["from"]; name?: string; text: string; files?: Files; at: number }): ChatLast {
	const base: ChatLast = { from: m.from, ...(m.from === "agent" && m.name ? { name: m.name } : {}), kind: "text", at: m.at }
	const text = oneLine(m.text)
	const caption = text ? { text } : {}
	const files = m.files ?? []
	if (m.from === "system") return { ...base, kind: "notice", ...caption }
	if (files.length) {
		const n = files.length
		const images = files.filter((f) => f.type.startsWith("image/")).length
		const videos = files.filter((f) => f.type.startsWith("video/")).length
		if (images + videos === n) {
			const kind = images === n ? "photo" : videos === n ? "video" : "album"
			return { ...base, kind, ...(n > 1 && kind !== "album" ? { count: n } : {}), ...caption }
		}
		const first = fileName(files[0]!.name)
		if (n === 1 && files[0]!.type.startsWith("audio/")) {
			return /^voice/i.test(first) ? { ...base, kind: "voice", ...caption } : { ...base, kind: "audio", file: first, ...caption }
		}
		return { ...base, kind: "file", ...(n > 1 ? { count: n } : { file: first }), ...caption }
	}
	return { ...base, kind: URL_ONLY.test(text) ? "link" : "text", text }
}

/**
 * The handle agents write to reach the human, from the account's name: its first word, lowercase,
 * in slug characters. `you` when the name has none.
 */
export function humanHandle(name: string | null | undefined): string {
	const first = (name ?? "").trim().split(/\s+/)[0] ?? ""
	const handle = first
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "")
		.slice(0, 32)
	return handle || "you"
}

/**
 * True when an agent's message is for the human, as Telegram counts a mention: the text names the
 * human's `@handle`, or the message is a reply to one of the human's messages.
 */
export function mentionsHuman(text: string, handle: string | null, repliesToHuman: boolean): boolean {
	if (repliesToHuman) return true
	if (!handle) return false
	const at = new RegExp(`(^|[^a-z0-9_@-])@${handle}(?![a-z0-9-])`, "i")
	return at.test(text)
}
