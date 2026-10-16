// The human's attachments, as data: which files are pictures, which the composer refuses, and how
// a message lays its pictures out. The composer and the transcript both read these, so a file is
// a picture in the box exactly when it is one in the bubble. The limits and their words come from
// `@kiko/protocol`, which the server enforces too. No Solid and no DOM.

import { linkTarget, attachmentError, attachmentKind, attachmentMessages, attachmentType, isImageType, MAX_ATTACHMENTS, MAX_MESSAGE_TEXT, type PendingAttachment, sendFits } from "@kiko/protocol"

export { attachmentType, MAX_ATTACHMENTS }

/**
 * Why a draft cannot be sent as it is, or null. A message over the frame stays in the box. An edit
 * cannot carry a file, so an edit stays within the bubble limit.
 */
export function sendRefusal(text: string, editing: boolean, attachments: readonly PendingAttachment[] = []): string | null {
  if (editing) return text.length > MAX_MESSAGE_TEXT ? `Edits can be up to ${MAX_MESSAGE_TEXT.toLocaleString("en-US")} characters.` : null
  return sendFits(text, attachments) ? null : "This message is too long to send."
}

type Named = { name: string; type: string }

/** True when the file draws as a picture. */
export function isImage(file: Named): boolean {
  return isImageType(attachmentType(file))
}

/** A message's files split the way the bubble draws them: pictures first, then the rest in order. */
export function splitFiles<T extends Named>(files: readonly T[]): { images: T[]; others: T[] } {
  const images: T[] = []
  const others: T[] = []
  for (const f of files) (isImage(f) ? images : others).push(f)
  return { images, others }
}

/** How many of the grid's two columns a picture takes: a lone picture takes both. */
export function tileSpan(count: number): 1 | 2 {
  return count === 1 ? 2 : 1
}

/** `index` wrapped into `0..count-1` from either side, so the dialog's arrows cycle. */
export function wrapIndex(index: number, count: number): number {
  return count > 0 ? ((index % count) + count) % count : 0
}

/**
 * Which of `files` the composer takes when it already holds `held`, the way t3code's composer
 * decides before any await: a picture is taken at any size (the composer shrinks one over 10 MB),
 * a picture kiko cannot send is refused, and any other file must be under its limit. Each file
 * taken reserves a slot, so a drop past the 100 files says so. `error` is the last refusal, as
 * t3code shows one line.
 */
export function admit<T extends Named & { size: number }>(held: number, files: readonly T[]): { images: T[]; files: T[]; error: string | null } {
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

/** The files a bubble lists under its pictures: every one the text does not already show as its chip. */
export function unnamedFiles<T extends Named & { path?: string }>(files: readonly T[], body: string): T[] {
  return files.filter((f) => isImage(f) || !f.path || !body.includes(`(${linkTarget(`/${f.path}`)})`))
}
