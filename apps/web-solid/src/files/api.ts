import type { FileRef } from "@kiko/protocol"
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
			headers: { "content-type": type, "x-kiko-if-sha256": expect },
			body,
		})
		if (res.status === 409) return { kind: "conflict", theirs: ((await res.json()) as { file: FileRef | null }).file }
		if (!res.ok) return { kind: "error", message: `The server said ${res.status}` }
		return { kind: "saved", file: ((await res.json()) as { file: FileRef }).file }
	} catch {
		return { kind: "error", message: "Could not reach the server" }
	}
}

/** The bytes of one stored version, as text, with their hash. */
export async function readFile(roomId: string, id: string): Promise<{ text: string; sha256: string }> {
	const res = await fetch(urls.file(roomId, id))
	if (!res.ok) throw new Error(`The server said ${res.status}`)
	const bytes = await res.arrayBuffer()
	return { text: new TextDecoder().decode(bytes), sha256: await sha256Hex(bytes) }
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|typescript|x-sh|x-yaml|yaml|toml|sql)|image\/svg)/
const TEXT_EXT = /\.(txt|md|mdx|json|jsonc|ya?ml|toml|ini|env|csv|tsx?|jsx?|mjs|cjs|css|scss|html?|xml|svg|py|rs|go|rb|java|kt|c|h|cpp|hpp|sh|zsh|sql|lock)$/i
/** Past this the editor would stall, so the file is offered as a download. */
export const MAX_EDIT_BYTES = 2 * 1024 * 1024

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
