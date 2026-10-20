
const MiB = 1024 * 1024

export const MAX_ATTACHMENTS = 100
/** The most text a message shows as its bubble. The room keeps longer text whole as a file (`RoomDO.humanSend`). */
export const MAX_MESSAGE_TEXT = 16_000
/**
 * The largest frame the room socket takes, in characters. Cloudflare's limit for a received
 * WebSocket message is 32 MiB (https://developers.cloudflare.com/durable-objects/platform/limits/),
 * so this leaves a wide margin.
 */
export const MAX_FRAME = 512 * 1024
/** What a frame keeps for its ids, its reply, and its quote beside the text and the file references. */
const FRAME_ROOM = 8 * 1024

/**
 * Whether a send fits one frame. The frame is JSON, where a control character takes six characters,
 * so the text and the file references are measured as JSON. A long file name takes its share.
 * Client and server both use this.
 */
export function sendFits(text: string, refs: readonly unknown[] = []): boolean {
	return JSON.stringify(text).length + JSON.stringify(refs).length <= MAX_FRAME - FRAME_ROOM
}
export const MAX_IMAGE_BYTES = 10 * MiB
export const MAX_TOTAL_IMAGE_BYTES = 80 * MiB
export const MAX_ATTACHMENT_FILE_BYTES = 50 * MiB

export const IMAGE_TYPES: readonly string[] = ["image/gif", "image/jpeg", "image/png", "image/webp"]

const IMAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
	gif: "image/gif",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	webp: "image/webp",
}

type Named = { name: string; type: string }

/**
 * The type a file is stored with. A drag from another app or a shell can hand over an empty or
 * generic type, so a `photo.jpg` with none is still a JPEG. Anything else without one is bytes.
 */
export function attachmentType(file: Named): string {
	const type = (file.type.split(";", 1)[0] ?? "").trim().toLowerCase()
	if (type && type !== "application/octet-stream") return type
	const dot = file.name.lastIndexOf(".")
	return (dot > 0 && IMAGE_BY_EXTENSION[file.name.slice(dot + 1).toLowerCase()]) || "application/octet-stream"
}

export const isImageType = (type: string) => IMAGE_TYPES.includes(type.toLowerCase())

/**
 * A picture, any other file, or a picture kiko cannot send (an SVG, a HEIC). t3code converts HEIC
 * to JPEG with a decoder library; kiko does not ship one, so a HEIC is refused like an SVG.
 */
export function attachmentKind(file: Named): "image" | "file" | "unsupported-image" {
	const type = attachmentType(file)
	if (isImageType(type)) return "image"
	return type.startsWith("image/") ? "unsupported-image" : "file"
}

export const attachmentLimit = (type: string) => (isImageType(type) ? MAX_IMAGE_BYTES : MAX_ATTACHMENT_FILE_BYTES)

function limitLabel(bytes: number): string {
	if (bytes >= MiB && bytes % MiB === 0) return `${bytes / MiB} MB`
	if (bytes >= 1024 && bytes % 1024 === 0) return `${bytes / 1024} KB`
	return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`
}

export const attachmentMessages = {
	tooMany: `You can attach up to ${MAX_ATTACHMENTS} files per message.`,
	empty: (name: string) => `'${name}' is empty or could not be read.`,
	tooLarge: (name: string, limit: number) => `'${name}' exceeds the ${limitLabel(limit)} attachment limit.`,
	tooLargeCompressed: (name: string) => `'${name}' is too large to attach, even after compression.`,
	unreadable: (name: string) => `'${name}' could not be read as an image.`,
	unsupportedImage: (name: string) => `'${name}' is not a supported image type. Attach GIF, JPEG, PNG, or WebP images.`,
	folderCut: "Only part of that folder was read. Drop fewer files at a time.",
	folderEmpty: "That folder has no files to attach.",
	imagesTotal: "Images can total up to 80 MB per message. Use smaller images or send fewer at once.",
	notSendable: (name: string, why: string) => `Attachment '${name}' cannot be sent: ${why}.`,
}

export function attachmentError(file: Named & { size: number }): string | null {
	if (file.size <= 0) return attachmentMessages.empty(file.name)
	const limit = attachmentLimit(attachmentType(file))
	return file.size > limit ? attachmentMessages.tooLarge(file.name, limit) : null
}

export function attachmentsError(files: readonly { type: string; size: number }[]): string | null {
	if (files.length > MAX_ATTACHMENTS) return attachmentMessages.tooMany
	let images = 0
	for (const f of files) if (isImageType(f.type)) images += f.size
	return images > MAX_TOTAL_IMAGE_BYTES ? attachmentMessages.imagesTotal : null
}

/**
 * An attachment named inside the text, as t3code's context chips: `[name](attachment:<id>)`. The
 * composer writes it with its own id, the send swaps in the upload's pending id, and the room
 * swaps that for the stored file's path (`linkAttachments`), so the bubble draws a file chip and
 * the agent reads the file where the human put it.
 */
const ATTACHMENT_LINK = /\[([^\]\n]*)\]\(attachment:([\w-]+)\)/g

export function attachmentToken(id: string, name: string): string {
	return `[${name.replace(/[[\]\n\\]/g, "")}](attachment:${id})`
}

/**
 * A path as a markdown link target. A name with a space or a parenthesis, such as
 * `Screenshot 2026-10-16.png` or `report (1).pdf`, ends a bare target early, so it goes in angle
 * brackets and stays readable to the agent as the real path.
 */
export function linkTarget(path: string): string {
	return /[\s()<>]/.test(path) ? `<${path.replace(/</g, "%3C").replace(/>/g, "%3E")}>` : path
}

/** Rewrites each token's id through `to`. A token `to` does not know becomes its plain name. */
export function linkAttachments(text: string, to: (id: string) => string | undefined): string {
	return text.replace(ATTACHMENT_LINK, (_, name: string, id: string) => {
		const target = to(id)
		return target === undefined ? name : `[${name}](${linkTarget(target)})`
	})
}

/** The ids of the tokens in `text`, in order. */
export function attachmentIds(text: string): string[] {
	return Array.from(text.matchAll(ATTACHMENT_LINK), (match) => match[2]!)
}
