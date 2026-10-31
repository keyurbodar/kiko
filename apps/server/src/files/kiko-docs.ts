import { sha256Hex } from "@kiko/durable/hash"
import { KIKO } from "@kiko/protocol"
import { KIKO_DOCS } from "../agent/kiko-docs.gen"
import { BUILTIN_RECIPES } from "../recipes/catalog.gen"
import type { FsEntry, FsFail } from "../room/files"
import type { FilesBackend } from "./room-fs"
import { type BatchChange, batchPaths } from "./batch"

const REFUSAL = `/${KIKO} is read-only. It explains how Kiko works. Write your own files under / or /home.`

const DOCS = new Map<string, string>([
  ...KIKO_DOCS,
  ...BUILTIN_RECIPES.map(([slug, text]) => [`recipes/${slug}/RECIPE.md`, text] as const),
])
const FOLDERS = new Set(
  [...DOCS.keys()].flatMap((name) =>
    name
      .split("/")
      .slice(0, -1)
      .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
  ),
)
const encoder = new TextEncoder()
const sha = new Map<string, string>()

async function entry(name: string): Promise<FsEntry & { kind: "file" }> {
  const text = DOCS.get(name) ?? ""
  let digest = sha.get(name)
  if (digest === undefined) {
    digest = await sha256Hex(text)
    sha.set(name, digest)
  }
  return {
    kind: "file",
    path: name,
    id: `kiko:${name}`,
    size: encoder.encode(text).length,
    type: "text/markdown",
    sha256: digest,
    r2Key: `kiko:${name}`,
    at: 0,
  }
}

const under = (dir: string, name: string) => dir === "" || name.startsWith(`${dir}/`)
const direct = (dir: string, name: string) => under(dir, name) && !name.slice(dir ? dir.length + 1 : 0).includes("/")

function folder(path: string): FsEntry {
  const names = [...DOCS.keys()].filter((name) => under(path, name))
  const size = names.reduce((sum, name) => sum + encoder.encode(DOCS.get(name) ?? "").length, 0)
  return { kind: "directory", path, files: names.length, size }
}

const refuse = (): FsFail => ({ ok: false, code: "invalid", message: REFUSAL })

export function kikoDocsBackend(): FilesBackend {
  return {
    async stat(path) {
      if (path === "" || FOLDERS.has(path)) return folder(path)
      return DOCS.has(path) ? await entry(path) : null
    },
    async list(dir, recursive) {
      if (DOCS.has(dir)) return [await entry(dir)]
      if (dir !== "" && !FOLDERS.has(dir))
        return { ok: false, code: "not_found", message: `no such file or folder: /${KIKO}/${dir}` }
      const pick = recursive ? under : direct
      const dirs = [...FOLDERS].filter((name) => name !== dir && pick(dir, name)).sort()
      const files = [...DOCS.keys()].filter((name) => pick(dir, name))
      return [...dirs.map(folder), ...(await Promise.all(files.map((name) => entry(name))))]
    },
    async bytes(r2Key, maxBytes) {
      const name = r2Key.startsWith(`${KIKO}:`) ? r2Key.slice(KIKO.length + 1) : ""
      const text = DOCS.get(name)
      if (text === undefined) return null
      const bytes = encoder.encode(text)
      return maxBytes === undefined ? bytes : bytes.subarray(0, maxBytes)
    },
    async write() {
      return refuse()
    },
    async move() {
      return refuse()
    },
    async remove() {
      return refuse()
    },
    async mkdir() {
      return refuse()
    },
    async commit(changes: readonly BatchChange[]) {
      return {
        ok: false,
        path: batchPaths(changes[0] ?? { op: "mkdir", path: "" })[0] ?? "",
        message: REFUSAL,
        conflict: false,
      }
    },
  }
}
