import { type Actor, isRoomId } from "@kiko/protocol"
import type { Env } from "../index"
import { roomStub } from "../lib/names"
import type { NewFile } from "../room/files"
import type { SessionLookup } from "../router"

// Architecture section 18.1. Bytes go from the client through the Worker to R2 as a
// stream. The Worker computes SHA-256, then asks the room to index the object. The
// R2 key is built from the session's user id, so no request can reach another user's bytes.
//
//   PUT    /api/files/<roomId>?path=<path>                     one request, up to MAX_SINGLE_PUT_BYTES
//   POST   /api/files/<roomId>/uploads                         { path, type, size } -> { fileId, uploadId }
//   PUT    /api/files/<roomId>/uploads/<fileId>/<part>?uploadId=  -> { partNumber, etag }
//   POST   /api/files/<roomId>/uploads/<fileId>?uploadId=      { parts } -> { file }
//   DELETE /api/files/<roomId>/uploads/<fileId>?uploadId=      aborts
//
// R2 multipart rules apply to the parts: every part but the last is at least 5 MiB and
// all of them are the same size. R2 refuses the completion otherwise.

/** ASSUMPTION: the per-file cap. */
export const MAX_FILE_BYTES = 512 * 1024 * 1024
/**
 * ASSUMPTION: the largest single request body, for a one-request upload or one part.
 * UNVERIFIED: the Workers request body limit per plan. This stays far under 100 MB.
 */
export const MAX_SINGLE_PUT_BYTES = 32 * 1024 * 1024
/**
 * ASSUMPTION: every user's storage limit. The limits record does not exist yet. P9-01
 * creates it in `user/limits.ts` and replaces this constant with the user's record.
 */
export const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024

const MAX_PATH = 512
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FILES_PATH = /^\/api\/files\/([^/]+)(?:\/(.*))?$/
const HUMAN: Actor = { kind: "human" }

export const userPrefix = (userId: string) => `u/${userId}/`

/** The R2 key. The user id comes from the session only. */
export function fileKey(userId: string, roomId: string, fileId: string): string {
	return `${userPrefix(userId)}r/${roomId}/${fileId}`
}

export const isFileId = (id: string) => FILE_ID.test(id)

export function error(status: number, message: string): Response {
	return Response.json({ error: message }, { status })
}

/** Splits `/api/files/<roomId>/<rest>`. Null when the path is not a files route. */
export function filesPath(pathname: string): { roomId: string; rest: string[] } | null {
	const m = FILES_PATH.exec(pathname)
	if (!m) return null
	return { roomId: m[1]!, rest: m[2] ? m[2].split("/") : [] }
}

/** A path in the room's file space: relative, no empty, `.`, or `..` segments, no control characters. */
export function cleanPath(raw: unknown): string | null {
	if (typeof raw !== "string" || !raw || raw.length > MAX_PATH) return null
	if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null
	const parts = raw.split("/")
	if (parts.some((p) => p === "" || p === "." || p === "..")) return null
	return raw
}

function mime(raw: unknown): string {
	const type = typeof raw === "string" ? raw.split(";", 1)[0]!.trim().toLowerCase() : ""
	return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(type) ? type : "application/octet-stream"
}

function hex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("")
}

function contentLength(request: Request): number | null {
	const raw = request.headers.get("content-length")
	const n = raw === null ? Number.NaN : Number(raw)
	return Number.isSafeInteger(n) && n >= 0 ? n : null
}

/** The request body as a stream R2 accepts, which needs a known length. */
function sized(request: Request, length: number): ReadableStream {
	const body = request.body ?? new Blob([]).stream()
	return body.pipeThrough(new FixedLengthStream(length))
}

/** Bytes the user stores in R2 today, across every room. */
async function usedBytes(bucket: R2Bucket, userId: string): Promise<number> {
	let total = 0
	let cursor: string | undefined
	do {
		const page = await bucket.list({ prefix: userPrefix(userId), cursor })
		for (const o of page.objects) total += o.size
		cursor = page.truncated ? page.cursor : undefined
	} while (cursor)
	return total
}

/** Null when `size` more bytes fit, or the refusal. */
async function refuse(bucket: R2Bucket, userId: string, size: number): Promise<Response | null> {
	if (size > MAX_FILE_BYTES) return error(413, "file too large")
	if ((await usedBytes(bucket, userId)) + size > STORAGE_LIMIT_BYTES) return error(413, "storage limit reached")
	return null
}

async function sha256Of(stream: ReadableStream): Promise<string> {
	const digest = new crypto.DigestStream("SHA-256")
	await stream.pipeTo(digest)
	return hex(await digest.digest)
}

/** Indexes a stored object in the room and deletes whatever the room no longer points to. */
async function index(env: Env, userId: string, roomId: string, input: NewFile): Promise<Response> {
	const { file, drop } = await roomStub(env.ROOM, userId, roomId).putFile(input)
	if (drop) await env.FILES.delete(drop)
	return Response.json({ file })
}

async function json(request: Request): Promise<Record<string, unknown> | null> {
	// A JSON content type makes a cross-site form post impossible without a CORS preflight.
	if (!request.headers.get("content-type")?.includes("application/json")) return null
	try {
		const body = await request.json()
		return body && typeof body === "object" ? (body as Record<string, unknown>) : null
	} catch {
		return null
	}
}

async function putOne(request: Request, env: Env, userId: string, roomId: string, url: URL): Promise<Response> {
	const path = cleanPath(url.searchParams.get("path"))
	if (!path) return error(400, "bad path")
	const length = contentLength(request)
	if (length === null) return error(411, "content-length required")
	if (length > MAX_SINGLE_PUT_BYTES) return error(413, "too large for one request, use a multipart upload")
	const refused = await refuse(env.FILES, userId, length)
	if (refused) return refused
	const id = crypto.randomUUID()
	const key = fileKey(userId, roomId, id)
	const type = mime(request.headers.get("content-type"))
	const [toHash, toStore] = (request.body ?? new Blob([]).stream()).tee()
	const [, sha256] = await Promise.all([
		env.FILES.put(key, toStore.pipeThrough(new FixedLengthStream(length)), {
			httpMetadata: { contentType: type },
			customMetadata: { path },
		}),
		sha256Of(toHash),
	])
	return index(env, userId, roomId, { id, path, r2Key: key, size: length, type, sha256, author: HUMAN })
}

async function create(request: Request, env: Env, userId: string, roomId: string): Promise<Response> {
	const body = await json(request)
	if (!body) return error(400, "expected a json body")
	const path = cleanPath(body.path)
	if (!path) return error(400, "bad path")
	const size = body.size
	if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return error(400, "bad size")
	const refused = await refuse(env.FILES, userId, size)
	if (refused) return refused
	const fileId = crypto.randomUUID()
	const upload = await env.FILES.createMultipartUpload(fileKey(userId, roomId, fileId), {
		httpMetadata: { contentType: mime(body.type) },
		customMetadata: { path },
	})
	return Response.json({ fileId, uploadId: upload.uploadId })
}

async function part(request: Request, env: Env, key: string, uploadId: string, n: number): Promise<Response> {
	const length = contentLength(request)
	if (length === null) return error(411, "content-length required")
	if (length > MAX_SINGLE_PUT_BYTES) return error(413, "part too large")
	try {
		const uploaded = await env.FILES.resumeMultipartUpload(key, uploadId).uploadPart(n, sized(request, length))
		return Response.json({ partNumber: uploaded.partNumber, etag: uploaded.etag })
	} catch {
		return error(404, "no such upload")
	}
}

async function complete(
	request: Request,
	env: Env,
	userId: string,
	roomId: string,
	fileId: string,
	uploadId: string,
): Promise<Response> {
	const body = await json(request)
	const parts = body?.parts
	if (
		!Array.isArray(parts) ||
		!parts.every((p) => p && Number.isSafeInteger(p.partNumber) && typeof p.etag === "string")
	) {
		return error(400, "bad parts")
	}
	const key = fileKey(userId, roomId, fileId)
	let fresh = true
	try {
		await env.FILES.resumeMultipartUpload(key, uploadId).complete(
			parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
		)
	} catch {
		// A retried completion finds the object already there.
		fresh = false
	}
	const object = await env.FILES.get(key)
	if (!object) return error(404, "no such upload")
	const path = cleanPath(object.customMetadata?.path)
	if (!path) {
		await object.body.cancel()
		return error(400, "bad path")
	}
	if (fresh && (object.size > MAX_FILE_BYTES || (await usedBytes(env.FILES, userId)) > STORAGE_LIMIT_BYTES)) {
		await object.body.cancel()
		await env.FILES.delete(key)
		return error(413, object.size > MAX_FILE_BYTES ? "file too large" : "storage limit reached")
	}
	// R2 cannot hash across parts for us, so the Worker reads the object once.
	const sha256 = await sha256Of(object.body)
	const type = mime(object.httpMetadata?.contentType)
	return index(env, userId, roomId, { id: fileId, path, r2Key: key, size: object.size, type, sha256, author: HUMAN })
}

/** Answers the upload routes. Null for any other request. */
export async function uploadRoute(
	request: Request,
	env: Env,
	lookup: SessionLookup,
): Promise<Response | null> {
	const url = new URL(request.url)
	const route = filesPath(url.pathname)
	if (!route || request.method === "GET" || request.method === "HEAD") return null
	const user = await lookup(request, env)
	if (!user) return error(401, "unauthorized")
	const { roomId, rest } = route
	if (!isRoomId(roomId)) return error(404, "not found")
	const uploadId = url.searchParams.get("uploadId") ?? ""
	const [head, fileId = "", n] = rest

	if (!rest.length && request.method === "PUT") return putOne(request, env, user.id, roomId, url)
	if (head !== "uploads") return error(404, "not found")
	if (rest.length === 1 && request.method === "POST") return create(request, env, user.id, roomId)
	if (!isFileId(fileId) || !uploadId) return error(404, "not found")
	const key = fileKey(user.id, roomId, fileId)
	if (rest.length === 3 && request.method === "PUT") {
		const partNumber = Number(n)
		if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) return error(400, "bad part number")
		return part(request, env, key, uploadId, partNumber)
	}
	if (rest.length === 2 && request.method === "POST") return complete(request, env, user.id, roomId, fileId, uploadId)
	if (rest.length === 2 && request.method === "DELETE") {
		await env.FILES.resumeMultipartUpload(key, uploadId)
			.abort()
			.catch(() => {})
		return new Response(null, { status: 204 })
	}
	return error(404, "not found")
}
