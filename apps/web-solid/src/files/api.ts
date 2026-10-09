import type { FileRef } from "@yuki/protocol"
import { createSignal } from "solid-js"
import { urls } from "../lib/store"

// The file viewer's HTTP calls. The server's edit rule (architecture 18.1): a PUT that
// names the SHA-256 it started from is refused with 409 when the path holds other bytes.

export const sha256Hex = async (data: BufferSource): Promise<string> =>
	Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), (b) => b.toString(16).padStart(2, "0")).join("")

export type SaveResult =
	| { kind: "saved"; file: FileRef }
	/** Another writer got there first. `theirs` is what the path holds now, or null when it was removed. */
	| { kind: "conflict"; theirs: FileRef | null }
	| { kind: "error"; message: string }

/**
 * Writes `body` at `path`. `expect` is the SHA-256 of the bytes this edit started from, or
 * "none" for a new file.
 */
export async function putFile(roomId: string, path: string, body: string, type: string, expect: string): Promise<SaveResult> {
	try {
		const res = await fetch(`/api/files/${roomId}?path=${encodeURIComponent(path)}`, {
			method: "PUT",
			headers: { "content-type": type, "x-yuki-if-sha256": expect },
			body,
		})
		if (res.status === 409) return { kind: "conflict", theirs: ((await res.json()) as { file: FileRef | null }).file }
		if (!res.ok) return { kind: "error", message: `The server said ${res.status}` }
		return { kind: "saved", file: ((await res.json()) as { file: FileRef }).file }
	} catch {
		return { kind: "error", message: "Could not reach the server" }
	}
}

/** A text preview reads at most this much, as t3code's does. A longer file shows its head, read only. */
export const PREVIEW_BYTES = 1024 * 1024
/** A zero byte this early means the file is binary. */
const SNIFF_BYTES = 8192

export type TextRead =
	/** `truncated` when `size` is past the bytes read. `sha256` is of the whole file, or empty when truncated. */
	| { kind: "text"; text: string; sha256: string; truncated: boolean; size: number }
	| { kind: "binary" }
	| { kind: "not-utf8" }

/** What some bytes of a `size` byte file are as text. A cut may split a character, so a truncated read decodes as a stream. */
export function decodeText(bytes: Uint8Array, size: number): { kind: "text"; text: string; truncated: boolean } | { kind: "binary" } | { kind: "not-utf8" } {
	if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return { kind: "binary" }
	const truncated = size > bytes.length
	try {
		return { kind: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: truncated }), truncated }
	} catch {
		return { kind: "not-utf8" }
	}
}

/**
 * One stored version as text. `limit` reads the head with a Range request; leave it out to read
 * the whole file. The server answers a range with its total size in `content-range`.
 */
export async function readText(roomId: string, id: string, limit?: number): Promise<TextRead> {
	const res = await fetch(urls.file(roomId, id), limit ? { headers: { range: `bytes=0-${limit - 1}` } } : undefined)
	if (!res.ok) throw new Error(`The server said ${res.status}`)
	const bytes = new Uint8Array(await res.arrayBuffer())
	const size = Number(res.headers.get("content-range")?.split("/")[1]) || bytes.length
	const read = decodeText(bytes, size)
	if (read.kind !== "text") return read
	return { ...read, size, sha256: read.truncated ? "" : await sha256Hex(bytes) }
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|typescript|x-sh|x-yaml|yaml|toml|sql)|image\/svg)/
const TEXT_EXT = /\.(txt|md|mdx|json|jsonc|ya?ml|toml|ini|env|csv|tsx?|jsx?|mjs|cjs|css|scss|html?|xml|svg|py|rs|go|rb|java|kt|c|h|cpp|hpp|sh|zsh|sql|lock|log)$/i

export const isTextFile = (f: Pick<FileRef, "name" | "type">) =>
	TEXT_TYPES.test(f.type) || TEXT_EXT.test(f.name) || /(^|\/)\.[^/.]+$/.test(f.name)

// A file the user just made. The index event can lag the PUT answer, so the new file shows at once
// and drops out when the index has the path.
const [made, setMade] = createSignal<readonly (FileRef & { roomId: string })[]>([])

export function withMade(roomId: string, indexed: readonly FileRef[]): FileRef[] {
	const have = new Set(indexed.map((f) => f.name))
	return [...indexed, ...made().filter((f) => f.roomId === roomId && !have.has(f.name))]
}

/** Makes an empty file. True when it was made, false when the path already holds one or the call failed. */
export async function createFile(roomId: string, path: string): Promise<boolean> {
	const res = await putFile(roomId, path, "", "text/plain", "none")
	if (res.kind !== "saved") return false
	setMade((m) => [...m, { ...res.file, roomId }])
	return true
}
