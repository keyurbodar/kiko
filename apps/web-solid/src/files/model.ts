import { fileName } from "@kiko/protocol"

export const ROOT = ""

export type TreeIndex = {
  children: Map<string, string[]>
  folders: Set<string>
}

export const folderLabel = (path: string) =>
  path === ROOT ? "Files" : path === "attachments" ? "From this chat" : path === "home" ? "Home" : fileName(path)
export const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ROOT)
export const join = (dir: string, name: string) => (dir === ROOT ? name : `${dir}/${name}`)

export const isHidden = (path: string) => path.split("/").some((part) => part.startsWith("."))

const byName = (a: string, b: string) => fileName(a).localeCompare(fileName(b), undefined, { numeric: true })

export function buildIndex(paths: Iterable<string>, emptyFolders: Iterable<string> = []): TreeIndex {
  const folders = new Set<string>()
  const files = new Set<string>()
  const addFolders = (path: string) => {
    for (let dir = dirname(path); dir !== ROOT; dir = dirname(dir)) folders.add(dir)
  }
  for (const raw of paths) {
    const path = raw.replace(/^\/+/, "")
    if (!path) continue
    files.add(path)
    addFolders(path)
  }
  for (const raw of emptyFolders) {
    const path = raw.replace(/^\/+|\/+$/g, "")
    if (!path) continue
    folders.add(path)
    addFolders(path)
  }
  for (const dir of folders) files.delete(dir)
  const children = new Map<string, string[]>([[ROOT, []]])
  for (const dir of folders) children.set(dir, [])
  for (const id of [...folders, ...files]) children.get(dirname(id))!.push(id)
  for (const list of children.values()) {
    list.sort((a, b) => {
      const fa = folders.has(a)
      const fb = folders.has(b)
      return fa === fb ? byName(a, b) : fa ? -1 : 1
    })
  }
  return { children, folders }
}

export function pathsUnder(paths: Iterable<string>, path: string): string[] {
  return [...paths].filter((p) => p === path || p.startsWith(`${path}/`))
}

export type KeyValueStore = Pick<Storage, "getItem" | "setItem">

const expandedKey = (roomId: string) => `kiko:files:expanded:${roomId}`

export function loadExpanded(roomId: string, store: KeyValueStore | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(expandedKey(roomId)) ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

export function saveExpanded(roomId: string, store: KeyValueStore | undefined, expanded: readonly string[]) {
  try {
    store?.setItem(expandedKey(roomId), JSON.stringify(expanded))
  } catch {}
}

export const VIRTUALIZE_AFTER = 500

export const HOME = "home"
export const inHome = (p: string) => p === HOME || p.startsWith(`${HOME}/`)
export const strip = (p: string) => (p === HOME ? "" : p.slice(HOME.length + 1))
export const where = (chatId: string, p: string) =>
  inHome(p) ? { space: HOME, path: strip(p) } : { space: chatId, path: p }

export const createParent = (touched: string | null | undefined): string => {
  if (!touched) return ROOT
  return touched.endsWith("/") ? touched.replace(/\/+$/, "") : dirname(touched)
}
