import type { FileRef } from "@kiko/protocol"
import { apiFetch } from "../../lib/api"
import { fileSrc } from "../../state/room"
import { readText } from "../api"
import type { FileType } from "../type"
import { keepPreview, memoryPreview, storedPreview } from "./cache"
import { planFor, type Preview, previewKey, tableHead, textPreview } from "./model"

const PARALLEL = 3
let running = 0
const waiting: (() => void)[] = []

async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (running >= PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await work()
  } finally {
    running--
    waiting.shift()?.()
  }
}

async function bytesOf(space: string, id: string): Promise<Uint8Array> {
  const res = await apiFetch(fileSrc(space, id))
  if (!res.ok) throw new Error(`The server said ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function build(space: string, file: FileRef, type: FileType): Promise<Preview> {
  const plan = planFor(type, file)
  if (plan.kind === "text") {
    const read = await readText(space, file.id, plan.bytes)
    return read.kind === "text" ? textPreview(plan.type, file.name, read.text) : { kind: "none" }
  }
  if (plan.kind === "sheet") {
    const { xlsxRows } = await import("./xlsx")
    const rows = tableHead(await xlsxRows(await bytesOf(space, file.id)).catch(() => []))
    return rows.length ? { kind: "table", rows } : { kind: "none" }
  }
  if (plan.kind === "pdf") {
    const { pdfFirstPage } = await import("./pdf")
    const blob = await pdfFirstPage(await bytesOf(space, file.id)).catch(() => null)
    return blob ? { kind: "picture", blob } : { kind: "none" }
  }
  return { kind: "none" }
}

const building = new Map<string, Promise<Preview>>()

export const previewNow = (file: Pick<FileRef, "id" | "size">) => memoryPreview(previewKey(file))

export function loadPreview(
  space: string,
  file: FileRef,
  type: FileType,
): Promise<{ preview: Preview; fresh: boolean }> {
  const key = previewKey(file)
  return storedPreview(key).then((stored) => {
    if (stored) return { preview: stored, fresh: false }
    let pending = building.get(key)
    if (!pending) {
      pending = limited(() => build(space, file, type)).then((preview) => {
        keepPreview(key, preview)
        return preview
      })
      pending.finally(() => building.delete(key)).catch(() => {})
      building.set(key, pending)
    }
    return pending.then((preview) => ({ preview, fresh: true }))
  })
}
