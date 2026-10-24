import type { HumanAsk, LifeLine, Task, WorkerRow } from "@kiko/protocol"
import {
  CodeIcon,
  FileCsvIcon,
  FileDocIcon,
  FileIcon,
  FileImageIcon,
  FileMp3Icon,
  FileMp4Icon,
  FilePdfIcon,
  FilePptIcon,
  FileTxtIcon,
  FileXlsIcon,
  FileZipIcon,
  type Glyph,
} from "@kiko/ui/icons"
import { taskProgress } from "../info/tasks-model"

export type FileLook = { glyph: Glyph; hue: string | null }

const RED = "#e5584f"
const BLUE = "#5b8def"
const GREEN = "#3fb97a"
const ORANGE = "#e8923a"
const PURPLE = "#a770e0"

const LOOKS: Record<string, FileLook> = {
  pdf: { glyph: FilePdfIcon, hue: RED },
  doc: { glyph: FileDocIcon, hue: BLUE },
  docx: { glyph: FileDocIcon, hue: BLUE },
  xls: { glyph: FileXlsIcon, hue: GREEN },
  xlsx: { glyph: FileXlsIcon, hue: GREEN },
  csv: { glyph: FileCsvIcon, hue: GREEN },
  ppt: { glyph: FilePptIcon, hue: ORANGE },
  pptx: { glyph: FilePptIcon, hue: ORANGE },
  mp4: { glyph: FileMp4Icon, hue: PURPLE },
  mov: { glyph: FileMp4Icon, hue: PURPLE },
  webm: { glyph: FileMp4Icon, hue: PURPLE },
  mp3: { glyph: FileMp3Icon, hue: PURPLE },
  wav: { glyph: FileMp3Icon, hue: PURPLE },
  m4a: { glyph: FileMp3Icon, hue: PURPLE },
  zip: { glyph: FileZipIcon, hue: null },
  gz: { glyph: FileZipIcon, hue: null },
  tar: { glyph: FileZipIcon, hue: null },
  txt: { glyph: FileTxtIcon, hue: null },
  md: { glyph: FileTxtIcon, hue: null },
}

const IMAGES = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic"])
const CODE = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "py",
  "rs",
  "go",
  "html",
  "css",
  "sh",
  "yml",
  "yaml",
  "toml",
  "sql",
])

export function fileLook(name: string): FileLook {
  const dot = name.lastIndexOf(".")
  const ext = dot < 0 ? "" : name.slice(dot + 1).toLowerCase()
  const known = LOOKS[ext]
  if (known) return known
  if (IMAGES.has(ext)) return { glyph: FileImageIcon, hue: null }
  if (CODE.has(ext)) return { glyph: CodeIcon, hue: null }
  return { glyph: FileIcon, hue: null }
}

const FILE_TILES = 4

export function fileTiles<T>(files: readonly T[]): { shown: readonly T[]; more: number } {
  const newest = files.toReversed()
  return { shown: newest.slice(0, FILE_TILES), more: Math.max(0, newest.length - FILE_TILES) }
}

const TASK_ROWS = 5
const RANK: Record<string, number> = { doing: 0, blocked: 1, review: 2, todo: 3, done: 4 }

export function deskTasks(tasks: readonly Task[]) {
  const { steps, completed, total } = taskProgress(tasks)
  const ranked = steps
    .map((task, at) => ({ task, at }))
    .toSorted((a, b) => (RANK[a.task.status] ?? 5) - (RANK[b.task.status] ?? 5) || a.at - b.at)
    .map((entry) => entry.task)
  return { shown: ranked.slice(0, TASK_ROWS), completed, total, more: Math.max(0, total - TASK_ROWS) }
}

export function nowProgress(tasks: readonly Task[]): number | null {
  const { completed, total } = taskProgress(tasks)
  return total > 0 && completed < total ? completed / total : null
}

export type Waiting = { ask: HumanAsk; choices: readonly string[] }

export function waiting(asks: readonly HumanAsk[]): Waiting[] {
  return asks.map((ask) => ({ ask, choices: ask.questions ? [] : (ask.options ?? []).slice(0, 3) }))
}

const isLive = (worker: WorkerRow) => worker.status === "running" || worker.status === "pending"

export function helpers(workers: readonly WorkerRow[]): WorkerRow[] {
  return workers.toSorted((a, b) => Number(isLive(b)) - Number(isLive(a)) || b.startedAt - a.startedAt)
}

export const helperLabel = (worker: WorkerRow): string => (isLive(worker) ? (worker.step ?? "working") : worker.status)

const MEMORY_CHIPS = 6

export function knowns(lines: readonly LifeLine[]): { shown: LifeLine[]; more: number } {
  const live = lines.filter((l) => !l.redacted && l.supersededBy == null)
  const ordered = [...live.filter((l) => l.pinned), ...live.filter((l) => !l.pinned)]
  return { shown: ordered.slice(0, MEMORY_CHIPS), more: Math.max(0, ordered.length - MEMORY_CHIPS) }
}
