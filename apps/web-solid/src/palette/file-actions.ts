import { basename } from "../files/model"
import { attachFileRefs } from "../composer/file-refs"
import { fileSrc } from "../state/room"
import type { FileEntry } from "./sources"

export const canAttach = (): boolean => document.querySelector('[data-component="composer-dock"]') !== null

export function attachFiles(entries: readonly FileEntry[]): void {
  attachFileRefs(entries.map((entry) => entry.path.replace(/^\/+/, "")))
}

export function downloadFiles(entries: readonly FileEntry[]): void {
  for (const entry of entries) {
    const link = document.createElement("a")
    link.href = fileSrc(entry.space, entry.fileId)
    link.download = basename(entry.path)
    link.click()
  }
}
