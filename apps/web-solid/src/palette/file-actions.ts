import { fileName } from "@kiko/protocol"
import { attachFileRefs } from "../composer/file-refs"
import { fileSrc } from "../state/room"
import type { FileEntry } from "./sources"

export const canAttach = (): boolean => document.querySelector('[data-component="composer-dock"]') !== null

export const attachable = (entries: readonly FileEntry[]): readonly FileEntry[] =>
  entries.filter((entry) => entry.chat === undefined)

export function attachFiles(entries: readonly FileEntry[]): void {
  attachFileRefs(attachable(entries).map((entry) => entry.path.replace(/^\/+/, "")))
}

export function downloadFiles(entries: readonly FileEntry[]): void {
  for (const entry of entries) {
    const link = document.createElement("a")
    link.href = fileSrc(entry.space, entry.fileId)
    link.download = fileName(entry.path)
    link.click()
  }
}
