import { sha256Hex } from "@kiko/durable/hash"
import { KIKO_DOCS } from "../agent/kiko-docs.gen"
import type { FsEntry, FsFail } from "../room/files"
import type { BatchChange, FilesBackend } from "./room-fs"
import { batchPaths } from "./room-fs"

export const KIKO = "kiko"

const REFUSAL = `/${KIKO} is read-only. It explains how Kiko works. Write your own files under / or /home.`

const DOCS = new Map(KIKO_DOCS)
const encoder = new TextEncoder()
const sha = new Map<string, string>()

async function entry(name: string): Promise<FsEntry & { kind: "file" }> {
  const text = DOCS.get(name) ?? ""
  let digest = sha.get(name)
  if (digest === undefined) {
    digest = await sha256Hex(text)
    sha.set(name, digest)
  }
  return { kind: "file", path: name, id: `kiko:${name}`, size: encoder.encode(text).length, type: "text/markdown", sha256: digest, r2Key: `kiko:${name}`, at: 0 }
}

const root = (files: number, size: number): FsEntry => ({ kind: "directory", path: "", files, size })

async function sizes(): Promise<{ files: FsEntry[]; size: number }> {
  const files = await Promise.all([...DOCS.keys()].map((name) => entry(name)))
  return { files, size: files.reduce((sum, f) => sum + f.size, 0) }
}

const refuse = (): FsFail => ({ ok: false, code: "invalid", message: REFUSAL })

export function kikoDocsBackend(): FilesBackend {
  return {
    async stat(path) {
      if (path === "") {
        const { files, size } = await sizes()
        return root(files.length, size)
      }
      return DOCS.has(path) ? await entry(path) : null
    },
    async list(dir) {
      if (dir !== "") return DOCS.has(dir) ? [await entry(dir)] : { ok: false, code: "not_found", message: `no such file or folder: /${KIKO}/${dir}` }
      const { files } = await sizes()
      return files
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
      return { ok: false, path: batchPaths(changes[0] ?? { op: "mkdir", path: "" })[0] ?? "", message: REFUSAL, conflict: false }
    },
  }
}
