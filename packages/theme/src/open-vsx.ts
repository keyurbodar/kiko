import type { ImportedTheme } from "./imported"
import type { ThemeAppearance } from "./palette"
import { packagePath, parseJsonc, readVsCodeTheme, themeFromVsCode, type VsCodeTheme } from "./vscode-theme"
import { readZipEntries } from "./zip"

const API = "https://open-vsx.org/api"
const PROXY = "/api/open-vsx?url="
const ICON_HOSTS = new Set(["open-vsx.org", "openvsx.eclipsecontent.org"])
const MAX_THEME_BYTES = 256 * 1024
const MAX_THEMES = 40
const SEARCH_SIZE = 24
const SHOWN = 16
const LICENSES = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "Unlicense",
])
const LICENSE_TEXTS = [
  /to deal in the software without restriction/,
  /permission to use, copy, modify, and\/?or distribute this software for any purpose with or without fee is hereby granted/,
  /apache license,? version 2\.0/,
  /redistribution and use in source and binary forms, with or without modification, are permitted/,
  /mozilla public license,? (version|v\.?) ?2\.0/,
  /this is free and unencumbered software released into the public domain/,
  /cc0 1\.0 universal/,
]
const SEE_LICENSE = /^see license in /i
const NLS_KEY = /^%([^%]+)%$/
const OPEN_ONLY = "Kiko only imports themes under open licenses like MIT."

export type ThemeVariant = { label: string; appearance: ThemeAppearance | null }

export type OpenVsxItem = {
  namespace: string
  name: string
  displayName: string
  description: string
  downloadCount: number
  icon: string | null
  variants: ThemeVariant[]
}

export class OpenVsxError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable = false) {
    super(message)
    this.retryable = retryable
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const unreadable = () => new OpenVsxError("Open VSX returned an unreadable response.", true)

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
  if (!response.ok) throw new OpenVsxError("Open VSX is unavailable right now. Try again.", true)
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

type Contribution = { path: string; label: string; uiTheme: string }

function contributionsOf(manifest: Record<string, unknown>): { themes: Contribution[]; icons: boolean } {
  const contributes = isObject(manifest.contributes) ? manifest.contributes : {}
  const themes = Array.isArray(contributes.themes) ? contributes.themes : []
  const icons = Array.isArray(contributes.iconThemes) && contributes.iconThemes.length > 0
  return {
    icons,
    themes: themes.flatMap((theme) =>
      isObject(theme) && text(theme.path)
        ? [{ path: text(theme.path), label: text(theme.label), uiTheme: text(theme.uiTheme) }]
        : [],
    ),
  }
}

const appearanceOfUi = (uiTheme: string): ThemeAppearance | null =>
  uiTheme === "vs" || uiTheme === "hc-light" ? "light" : uiTheme === "vs-dark" || uiTheme === "hc-black" ? "dark" : null

function iconOf(files: unknown): string | null {
  const raw = isObject(files) ? text(files.icon) : ""
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && ICON_HOSTS.has(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

type Hit = { item: OpenVsxItem; version: string }

function readHit(raw: unknown): Hit[] {
  if (!isObject(raw) || !text(raw.namespace) || !text(raw.name)) return []
  const name = text(raw.name)
  return [
    {
      version: text(raw.version),
      item: {
        namespace: text(raw.namespace),
        name,
        displayName: text(raw.displayName) || name,
        description: text(raw.description),
        downloadCount: typeof raw.downloadCount === "number" ? raw.downloadCount : 0,
        icon: iconOf(raw.files),
        variants: [],
      },
    },
  ]
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[-_.\s]+/g, " ")
    .trim()

function ranked(hits: Hit[], query: string): Hit[] {
  const wanted = fold(query)
  const matches = (hit: Hit) =>
    [hit.item.displayName, hit.item.name, hit.item.namespace].some((field) => fold(field).includes(wanted))
  const scored = hits.map((hit, index) => ({ hit, index, match: matches(hit) }))
  scored.sort((a, b) => {
    if (a.match !== b.match) return a.match ? -1 : 1
    if (a.match) return b.hit.item.downloadCount - a.hit.item.downloadCount || a.index - b.index
    return a.index - b.index
  })
  return scored.map((entry) => entry.hit)
}

async function withVariants(hit: Hit, signal: AbortSignal | undefined, send: Send): Promise<OpenVsxItem | null> {
  if (!hit.version) return hit.item
  const { namespace, name } = hit.item
  const url = `${API}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/${encodeURIComponent(hit.version)}/file/package.json`
  try {
    const { themes } = contributionsOf(parseObject(await download(url, signal, send)))
    if (themes.length === 0) return null
    return {
      ...hit.item,
      variants: themes.map((theme) => ({
        label: NLS_KEY.test(theme.label) ? hit.item.displayName : theme.label || hit.item.displayName,
        appearance: appearanceOfUi(theme.uiTheme),
      })),
    }
  } catch (error) {
    if (signal?.aborted) throw error
    return hit.item
  }
}

export async function searchThemes(query: string, signal?: AbortSignal, send: Send = fetch): Promise<OpenVsxItem[]> {
  const search = text(query)
  if (!search) return []
  const url = new URL(`${API}/-/search`)
  url.searchParams.set("query", search)
  url.searchParams.set("category", "Themes")
  url.searchParams.set("sortBy", "relevance")
  url.searchParams.set("sortOrder", "desc")
  url.searchParams.set("size", String(SEARCH_SIZE))
  const data = parseObject(await download(url.href, signal, send))
  if (!Array.isArray(data.extensions)) throw unreadable()
  const hits = ranked(data.extensions.flatMap(readHit), search)
  const checked = await Promise.all(hits.map((hit) => withVariants(hit, signal, send)))
  return checked.flatMap((item) => (item ? [item] : [])).slice(0, SHOWN)
}

async function checkLicense(
  detail: Record<string, unknown>,
  files: Record<string, unknown>,
  displayName: string,
  signal: AbortSignal | undefined,
  send: Send,
): Promise<void> {
  const license = text(detail.license)
  if (LICENSES.has(license)) return
  if (!license) throw new OpenVsxError(`${displayName} does not say what license it uses. ${OPEN_ONLY}`)
  if (!SEE_LICENSE.test(license)) throw new OpenVsxError(`${displayName} uses the ${license} license. ${OPEN_ONLY}`)
  const own = new OpenVsxError(`${displayName} has its own license, and ${OPEN_ONLY}`)
  if (!text(files.license)) throw own
  const body = new TextDecoder().decode(await download(text(files.license), signal, send))
  const normalized = body.toLowerCase().replace(/\s+/g, " ")
  if (!LICENSE_TEXTS.some((pattern) => pattern.test(normalized))) throw own
}

async function verifiedPackage(
  files: Record<string, unknown>,
  signal: AbortSignal | undefined,
  send: Send,
): Promise<Uint8Array> {
  const vsix = await download(text(files.download), signal, send)
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", vsix.slice()))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  const expected = new TextDecoder()
    .decode(await download(text(files.sha256), signal, send))
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase()
  if (digest !== expected) throw new OpenVsxError("That theme failed its integrity check. Try again.", true)
  return vsix
}

function packageReader(vsix: Uint8Array, first: ReadonlySet<string>) {
  const cache = new Map<string, Promise<Uint8Array | undefined>>()
  const all = readZipEntries(vsix, (name) => first.has(name), MAX_THEME_BYTES)
  for (const name of first)
    cache.set(
      name,
      all.then((entries) => entries.get(name)),
    )
  return (path: string): Promise<Uint8Array | undefined> => {
    const known = cache.get(path)
    if (known) return known
    const loading = readZipEntries(vsix, (name) => name === path, MAX_THEME_BYTES).then((entries) => entries.get(path))
    cache.set(path, loading)
    return loading
  }
}

export async function installTheme(
  item: Pick<OpenVsxItem, "namespace" | "name" | "displayName">,
  signal?: AbortSignal,
  send: Send = fetch,
): Promise<ImportedTheme[]> {
  const displayName = item.displayName || item.name
  const detail = parseObject(
    await download(`${API}/${encodeURIComponent(item.namespace)}/${encodeURIComponent(item.name)}`, signal, send),
  )
  const files = isObject(detail.files) ? detail.files : {}
  const version = text(detail.version)
  if (!text(files.manifest) || !text(files.download) || !text(files.sha256) || !version) throw unreadable()

  const { themes, icons } = contributionsOf(parseObject(await download(text(files.manifest), signal, send)))
  if (themes.length === 0) {
    throw new OpenVsxError(
      icons ? `${displayName} is a file icon theme, not a color theme.` : `${displayName} has no color themes in it.`,
    )
  }
  if (themes.length > MAX_THEMES) throw new OpenVsxError(`${displayName} has too many color themes to import safely.`)
  await checkLicense(detail, files, displayName, signal, send)

  const vsix = await verifiedPackage(files, signal, send)
  const manifestPath = "extension/package.json"
  const paths = themes.map(({ path }) => packagePath(manifestPath, path))
  const read = packageReader(vsix, new Set([manifestPath, ...paths]))
  const packaged = parseObject(await read(manifestPath))
  const packagedId = `${text(packaged.publisher)}.${text(packaged.name)}`.toLowerCase()
  if (packagedId !== `${item.namespace}.${item.name}`.toLowerCase() || text(packaged.version) !== version) {
    throw new OpenVsxError("That extension package does not match the selected Open VSX theme.")
  }

  const strings = await read("extension/package.nls.json")
    .then((bytes) => (bytes ? parseObject(bytes) : {}))
    .catch(() => ({}) as Record<string, unknown>)
  const labelOf = (label: string) => {
    const key = NLS_KEY.exec(label)?.[1]
    return key === undefined ? label : text(strings[key])
  }
  const source = `${item.namespace}.${item.name}`
  const readTheme = async (path: string): Promise<VsCodeTheme> => parseObject(await read(path)) as VsCodeTheme
  const outcomes: Outcome[] = await Promise.all(
    themes.map(async ({ label, uiTheme }, index): Promise<Outcome> => {
      try {
        const file = paths[index]!
        const json = await readVsCodeTheme(file, readTheme)
        return {
          theme: themeFromVsCode(json, {
            id: `${source}:${file}`,
            name: labelOf(label) || displayName,
            source,
            uiTheme,
          }),
        }
      } catch (error) {
        return { reason: reasonOf(error) }
      }
    }),
  )
  const imported = outcomes.flatMap((outcome) => (outcome.theme ? [outcome.theme] : []))
  if (imported.length === 0) throw new OpenVsxError(outcomes[0]?.reason ?? UNKNOWN_REASON)
  return imported
}
