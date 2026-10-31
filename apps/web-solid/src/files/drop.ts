import { createSignal } from "solid-js"
import { formatBytes } from "../lib/format"
import { isTextFile, putFile, rememberMade } from "./api"
import { fileType, type FileType } from "./type"

export const MAX_TEXT_BYTES = 2 * 1024 * 1024
const FRESH_MS = 10_000
const MAX_RENAMES = 50

export type DropFailure = { name: string; reason: string }

export type DropPlan = {
  save: File[]
  refused: DropFailure[]
}

export type DropResult = {
  saved: string[]
  failed: DropFailure[]
}

export const isFileDrag = (event: DragEvent): boolean => event.dataTransfer?.types.includes("Files") ?? false

export function planDrop(files: readonly File[]): DropPlan {
  const plan: DropPlan = { save: [], refused: [] }
  for (const file of files) {
    if (!isTextFile({ name: file.name, type: file.type }))
      plan.refused.push({ name: file.name, reason: "Only text files can be saved here for now" })
    else if (file.size > MAX_TEXT_BYTES)
      plan.refused.push({ name: file.name, reason: `Over ${formatBytes(MAX_TEXT_BYTES)}` })
    else plan.save.push(file)
  }
  return plan
}

export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf(".")
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ""
  for (let n = 2; n < MAX_RENAMES + 2; n++) {
    const next = `${stem} (${n})${ext}`
    if (!taken.has(next)) return next
  }
  return `${stem} (${Date.now()})${ext}`
}

const fileItems = (items: DataTransferItemList | undefined) => [...(items ?? [])].filter((item) => item.kind === "file")

export const dragCount = (items: DataTransferItemList | undefined): number => fileItems(items).length

export const dragGlyphs = (items: DataTransferItemList | undefined): FileType[] =>
  fileItems(items)
    .slice(0, 3)
    .map((item) => fileType({ name: "", type: item.type }))

export const dropLine = (count: number): string =>
  count === 1 ? "1 file. Release to save it." : `${count} files. Release to save them.`

const [fresh, setFresh] = createSignal<ReadonlySet<string>>(new Set())
export const isFresh = (path: string): boolean => fresh().has(path)

function markFresh(paths: readonly string[]) {
  setFresh((all) => new Set([...all, ...paths]))
  setTimeout(() => setFresh((all) => new Set([...all].filter((path) => !paths.includes(path)))), FRESH_MS)
}

export async function saveDropped(
  space: string,
  files: readonly File[],
  taken: ReadonlySet<string>,
): Promise<DropResult> {
  const plan = planDrop(files)
  const used = new Set(taken)
  const result: DropResult = { saved: [], failed: [...plan.refused] }
  for (const file of plan.save) {
    const name = uniqueName(file.name, used)
    used.add(name)
    const saved = await putFile(space, name, await file.text(), file.type || "text/plain", "none")
    if (saved.kind === "saved") {
      rememberMade(space, saved.file)
      result.saved.push(name)
    } else
      result.failed.push({ name: file.name, reason: saved.kind === "error" ? saved.message : "That name is taken" })
  }
  markFresh(result.saved.map((name) => `${space}/${name}`))
  return result
}
