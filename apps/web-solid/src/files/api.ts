import type { FileRef, RoomId } from "@kiko/protocol"
import { FileConflictError } from "@kiko/protocol/rpc"
import * as Cause from "effect/Cause"
import { createSignal } from "solid-js"
import { fileSrc } from "../state/room"
import { failureMessage, owner, run } from "../state/runtime"
import { apiFetch } from "../lib/api"

export const sha256Hex = async (data: BufferSource): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) => b.toString(16).padStart(2, "0")).join(
    "",
  )

export type SaveResult =
  | { kind: "saved"; file: FileRef }
  | { kind: "conflict"; theirs: FileRef | null }
  | { kind: "error"; message: string }

export async function putFile(
  roomId: string,
  path: string,
  body: string,
  type: string,
  expect: string,
): Promise<SaveResult> {
  const result = await run(owner.commands.writeText, {
    roomId: roomId as RoomId,
    path,
    type,
    text: body,
    expectSha: expect,
  })
  if (result._tag === "Success") return { kind: "saved", file: result.value }
  const error = Cause.squash(result.cause)
  if (error instanceof FileConflictError) return { kind: "conflict", theirs: error.theirs }
  return { kind: "error", message: failureMessage(result.cause, "Could not reach the server") }
}

export const PREVIEW_BYTES = 1024 * 1024
const SNIFF_BYTES = 8192

export type TextRead =
  | { kind: "text"; text: string; sha256: string; truncated: boolean; size: number }
  | { kind: "binary" }
  | { kind: "not-utf8" }

function decodeText(
  bytes: Uint8Array,
  size: number,
): { kind: "text"; text: string; truncated: boolean } | { kind: "binary" } | { kind: "not-utf8" } {
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return { kind: "binary" }
  const truncated = size > bytes.length
  try {
    return {
      kind: "text",
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: truncated }),
      truncated,
    }
  } catch {
    return { kind: "not-utf8" }
  }
}

export async function readText(roomId: string, id: string, limit?: number): Promise<TextRead> {
  const res = await apiFetch(fileSrc(roomId, id), limit ? { headers: { range: `bytes=0-${limit - 1}` } } : undefined)
  if (!res.ok) throw new Error(`The server said ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const size = Number(res.headers.get("content-range")?.split("/")[1]) || bytes.length
  const read = decodeText(bytes, size)
  if (read.kind !== "text") return read
  return { ...read, size, sha256: read.truncated ? "" : await sha256Hex(bytes) }
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|typescript|x-sh|x-yaml|yaml|toml|sql)|image\/svg)/
const TEXT_EXT =
  /\.(txt|md|mdx|json|jsonc|ya?ml|toml|ini|env|csv|tsx?|jsx?|mjs|cjs|css|scss|html?|xml|svg|py|rs|go|rb|java|kt|c|h|cpp|hpp|sh|zsh|sql|lock|log)$/i

export const isTextFile = (f: Pick<FileRef, "name" | "type">) =>
  TEXT_TYPES.test(f.type) || TEXT_EXT.test(f.name) || /(^|\/)\.[^/.]+$/.test(f.name)

const [made, setMade] = createSignal<readonly (FileRef & { roomId: string })[]>([])

export function withMade(roomId: string, indexed: readonly FileRef[]): FileRef[] {
  const have = new Set(indexed.map((f) => f.name))
  return [...indexed, ...made().filter((f) => f.roomId === roomId && !have.has(f.name))]
}

export function forgetMade(roomId: string, path: string) {
  setMade((list) => list.filter((f) => f.roomId !== roomId || (f.name !== path && !f.name.startsWith(`${path}/`))))
}

export async function createFile(roomId: string, path: string): Promise<boolean> {
  const res = await putFile(roomId, path, "", "text/plain", "none")
  if (res.kind !== "saved") return false
  setMade((m) => [...m, { ...res.file, roomId }])
  return true
}
