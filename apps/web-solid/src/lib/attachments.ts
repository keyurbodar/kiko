import {
  linkTarget,
  attachmentError,
  attachmentKind,
  attachmentMessages,
  attachmentType,
  isImageType,
  MAX_ATTACHMENTS,
  MAX_MESSAGE_TEXT,
  type PendingAttachment,
  sendFits,
} from "@kiko/protocol"

export { attachmentType }

export function sendRefusal(
  text: string,
  editing: boolean,
  attachments: readonly PendingAttachment[] = [],
): string | null {
  if (editing)
    return text.length > MAX_MESSAGE_TEXT
      ? `Edits can be up to ${MAX_MESSAGE_TEXT.toLocaleString("en-US")} characters.`
      : null
  return sendFits(text, attachments) ? null : "This message is too long to send."
}

type Named = { name: string; type: string }

export function isImage(file: Named): boolean {
  return isImageType(attachmentType(file))
}

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogv"])

export function isVideo(file: Named): boolean {
  if (attachmentType(file).startsWith("video/")) return true
  const dot = file.name.lastIndexOf(".")
  return dot > 0 && VIDEO_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase())
}

export function splitFiles<T extends Named>(files: readonly T[]): { images: T[]; videos: T[]; others: T[] } {
  const images: T[] = []
  const videos: T[] = []
  const others: T[] = []
  for (const f of files) (isImage(f) ? images : isVideo(f) ? videos : others).push(f)
  return { images, videos, others }
}

export function wrapIndex(index: number, count: number): number {
  return count > 0 ? ((index % count) + count) % count : 0
}

export function admit<T extends Named & { size: number }>(
  held: number,
  files: readonly T[],
): { images: T[]; files: T[]; error: string | null } {
  const images: T[] = []
  const others: T[] = []
  let error: string | null = null
  for (const f of files) {
    if (held + images.length + others.length >= MAX_ATTACHMENTS) {
      error = attachmentMessages.tooMany
      continue
    }
    const kind = attachmentKind(f)
    if (kind === "unsupported-image") {
      error = attachmentMessages.unsupportedImage(f.name)
      continue
    }
    if (kind === "image") {
      if (f.size <= 0) error = attachmentMessages.empty(f.name)
      else images.push(f)
      continue
    }
    const why = attachmentError(f)
    if (why) error = why
    else others.push(f)
  }
  return { images, files: others, error }
}

export function unnamedFiles<T extends Named & { path?: string }>(files: readonly T[], body: string): T[] {
  return files.filter((f) => isImage(f) || !f.path || !body.includes(`(${linkTarget(`/${f.path}`)})`))
}

export function saveFile(src: string, name: string) {
  const a = document.createElement("a")
  a.href = src
  a.download = name
  a.click()
}
