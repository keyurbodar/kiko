// Searching Open VSX for color themes and importing one. Ported from t3code (MIT),
// apps/web/src/openVsxThemes.ts. DEVIATION: fflate unzips the VSIX instead of JSZip (smaller),
// and the checksum uses Web Crypto instead of @noble/hashes. The browser fetches open-vsx.org
// directly: every endpoint used here answers with `access-control-allow-origin: *`.

import { unzipSync } from "fflate"
import {
  isVsCodeThemeFile,
  pairVsCodeThemes,
  parseVsCodeThemeFile,
  resolveLabelCollisions,
  stripJsonComments,
} from "./import"
import type { ThemeDefinition } from "./palette"

const SEARCH_URL = "https://open-vsx.org/api/-/search"
const MAX_VSIX_BYTES = 20 * 1024 * 1024
const MAX_SEARCH_BYTES = 512 * 1024
const MAX_DETAIL_BYTES = 256 * 1024
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_THEME_BYTES = 256 * 1024
const MAX_ZIP_ENTRIES = 5_000
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
const MAX_COMPRESSION_RATIO = 200
const MAX_THEMES_PER_EXTENSION = 40
const MAX_INCLUDE_DEPTH = 8
const TIMEOUT_MS = 10_000
/** Results without one of these licenses are left out: kiko only installs open-source themes. */
const LICENSES = new Set(["0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0", "ISC", "MIT", "MPL-2.0", "Unlicense"])
/** The workbench colors the converter reads. Everything else in a theme file is dropped. */
const USED_COLORS = new Set([
  "activityBar.background",
  "activityBarBadge.background",
  "badge.background",
  "button.background",
  "button.foreground",
  "contrastBorder",
  "descriptionForeground",
  "disabledForeground",
  "dropdown.background",
  "dropdown.border",
  "editor.background",
  "editor.foreground",
  "editor.selectionBackground",
  "editorCursor.foreground",
  "editorError.foreground",
  "editorGroup.border",
  "editorPane.background",
  "editorWarning.foreground",
  "editorWidget.background",
  "errorForeground",
  "focusBorder",
  "foreground",
  "input.background",
  "input.border",
  "input.placeholderForeground",
  "list.activeSelectionBackground",
  "list.hoverBackground",
  "list.inactiveSelectionBackground",
  "menu.background",
  "panel.background",
  "panel.border",
  "progressBar.background",
  "quickInput.background",
  "scrollbarSlider.background",
  "sideBar.background",
  "sideBar.border",
  "sideBar.foreground",
  "terminal.background",
  "terminal.foreground",
  "terminal.selectionBackground",
  "terminalCursor.foreground",
  "textCodeBlock.background",
  "textLink.foreground",
])

export type OpenVsxSort = "downloadCount" | "rating" | "timestamp" | "relevance"

export type OpenVsxExtension = {
  id: string
  collectionId: string
  name: string
  publisher: string
  description: string
  downloadCount: number
  iconUrl: string | null
  sourceUrl: string | null
  manifestUrl: string
  sha256Url: string
  vsixUrl: string
  version: string
  license: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** A stable id fragment (FNV-1a, two lanes). Ids need to be stable, not secret. */
function shortHash(value: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < value.length; i += 1) {
    a = Math.imul(a ^ value.charCodeAt(i), 0x01000193) >>> 0
    b = Math.imul(b ^ value.charCodeAt(i), 0x811c9dc5) >>> 0
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0").slice(0, 4)
}

function trustedUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname.toLowerCase() === "open-vsx.org" ? url.toString() : null
  } catch {
    return null
  }
}

function publicUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value : isRecord(value) && typeof value.url === "string" ? value.url : null
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

function contributions(manifest: Record<string, unknown>): Array<Record<string, unknown>> {
  const contributes = isRecord(manifest.contributes) ? manifest.contributes : null
  return Array.isArray(contributes?.themes) ? contributes.themes.filter(isRecord) : []
}

const licenseMatches = (manifest: Record<string, unknown>, license: string) =>
  typeof manifest.license === "string" && manifest.license.trim().toLowerCase() === license.toLowerCase()

function parseObject(text: string, what: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(stripJsonComments(text))
  } catch {
    throw new Error(`${what} is not valid JSON.`)
  }
  if (!isRecord(value)) throw new Error(`${what} is not valid JSON.`)
  return value
}

async function readCapped(response: Response, limit: number, tooLarge: string): Promise<Uint8Array> {
  const length = response.headers.get("content-length")
  if (length && Number(length) > limit) throw new Error(tooLarge)
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > limit) throw new Error(tooLarge)
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error(tooLarge)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (parent?.aborted) abort()
  else parent?.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(abort, TIMEOUT_MS)
  try {
    return await run(controller.signal)
  } catch (cause) {
    if (controller.signal.aborted && !parent?.aborted) throw new Error("Open VSX took too long to respond.", { cause })
    throw cause
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener("abort", abort)
  }
}

function extensionFromDetail(value: unknown): OpenVsxExtension | null {
  if (!isRecord(value) || !isRecord(value.files)) throw new Error("Open VSX returned malformed theme details.")
  const namespace = typeof value.namespace === "string" ? value.namespace.trim() : ""
  const name = typeof value.name === "string" ? value.name.trim() : ""
  const displayName = (typeof value.displayName === "string" ? value.displayName.trim() : "") || name
  const version = typeof value.version === "string" ? value.version.trim() : ""
  const license = typeof value.license === "string" ? value.license.trim() : ""
  const manifestUrl = trustedUrl(value.files.manifest)
  const sha256Url = trustedUrl(value.files.sha256)
  const vsixUrl = trustedUrl(value.files.download)
  if (!namespace || !name || !version || !manifestUrl || !sha256Url || !vsixUrl) throw new Error("Open VSX returned malformed theme details.")
  if (!LICENSES.has(license)) return null
  const id = `${namespace}.${name}`
  const normalized = `open-vsx:${id.toLowerCase()}`
  return {
    id,
    collectionId: /^[a-z0-9][a-z0-9.:-]{0,127}$/.test(normalized) ? normalized : `open-vsx:${shortHash(id)}`,
    name: displayName,
    publisher: namespace,
    description: typeof value.description === "string" ? value.description : "",
    downloadCount: typeof value.downloadCount === "number" && Number.isFinite(value.downloadCount) ? value.downloadCount : 0,
    iconUrl: trustedUrl(value.files.icon),
    sourceUrl: publicUrl(value.repository) ?? publicUrl(value.homepage) ?? publicUrl(value.url),
    manifestUrl,
    sha256Url,
    vsixUrl,
    version,
    license,
  }
}

/** Searches Open VSX's Themes category. Returns up to eight open-source color themes. */
export async function searchOpenVsxThemes(query: string, options: { signal?: AbortSignal; sortBy?: OpenVsxSort } = {}): Promise<OpenVsxExtension[]> {
  const search = query.trim()
  if (!search) return []
  const url = new URL(SEARCH_URL)
  url.searchParams.set("query", search)
  url.searchParams.set("category", "Themes")
  url.searchParams.set("sortBy", options.sortBy ?? "downloadCount")
  url.searchParams.set("sortOrder", "desc")
  // A few extra, because results without a supported license are left out.
  url.searchParams.set("size", "16")
  const value = await withTimeout(async (signal) => {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error("Open VSX search is unavailable right now.")
    try {
      return JSON.parse(text(await readCapped(response, MAX_SEARCH_BYTES, "Open VSX returned an unexpectedly large response."))) as unknown
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith("Open VSX")) throw cause
      throw new Error("Open VSX returned an unreadable response.")
    }
  }, options.signal)
  if (!isRecord(value) || !Array.isArray(value.extensions)) throw new Error("Open VSX returned an unreadable search response.")
  const identities = value.extensions.flatMap((c): Array<[string, string]> =>
    isRecord(c) && typeof c.namespace === "string" && typeof c.name === "string" && c.namespace && c.name ? [[c.namespace, c.name]] : [],
  )
  const details = await Promise.allSettled(
    identities.slice(0, 16).map(([namespace, name]) =>
      withTimeout(async (signal) => {
        const response = await fetch(`https://open-vsx.org/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`, { signal })
        if (!response.ok) throw new Error("Open VSX theme details are unavailable.")
        const extension = extensionFromDetail(JSON.parse(text(await readCapped(response, MAX_DETAIL_BYTES, "too large"))))
        if (!extension) return null
        const [manifestResponse, packageResponse] = await Promise.all([
          fetch(extension.manifestUrl, { signal }),
          fetch(extension.vsixUrl, { method: "HEAD", signal }),
        ])
        if (!manifestResponse.ok) throw new Error("manifest unavailable")
        if (!packageResponse.ok) return null
        const size = Number(packageResponse.headers.get("content-length"))
        if (Number.isFinite(size) && size > MAX_VSIX_BYTES) return null
        const manifest = parseObject(text(await readCapped(manifestResponse, MAX_MANIFEST_BYTES, "too large")), "Extension manifest")
        return contributions(manifest).length > 0 && licenseMatches(manifest, extension.license) ? extension : null
      }, options.signal),
    ),
  )
  if (options.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError")
  const done = details.filter((r) => r.status === "fulfilled")
  if (identities.length > 0 && done.length === 0) throw new Error("Open VSX theme details are unavailable right now.")
  return done.flatMap((r) => (r.value ? [r.value] : [])).slice(0, 8)
}

/** A package path, resolved against the extension root. Escapes and absolute paths are refused. */
function packagePath(path: string, relativeTo = "extension/"): string {
  if (path.length > 1024 || path.includes("\0") || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
    throw new Error("Theme path is not a safe relative package path.")
  }
  const segments = relativeTo.split("/").slice(0, -1)
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (segments.length <= 1) throw new Error("Theme path escapes the extension package.")
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  if (segments[0] !== "extension") segments.unshift("extension")
  return segments.join("/")
}

/** Unzips only the JSON files of the package, after checking every entry's sizes. */
function unzipJson(bytes: Uint8Array): Map<string, string> {
  let entries = 0
  let total = 0
  let refused: string | null = null
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        entries += 1
        total += file.originalSize
        if (entries > MAX_ZIP_ENTRIES) refused = "That extension package has too many files."
        else if (total > MAX_UNCOMPRESSED_BYTES) refused = "That extension package expands beyond the safe import limit."
        else if (file.originalSize > 0 && (file.size === 0 || file.originalSize / file.size > MAX_COMPRESSION_RATIO)) {
          refused = "That extension package has an unsafe compression ratio."
        }
        return refused === null && /\.(json|jsonc)$/i.test(file.name) && file.originalSize <= MAX_THEME_BYTES
      },
    })
  } catch {
    throw new Error("That Open VSX extension package could not be opened.")
  }
  if (refused) throw new Error(refused)
  const out = new Map<string, string>()
  for (const [name, data] of Object.entries(files)) out.set(name.replaceAll("\\", "/"), text(data))
  return out
}

function sanitize(value: Record<string, unknown>): Record<string, unknown> {
  const colors: Record<string, string> = {}
  if (isRecord(value.colors)) {
    for (const [key, color] of Object.entries(value.colors)) {
      if (USED_COLORS.has(key) && typeof color === "string" && color.length <= 128) colors[key] = color
    }
  }
  return { ...(typeof value.include === "string" ? { include: value.include } : {}), ...(typeof value.type === "string" ? { type: value.type } : {}), colors }
}

function loadTheme(files: Map<string, string>, path: string, depth = 0, seen: ReadonlySet<string> = new Set()): Record<string, unknown> {
  if (depth >= MAX_INCLUDE_DEPTH) throw new Error("Theme includes are nested too deeply.")
  if (seen.has(path)) throw new Error("Theme includes contain a cycle.")
  const source = files.get(path)
  if (source === undefined) throw new Error(`${path} is missing from the extension package.`)
  const value = sanitize(parseObject(source, path))
  if (typeof value.include !== "string") return value
  const base = loadTheme(files, packagePath(value.include, path), depth + 1, new Set([...seen, path]))
  return { ...base, ...value, colors: { ...(base.colors as object), ...(value.colors as object) } }
}

/** Downloads an extension, verifies its checksum and manifest, and converts its color themes. */
export async function importOpenVsxExtension(extension: OpenVsxExtension, signal?: AbortSignal): Promise<ThemeDefinition[]> {
  const fetchOk = async (url: string, what: string) => {
    const response = await fetch(url, signal ? { signal } : {})
    if (!response.ok) throw new Error(what)
    return response
  }
  const advertised = parseObject(
    text(await readCapped(await fetchOk(extension.manifestUrl, "That Open VSX extension has no readable manifest."), MAX_MANIFEST_BYTES, "That Open VSX extension manifest is too large.")),
    "Extension manifest",
  )
  const count = contributions(advertised).length
  if (count === 0) throw new Error("That extension does not contain color themes.")
  if (count > MAX_THEMES_PER_EXTENSION) throw new Error("That extension contains too many color themes to import safely.")

  const packageBytes = await readCapped(
    await fetchOk(extension.vsixUrl, "That Open VSX theme could not be downloaded."),
    MAX_VSIX_BYTES,
    "That theme extension is too large to import safely.",
  )
  const expected = text(await readCapped(await fetchOk(extension.sha256Url, "That Open VSX theme has no readable checksum."), 256, "That Open VSX checksum response is invalid."))
    .trim()
    .split(/\s+/)[0]
  if (!expected || !/^[a-f\d]{64}$/i.test(expected)) throw new Error("That Open VSX theme has an invalid checksum.")
  if ((await sha256Hex(packageBytes)).toLowerCase() !== expected.toLowerCase()) throw new Error("That Open VSX theme failed its integrity check.")
  signal?.throwIfAborted()

  const files = unzipJson(packageBytes)
  const manifest = parseObject(files.get("extension/package.json") ?? "", "Extension manifest")
  if (
    typeof manifest.publisher !== "string" ||
    typeof manifest.name !== "string" ||
    `${manifest.publisher}.${manifest.name}`.toLowerCase() !== extension.id.toLowerCase() ||
    manifest.version !== extension.version
  ) {
    throw new Error("That extension package does not match the selected Open VSX theme.")
  }
  if (!licenseMatches(manifest, extension.license)) throw new Error("That extension package does not match its advertised license.")
  const themes = contributions(manifest)
  if (themes.length === 0) throw new Error("That extension does not contain color themes.")
  if (themes.length > MAX_THEMES_PER_EXTENSION) throw new Error("That extension contains too many color themes to import safely.")

  const parsed: Array<{ theme: ThemeDefinition; sourceName: string; sourcePath: string }> = []
  let failed = false
  for (const contribution of themes) {
    signal?.throwIfAborted()
    try {
      if (typeof contribution.path !== "string") throw new Error("theme path is missing")
      const path = packagePath(contribution.path)
      const value = loadTheme(files, path)
      const ui = contribution.uiTheme
      const type = ui === "vs" ? "light" : ui === "vs-dark" ? "dark" : ui === "hc-black" || ui === "hc-light" ? ui : null
      const label = typeof contribution.label === "string" && contribution.label.trim() ? contribution.label.trim() : extension.name
      const decorated = { ...value, displayName: label, ...(type ? { type } : {}) }
      if (!isVsCodeThemeFile(decorated)) throw new Error("not a VS Code color theme")
      parsed.push({ theme: parseVsCodeThemeFile(decorated), sourceName: path.split("/").at(-1)!, sourcePath: path })
    } catch {
      failed = true
    }
  }
  if (failed) throw new Error("One or more color themes in that extension could not be imported safely.")
  if (parsed.length === 0) throw new Error("That extension has no compatible color themes.")

  // As in t3code: an id comes from the theme's file, so renaming or reordering variants keeps it.
  // A file several contributions share is told apart by which use of it this is.
  const extensionId = extension.id.toLowerCase()
  const themeId = (source: string) => `ovx-theme-${shortHash(`${extensionId}:${source}`)}`
  const uses = new Map<string, number>()
  for (const { sourcePath } of parsed) uses.set(sourcePath, (uses.get(sourcePath) ?? 0) + 1)
  const seen = new Map<string, number>()
  const sources = parsed.map(({ sourcePath }) => {
    if (uses.get(sourcePath) === 1) return sourcePath
    const n = seen.get(sourcePath) ?? 0
    seen.set(sourcePath, n + 1)
    return `${sourcePath}\0${n}`
  })
  const withIds = resolveLabelCollisions(parsed).map((theme, i) => ({ ...theme, id: themeId(sources[i]!) }))
  const paired = pairVsCodeThemes(withIds, { pairedId: (light, dark) => themeId([light.id, dark.id].sort().join(":")) })
  const collection = { id: extension.collectionId, label: extension.name.slice(0, 48) }
  return paired.map((theme) => ({ ...theme, collection }))
}
