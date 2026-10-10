import { sha256Stream, toHex } from "@yuki/durable/hash"
import { attachmentError, attachmentType } from "@yuki/protocol"
import type { Env } from "../index"
import { addressRoom } from "../lib/names"
import type { RoomDO } from "../room/room-do"
import { deleteFiles, error, fileKey, isFileId, MAX_SINGLE_PUT_BYTES, refuse } from "./upload"

// Pending attachments (architecture section 18.1). The composer uploads a file the moment the human
// picks it, as t3code does, and the send names it by id. The bytes go to R2 at the key the file
// keeps once sent, built from the session's user id; the room records the id as pending, so the
// Files tab and the agents see nothing until a send claims it. The client picks the id (a UUID),
// so a retry, a cancel, and a send all name the same upload.
//
//   PUT    /api/files/<roomId>/pending/<id>?name=&size=           one request, up to MAX_SINGLE_PUT_BYTES -> 204
//   POST   /api/files/<roomId>/pending/<id>/parts                 { name, type, size } -> { uploadId }
//   PUT    /api/files/<roomId>/pending/<id>/parts/<n>?uploadId=   -> { partNumber, etag }
//   POST   /api/files/<roomId>/pending/<id>/complete?uploadId=    { parts } -> 204
//   DELETE /api/files/<roomId>/pending/<id>                       -> 204, or 404 when the id is not pending
//
// DEVIATION from t3code: no signed upload URL. The upload is same-origin and carries the session
// cookie, which already names the user, so a token would add a round trip and prove nothing more.

type Room = DurableObjectStub<RoomDO>

function declaredSize(raw: string | null | undefined): number | null {
	const n = raw === null || raw === undefined || raw === "" ? Number.NaN : Number(raw)
	return Number.isSafeInteger(n) && n >= 0 ? n : null
}

function mime(raw: string | null | undefined): string {
	const type = (raw ?? "").split(";", 1)[0]!.trim().toLowerCase()
	return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(type) ? type : "application/octet-stream"
}

function cleanName(raw: unknown): string | null {
	if (typeof raw !== "string") return null
	const name = raw.trim()
	return name && name.length <= 255 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null
}

/** The checks every new upload passes: a name, a size, the per-type limit, the user's storage. */
async function admit(env: Env, userId: string, name: string | null, type: string, size: number | null): Promise<Response | null> {
	if (!name) return error(400, "bad name")
	if (size === null) return error(400, "bad size")
	const why = attachmentError({ name, type, size })
	if (why) return error(size > 0 ? 413 : 400, why)
	return refuse(env.FILES, userId, size)
}

async function room(env: Env, userId: string, roomId: string): Promise<Room | Response> {
	return (await addressRoom(env, userId, roomId)) ?? error(410, "account deleted")
}

/** Reads the body into R2 while hashing it. The error names how many bytes came when they were not `size`. */
async function store(request: Request, env: Env, key: string, type: string, size: number): Promise<{ sha256: string } | { error: string }> {
	let seen = 0
	const counted = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			seen += chunk.byteLength
			controller.enqueue(chunk)
		},
	})
	const [toHash, toStore] = (request.body ?? new Blob([]).stream()).pipeThrough(counted).tee()
	const digest = new crypto.DigestStream("SHA-256")
	try {
		await Promise.all([
			env.FILES.put(key, toStore.pipeThrough(new FixedLengthStream(size)), { httpMetadata: { contentType: type } }),
			toHash.pipeTo(digest),
		])
	} catch {
		await env.FILES.delete(key).catch(() => {})
		return { error: `Body was ${seen} bytes, expected ${size}.` }
	}
	if (seen !== size) {
		await env.FILES.delete(key)
		return { error: `Body was ${seen} bytes, expected ${size}.` }
	}
	return { sha256: toHex(await digest.digest) }
}

/** Marks the upload ready, or deletes the object when the row went or the size is wrong. */
async function finish(env: Env, stub: Room, id: string, key: string, sha256: string, size: number): Promise<Response> {
	const out = await stub.pendingReady(id, sha256, size)
	if (out === "ok") return new Response(null, { status: 204 })
	await env.FILES.delete(key)
	return out === "gone" ? error(410, "the upload was removed") : error(400, "Content-Length must match the upload size.")
}

async function putOne(request: Request, env: Env, userId: string, roomId: string, id: string, url: URL): Promise<Response> {
	const name = cleanName(url.searchParams.get("name"))
	const size = declaredSize(url.searchParams.get("size"))
	const type = attachmentType({ name: name ?? "", type: mime(request.headers.get("content-type")) })
	const refused = await admit(env, userId, name, type, size)
	if (refused) return refused
	if (declaredSize(request.headers.get("content-length")) !== size) return error(400, "Content-Length must match the upload size.")
	if (size! > MAX_SINGLE_PUT_BYTES) return error(413, "too large for one request, use a multipart upload")
	const stub = await room(env, userId, roomId)
	if (stub instanceof Response) return stub
	const key = fileKey(userId, roomId, id)
	const taken = await stub.pendingOpen({ id, name: name!, type, size: size!, r2Key: key })
	if (taken) return error(409, taken)
	const stored = await store(request, env, key, type, size!)
	if ("error" in stored) {
		await stub.pendingRemove(id)
		return error(400, stored.error)
	}
	return finish(env, stub, id, key, stored.sha256, size!)
}

async function json(request: Request): Promise<Record<string, unknown> | null> {
	// A JSON content type makes a cross-site form post impossible without a CORS preflight.
	if (!request.headers.get("content-type")?.includes("application/json")) return null
	const body = await request.json().catch(() => null)
	return body && typeof body === "object" ? (body as Record<string, unknown>) : null
}

async function createParts(request: Request, env: Env, userId: string, roomId: string, id: string): Promise<Response> {
	const body = await json(request)
	if (!body) return error(400, "expected a json body")
	const name = cleanName(body.name)
	const size = typeof body.size === "number" ? declaredSize(String(body.size)) : null
	const type = attachmentType({ name: name ?? "", type: mime(typeof body.type === "string" ? body.type : "") })
	const refused = await admit(env, userId, name, type, size)
	if (refused) return refused
	const stub = await room(env, userId, roomId)
	if (stub instanceof Response) return stub
	const key = fileKey(userId, roomId, id)
	const upload = await env.FILES.createMultipartUpload(key, { httpMetadata: { contentType: type } })
	const taken = await stub.pendingOpen({ id, name: name!, type, size: size!, r2Key: key, uploadId: upload.uploadId })
	if (taken) {
		await upload.abort().catch(() => {})
		return error(409, taken)
	}
	return Response.json({ uploadId: upload.uploadId })
}

async function part(request: Request, env: Env, key: string, uploadId: string, n: number): Promise<Response> {
	const length = declaredSize(request.headers.get("content-length"))
	if (length === null) return error(411, "content-length required")
	if (length > MAX_SINGLE_PUT_BYTES) return error(413, "part too large")
	try {
		const body = (request.body ?? new Blob([]).stream()).pipeThrough(new FixedLengthStream(length))
		const uploaded = await env.FILES.resumeMultipartUpload(key, uploadId).uploadPart(n, body)
		return Response.json({ partNumber: uploaded.partNumber, etag: uploaded.etag })
	} catch {
		return error(404, "no such upload")
	}
}

async function complete(request: Request, env: Env, userId: string, roomId: string, id: string, uploadId: string): Promise<Response> {
	const body = await json(request)
	const parts = body?.parts
	if (!Array.isArray(parts) || !parts.every((p) => p && Number.isSafeInteger(p.partNumber) && typeof p.etag === "string")) {
		return error(400, "bad parts")
	}
	const stub = await room(env, userId, roomId)
	if (stub instanceof Response) return stub
	const key = fileKey(userId, roomId, id)
	await env.FILES.resumeMultipartUpload(key, uploadId)
		.complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })))
		// A retried completion finds the object already there.
		.catch(() => null)
	const object = await env.FILES.get(key)
	if (!object) return error(404, "no such upload")
	// R2 cannot hash across parts, so the Worker reads the object once. The digest is native code.
	return finish(env, stub, id, key, await sha256Stream(object.body), object.size)
}

async function remove(env: Env, userId: string, roomId: string, id: string): Promise<Response> {
	const stub = await room(env, userId, roomId)
	if (stub instanceof Response) return stub
	// Only a pending id: a sent file's id finds no row, so its bytes are never touched here.
	const row = await stub.pendingRemove(id)
	if (!row) return error(404, "not pending")
	if (row.uploadId) await env.FILES.resumeMultipartUpload(row.r2Key, row.uploadId).abort().catch(() => {})
	await deleteFiles(env.FILES, row.r2Key)
	return new Response(null, { status: 204 })
}

/** Answers `/api/files/<roomId>/pending/...`. `rest` is the path after `pending`. */
export function pendingRoute(request: Request, env: Env, userId: string, roomId: string, rest: readonly string[]): Promise<Response> | Response {
	const url = new URL(request.url)
	const [id = "", sub, n] = rest
	// The drive has no messages to attach to.
	if (roomId === "home" || !isFileId(id)) return error(404, "not found")
	const uploadId = url.searchParams.get("uploadId") ?? ""
	if (rest.length === 1 && request.method === "PUT") return putOne(request, env, userId, roomId, id, url)
	if (rest.length === 1 && request.method === "DELETE") return remove(env, userId, roomId, id)
	if (rest.length === 2 && sub === "parts" && request.method === "POST") return createParts(request, env, userId, roomId, id)
	if (rest.length === 3 && sub === "parts" && request.method === "PUT" && uploadId) {
		const partNumber = Number(n)
		if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) return error(400, "bad part number")
		return part(request, env, fileKey(userId, roomId, id), uploadId, partNumber)
	}
	if (rest.length === 2 && sub === "complete" && request.method === "POST" && uploadId) return complete(request, env, userId, roomId, id, uploadId)
	return error(404, "not found")
}
