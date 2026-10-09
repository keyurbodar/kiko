// The human's attachments, as data: which files are pictures, which the composer refuses, and how
// a message lays its pictures out. The composer and the transcript both read these, so a file is
// a picture in the box exactly when it is one in the bubble. No Solid and no DOM.

/** The pictures kiko draws inline. Any other file, other image types included, is a file row. */
const IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"])

const IMAGE_BY_EXTENSION: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

export const MAX_FILES = 10
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_FILE_BYTES = 50 * 1024 * 1024

type Named = { name: string; type: string }

/**
 * The type a file is stored with. A drag from another app or a shell can hand over an empty or
 * generic type, so a `photo.jpg` with none is still a JPEG. Anything else without one is bytes.
 */
export function attachmentType(file: Named): string {
  const type = file.type.split(";", 1)[0]!.trim().toLowerCase()
  if (type && type !== "application/octet-stream") return type
  const ext = /\.([^./]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? ""
  return IMAGE_BY_EXTENSION[ext] ?? "application/octet-stream"
}

/** True when the file draws as a picture. */
export function isImage(file: Named): boolean {
  return IMAGE_TYPES.has(attachmentType(file))
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

const megabytes = (bytes: number) => `${bytes / 1024 / 1024} MB`

/**
 * Which of `files` the composer takes when it already holds `held`, and why it refuses the rest.
 * A file over its size limit is refused on its own; the files past the count limit are refused
 * together, so one drop of thirty pictures says so once.
 */
export function admit<T extends Named & { size: number }>(held: number, files: readonly T[]): { accepted: T[]; refusals: string[] } {
  const accepted: T[] = []
  const refusals: string[] = []
  let over = 0
  for (const f of files) {
    const limit = isImage(f) ? MAX_IMAGE_BYTES : MAX_FILE_BYTES
    if (f.size > limit) refusals.push(`${f.name} is over ${megabytes(limit)}`)
    else if (held + accepted.length >= MAX_FILES) over++
    else accepted.push(f)
  }
  if (over) refusals.push(`You can attach up to ${MAX_FILES} files. ${over === 1 ? "1 file was" : `${over} files were`} left out`)
  return { accepted, refusals }
}
