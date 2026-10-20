import { MAX_ATTACHMENTS } from "@kiko/protocol"

export type EntryLike = {
  isFile: boolean
  isDirectory: boolean
  name: string
  file?: (ok: (file: File) => void, fail: (error: unknown) => void) => void
  createReader?: () => { readEntries: (ok: (entries: EntryLike[]) => void, fail: (error: unknown) => void) => void }
}

export const MAX_WALKED = 2000
const MAX_DEPTH = 12
const SKIPPED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"])
const SKIPPED_FOLDERS = new Set([".git", "node_modules", ".svn", ".hg"])

export function entriesOf(items: DataTransferItemList | undefined): EntryLike[] {
  return Array.from(items ?? []).flatMap((item) => {
    if (item.kind !== "file") return []
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => EntryLike | null }).webkitGetAsEntry?.()
    return entry ? [entry] : []
  })
}

const readAll = async (entry: EntryLike): Promise<EntryLike[]> => {
  const reader = entry.createReader?.()
  if (!reader) return []
  const all: EntryLike[] = []
  for (;;) {
    const batch = await new Promise<EntryLike[]>((ok, fail) => reader.readEntries(ok, fail))
    if (!batch.length) return all
    all.push(...batch)
    if (all.length > MAX_WALKED) return all
  }
}

const fileOf = (entry: EntryLike) => new Promise<File>((ok, fail) => (entry.file ? entry.file(ok, fail) : fail(new Error("not a file"))))

export type Walked = { files: File[]; folders: number; truncated: boolean }

export async function walkEntries(entries: readonly EntryLike[], cap = MAX_ATTACHMENTS + 1): Promise<Walked> {
  const files: File[] = []
  let visited = 0
  let folders = 0
  let truncated = false
  const visit = async (entry: EntryLike, parent: string, depth: number): Promise<void> => {
    if (files.length >= cap || visited >= MAX_WALKED) {
      truncated = true
      return
    }
    visited++
    if (entry.isFile) {
      if (SKIPPED_FILES.has(entry.name)) return
      const file = await fileOf(entry).catch(() => null)
      if (!file) return
      files.push(parent ? new File([file], `${parent}${entry.name}`, { type: file.type, lastModified: file.lastModified }) : file)
      return
    }
    if (!entry.isDirectory || SKIPPED_FOLDERS.has(entry.name)) return
    if (depth >= MAX_DEPTH) {
      truncated = true
      return
    }
    folders++
    for (const child of await readAll(entry).catch(() => [])) await visit(child, `${parent}${entry.name}/`, depth + 1)
  }
  for (const entry of entries) await visit(entry, "", 0)
  return { files, folders, truncated }
}

export const hasFolder = (entries: readonly EntryLike[]) => entries.some((entry) => entry.isDirectory)
