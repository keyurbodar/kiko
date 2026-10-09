// The human's attachments (architecture section 18.1): which files are pictures and how big a
// message's files may be. The composer, the upload route, and the room's claim all read these,
// so the limits the client shows are the ones the server enforces. t3code's numbers and words.

const MiB = 1024 * 1024

/** The most files one message carries. */
export const MAX_ATTACHMENTS = 100
/** One picture. A bigger one is re-encoded by the composer until it fits. */
export const MAX_IMAGE_BYTES = 10 * MiB
/** Every picture of one message together. */
export const MAX_TOTAL_IMAGE_BYTES = 80 * MiB
/** Any other file. */
export const MAX_ATTACHMENT_FILE_BYTES = 50 * MiB

/** The pictures yuki draws inline and sends to a model as an image. */
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
	const type = file.type.split(";", 1)[0]!.trim().toLowerCase()
	if (type && type !== "application/octet-stream") return type
	const dot = file.name.lastIndexOf(".")
	return (dot > 0 && IMAGE_BY_EXTENSION[file.name.slice(dot + 1).toLowerCase()]) || "application/octet-stream"
}

/** True when the type is a picture yuki draws. */
export const isImageType = (type: string) => IMAGE_TYPES.includes(type.toLowerCase())

/**
 * A picture, any other file, or a picture yuki cannot send (an SVG, a HEIC). t3code converts HEIC
 * to JPEG with a decoder library; yuki does not ship one, so a HEIC is refused like an SVG.
 */
export function attachmentKind(file: Named): "image" | "file" | "unsupported-image" {
	const type = attachmentType(file)
	if (isImageType(type)) return "image"
	return type.startsWith("image/") ? "unsupported-image" : "file"
}

/** The size limit for one file of this type. */
export const attachmentLimit = (type: string) => (isImageType(type) ? MAX_IMAGE_BYTES : MAX_ATTACHMENT_FILE_BYTES)

/** `10 MB`, `512 KB`, or `3 bytes`, the way t3code names a limit. */
export function limitLabel(bytes: number): string {
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
	imagesTotal: "Images can total up to 80 MB per message. Use smaller images or send fewer at once.",
	notSendable: (name: string, why: string) => `Attachment '${name}' cannot be sent: ${why}.`,
}

/** Why one file cannot be attached, or null. */
export function attachmentError(file: Named & { size: number }): string | null {
	if (file.size <= 0) return attachmentMessages.empty(file.name)
	const limit = attachmentLimit(attachmentType(file))
	return file.size > limit ? attachmentMessages.tooLarge(file.name, limit) : null
}

/** Why one message's files cannot go together: too many, or pictures over the total. Null when they can. */
export function attachmentsError(files: readonly { type: string; size: number }[]): string | null {
	if (files.length > MAX_ATTACHMENTS) return attachmentMessages.tooMany
	let images = 0
	for (const f of files) if (isImageType(f.type)) images += f.size
	return images > MAX_TOTAL_IMAGE_BYTES ? attachmentMessages.imagesTotal : null
}
