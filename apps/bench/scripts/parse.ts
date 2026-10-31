export interface CuaWindow {
  readonly pid: number
  readonly id: number
  readonly title: string
}

export interface DesktopWindow {
  readonly id: string
  readonly app: string
}

export const TEXT_ROLES = new Set([
  "entry",
  "text",
  "text area",
  "text field",
  "textfield",
  "text box",
  "textbox",
  "textarea",
  "edit",
  "document",
])

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start < 0 || end <= start) return undefined
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return undefined
    }
  }
}

function structuredWindows(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value
  const windows = asRecord(value).windows
  return Array.isArray(windows) ? windows : []
}

export function cuaWindows(text: string): CuaWindow[] {
  const records = structuredWindows(parseJson(text))
  if (records.length > 0) {
    return records.flatMap((candidate) => {
      const window = asRecord(candidate)
      const id = Number(window.window_id)
      const pid = Number(window.pid)
      if (!Number.isFinite(id) || !Number.isFinite(pid)) return []
      return [{ pid, id, title: String(window.title ?? "") }]
    })
  }
  const windows: CuaWindow[] = []
  for (const line of text.split("\n")) {
    const id = line.match(/window_id[=:]\s*(\d+)/)?.[1]
    const pid = line.match(/pid[=:]\s*(\d+)/)?.[1] ?? line.match(/\(pid (\d+)\)/)?.[1]
    const title = line.match(/"([^"]*)"/)?.[1]
    if (!id || !pid || title === undefined) continue
    windows.push({ pid: Number(pid), id: Number(id), title })
  }
  return windows
}

export function findCuaWindow(windows: readonly CuaWindow[], title: string): CuaWindow | undefined {
  return windows.find((window) => window.title.includes(title))
}

export function findCuaToken(text: string): string | undefined {
  const snapshot = text.match(/snapshot_id=([A-Za-z0-9]+)/)?.[1]
  if (!snapshot) return undefined
  for (const line of text.split("\n")) {
    const row = line.match(/^\s*- \[(\d+)\] (.+)$/)
    if (!row) continue
    const role = (row[2] ?? "").split('"')[0]?.trim().toLowerCase() ?? ""
    if (TEXT_ROLES.has(role)) return `${snapshot}:${row[1]}`
  }
  return undefined
}

export function desktopWindow(text: string, title: string): DesktopWindow | undefined {
  for (const candidate of structuredWindows(parseJson(text))) {
    const window = asRecord(candidate)
    if (!String(window.title ?? "").includes(title)) continue
    const id = window.id ?? window.window_id
    if (typeof id !== "string") continue
    const app = window.app_name ?? window.app ?? window.application
    return { id, app: typeof app === "string" ? app : "" }
  }
  return undefined
}
