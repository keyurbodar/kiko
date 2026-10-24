import { basename } from "../files/model"
import { setFileDrag } from "../lib/file-drag"
import { fileSrc } from "../state/room"
import type { FileEntry } from "./sources"

const dock = () => document.querySelector('[data-component="composer-dock"]')

export const canAttach = (): boolean => dock() !== null

export function attachFiles(entries: readonly FileEntry[]): void {
  const box = dock()?.getBoundingClientRect()
  if (!box) return
  for (const entry of entries) {
    const transfer = new DataTransfer()
    setFileDrag(transfer, entry.path)
    document.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: transfer,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    )
  }
}

export function downloadFiles(entries: readonly FileEntry[]): void {
  for (const entry of entries) {
    const link = document.createElement("a")
    link.href = fileSrc(entry.space, entry.fileId)
    link.download = basename(entry.path)
    link.click()
  }
}
