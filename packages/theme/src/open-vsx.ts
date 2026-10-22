import type { ImportedTheme } from "./imported"
import { packagePath, parseJsonc, readVsCodeTheme, themeFromVsCode, type VsCodeTheme } from "./vscode-theme"
import { readZipEntries } from "./zip"

const API = "https://open-vsx.org/api"
const PROXY = "/api/open-vsx?url="
const MAX_THEME_BYTES = 256 * 1024
const MAX_THEMES = 40
const LICENSES = new Set(["0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0", "ISC", "MIT", "MPL-2.0", "Unlicense"])

export type OpenVsxItem = { namespace: string; name: string; displayName: string; description: string; downloadCount: number }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const unreadable = () => new Error("Open VSX returned an unreadable response.")

const NO_THEMES = "That extension has no compatible color themes."
const UNKNOWN_REASON = "That theme could not be imported."

type Outcome = { theme?: ImportedTheme; reason?: string }

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : ""
  const safe = message.length > 0 && message.length <= 200 && !/[\\/]/.test(message)
  return safe ? message : UNKNOWN_REASON
}

export type Send = (path: string, init: { signal?: AbortSignal }) => Promise<Response>

async function download(url: string, signal: AbortSignal | undefined, send: Send): Promise<Uint8Array> {
  const response = await send(PROXY + encodeURIComponent(url), { signal })
  if (!response.ok) throw new Error("Open VSX is unavailable right now. Try again.")
  return new Uint8Array(await response.arrayBuffer())
}

function parseObject(bytes: Uint8Array | undefined): Record<string, unknown> {
  if (!bytes) throw unreadable()
  let value: unknown
  try {
    value = parseJsonc(new TextDecoder().decode(bytes))
  } catch {
    throw unreadable()
  }
  if (!isObject(value)) throw unreadable()
  return value
}

export async function searchThemes(query: string, signal?: AbortSignal, send: Send = fetch): Promise<OpenVsxItem[]> {
  const search = text(query)
  if (!search) return []
  const url = new URL(`${API}/-/search`)
  url.searchParams.set("query", search)
  url.searchParams.set("category", "Themes")
  url.searchParams.set("sortBy", "downloadCount")
  url.searchParams.set("sortOrder", "desc")
  url.searchParams.set("size", "16")
  const data = parseObject(await download(url.href, signal, send))
  if (!Array.isArray(data.extensions)) throw unreadable()
  return data.extensions.flatMap((item): OpenVsxItem[] => {
    if (!isObject(item) || !text(item.namespace) || !text(item.name)) return []
    const name = text(item.name)
    return [{ namespace: text(item.namespace), name, displayName: text(item.displayName) || name, description: text(item.description), downloadCount: typeof item.downloadCount === "number" ? item.downloadCount : 0 }]
  })
}

function contributedThemes(manifest: Record<string, unknown>): Array<{ path: string; label: string }> {
  const contributes = isObject(manifest.contributes) ? manifest.contributes : {}
  if (!Array.isArray(contributes.themes)) return []
  return contributes.themes.flatMap((theme) => (isObject(theme) && text(theme.path) ? [{ path: text(theme.path), label: text(theme.label) }] : []))
}

export async function installTheme(item: OpenVsxItem, signal?: AbortSignal, send: Send = fetch): Promise<ImportedTheme[]> {
  const detail = parseObject(await download(`${API}/${encodeURIComponent(item.namespace)}/${encodeURIComponent(item.name)}`, signal, send))
  const files = isObject(detail.files) ? detail.files : {}
  const version = text(detail.version)
  const license = text(detail.license)
  if (!text(files.manifest) || !text(files.download) || !text(files.sha256) || !version) throw unreadable()
  if (!LICENSES.has(license)) throw new Error("That theme's license is not on the allowed list.")

  const contributions = contributedThemes(parseObject(await download(text(files.manifest), signal, send)))
  if (contributions.length === 0) throw new Error("That extension does not contain color themes.")
  if (contributions.length > MAX_THEMES) throw new Error("That extension contains too many color themes to import safely.")

  const vsix = await download(text(files.download), signal, send)
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", vsix.slice()))].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  const expected = new TextDecoder().decode(await download(text(files.sha256), signal, send)).trim().split(/\s+/)[0]?.toLowerCase()
  if (digest !== expected) throw new Error("That theme failed its integrity check.")

  const entries = await readZipEntries(vsix, (name) => name.startsWith("extension/") && name.endsWith(".json"), MAX_THEME_BYTES)
  const packaged = parseObject(entries.get("extension/package.json"))
  const packagedId = `${text(packaged.publisher)}.${text(packaged.name)}`.toLowerCase()
  if (packagedId !== `${item.namespace}.${item.name}`.toLowerCase() || text(packaged.version) !== version) {
    throw new Error("That extension package does not match the selected Open VSX theme.")
  }

  const read = async (path: string): Promise<VsCodeTheme> => parseObject(entries.get(path)) as VsCodeTheme
  const source = `${item.namespace}.${item.name}`
  const outcomes: Outcome[] = await Promise.all(
    contributions.map(async ({ path, label }): Promise<Outcome> => {
      try {
        const file = packagePath("extension/package.json", path)
        const json = await readVsCodeTheme(file, read)
        return { theme: themeFromVsCode(json, { id: `${source}:${file}`, name: label || item.displayName || item.name, source }) }
      } catch (error) {
        return { reason: reasonOf(error) }
      }
    }),
  )
  const imported = outcomes.flatMap((outcome) => (outcome.theme ? [outcome.theme] : []))
  if (imported.length === 0) throw new Error(outcomes[0]?.reason ?? NO_THEMES)
  return imported
}
