import { FILE_TOO_LARGE, STORAGE_FULL } from "./file-limits"
import { fileStore, type FileBucket, maxFileBytes } from "./store"
import { sha256Stream } from "@kiko/durable/hash"
import { type Actor, isRoomId } from "@kiko/protocol"
import type { Env } from "../index"
import { ownerStub } from "../lib/names"
import type { SessionLookup } from "../router"
import type { NewFile } from "../room/files"
import { pendingRoute } from "./pending"

export const MAX_FILE_BYTES = 512 * 1024 * 1024
export const MAX_SINGLE_PUT_BYTES = 32 * 1024 * 1024

const MAX_PATH = 512
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FILES_PATH = /^\/api\/files\/([^/]+)(?:\/(.*))?$/
const HUMAN: Actor = { kind: "human" }
const R2_DELETE_LIMIT = 1000

const expectOf = (value: unknown): string | null => (typeof value === "string" && /^(none|[0-9a-f]{64})$/.test(value) ? value : null)
const EXPECT_ERROR = "say what you saw at the path: the sha256 of its bytes, or none for a new file"

function userPrefix(userId: string): string {
	return `u/${userId}/`
}

export const HOME = "home"
export const isSpace = (id: string) => id === HOME || isRoomId(id)
export const isFileId = (id: string) => FILE_ID.test(id)

export function fileKey(userId: string, roomId: string, fileId: string): string {
	return `${userPrefix(userId)}r/${roomId}/${fileId}`
}

export async function deleteFiles(bucket: FileBucket, keys: string | readonly string[]): Promise<void> {
	const all = typeof keys === "string" ? [keys] : keys
	for (let i = 0; i < all.length; i += R2_DELETE_LIMIT) await bucket.delete(all.slice(i, i + R2_DELETE_LIMIT))
}

export function storageRefusal(e: unknown): string | null {
	const message = e instanceof Error ? e.message : ""
	return message === STORAGE_FULL || message === FILE_TOO_LARGE ? message : null
}

const tooLarge = (env: Pick<Env, "FILES">) => (env.FILES ? "That file is over 512 MB, the most Kiko takes." : FILE_TOO_LARGE)

export function error(status: number, message: string): Response {
	return Response.json({ error: message }, { status })
}

export function filesPath(pathname: string): { roomId: string; rest: string[] } | null {
	const m = FILES_PATH.exec(pathname)
	if (!m) return null
	const roomId = m[1]
	if (roomId === undefined) return null
	return { roomId, rest: m[2] ? m[2].split("/") : [] }
}

export function isControl(c: string): boolean {
	const n = c.charCodeAt(0)
	return n <= 0x1f || n === 0x7f
}

export function cleanPath(raw: unknown): string | null {
	if (typeof raw !== "string" || !raw || raw.length > MAX_PATH) return null
	if ([...raw].some((c) => c === "\\" || isControl(c))) return null
	const parts = raw.split("/")
	if (parts.some((p) => p === "" || p === "." || p === "..")) return null
	return raw
}

export function declaredSize(raw: string | null | undefined): number | null {
	const n = raw === null || raw === undefined || raw === "" ? Number.NaN : Number(raw)
	return Number.isSafeInteger(n) && n >= 0 ? n : null
}

export function mime(raw: unknown): string {
	const type = typeof raw === "string" ? (raw.split(";", 1)[0] ?? "").trim().toLowerCase() : ""
	return /^[a-z0-9][\w.+-]*\/[\w.+-]+$/.test(type) ? type : "application/octet-stream"
}

export async function json(request: Request): Promise<Record<string, unknown> | null> {
	if (!request.headers.get("content-type")?.includes("application/json")) return null
	try {
		const body = await request.json()
		return body && typeof body === "object" ? (body as Record<string, unknown>) : null
	} catch {
		return null
	}
}

export function refuse(size: number, env: Env): Response | null {
	return size > maxFileBytes(env, MAX_FILE_BYTES) ? error(413, tooLarge(env)) : null
}

async function index(env: Env, userId: string, roomId: string, input: NewFile): Promise<Response> {
	const owner = ownerStub(env.OWNER, userId)
	const { file, drop, conflict, refused } = roomId === HOME ? await owner.userCall("homePut", [input]) : await owner.roomCall(roomId, "putFile", [input])
	if (drop) await deleteFiles(fileStore(env), drop)
	if (refused) return Response.json({ error: refused.message }, { status: 409 })
	if (conflict) return Response.json({ error: "conflict", file }, { status: 409 })
	return Response.json({ file })
}

async function putOne(request: Request, env: Env, userId: string, roomId: string, url: URL): Promise<Response> {
	const path = cleanPath(url.searchParams.get("path"))
	if (!path) return error(400, "bad path")
	const length = declaredSize(request.headers.get("content-length"))
	if (length === null) return error(411, "content-length required")
	if (length > MAX_SINGLE_PUT_BYTES) return error(413, "too large for one request, use a multipart upload")
	const expectSha256 = expectOf(request.headers.get("x-kiko-if-sha256"))
	if (!expectSha256) return error(400, EXPECT_ERROR)
	const refused = refuse(length, env)
	if (refused) return refused
	const id = crypto.randomUUID()
	const key = fileKey(userId, roomId, id)
	const type = mime(request.headers.get("content-type"))
	const [toHash, toStore] = (request.body ?? new Blob([]).stream()).tee()
	const [, sha256] = await Promise.all([
		fileStore(env).put(key, toStore.pipeThrough(new FixedLengthStream(length)), {
			httpMetadata: { contentType: type },
			customMetadata: { path },
		}),
		sha256Stream(toHash),
	])
	return index(env, userId, roomId, { id, path, r2Key: key, size: length, type, sha256, author: HUMAN, expectSha256 })
}

async function create(request: Request, env: Env, userId: string, roomId: string): Promise<Response> {
	const body = await json(request)
	if (!body) return error(400, "expected a json body")
	const path = cleanPath(body.path)
	if (!path) return error(400, "bad path")
	const size = body.size
	if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return error(400, "bad size")
	const expect = expectOf(body.expect)
	if (!expect) return error(400, EXPECT_ERROR)
	const refused = refuse(size, env)
	if (refused) return refused
	const fileId = crypto.randomUUID()
	const upload = await fileStore(env).createMultipartUpload(fileKey(userId, roomId, fileId), {
		httpMetadata: { contentType: mime(body.type) },
		customMetadata: { path, expect },
	})
	return Response.json({ fileId, uploadId: upload.uploadId })
}

export async function part(request: Request, env: Env, key: string, uploadId: string, n: number): Promise<Response> {
	const length = declaredSize(request.headers.get("content-length"))
	if (length === null) return error(411, "content-length required")
	if (length > MAX_SINGLE_PUT_BYTES) return error(413, "part too large")
	try {
		const body = (request.body ?? new Blob([]).stream()).pipeThrough(new FixedLengthStream(length))
		const uploaded = await fileStore(env).resumeMultipartUpload(key, uploadId).uploadPart(n, body)
		return Response.json({ partNumber: uploaded.partNumber, etag: uploaded.etag })
	} catch (e) {
		const why = storageRefusal(e)
		return why ? error(413, why) : error(404, "no such upload")
	}
}

async function complete(request: Request, env: Env, userId: string, roomId: string, fileId: string, uploadId: string): Promise<Response> {
	const body = await json(request)
	const parts = body?.parts
	if (!Array.isArray(parts) || !parts.every((p) => p && Number.isSafeInteger(p.partNumber) && typeof p.etag === "string")) {
		return error(400, "bad parts")
	}
	const key = fileKey(userId, roomId, fileId)
	let fresh = true
	try {
		await fileStore(env).resumeMultipartUpload(key, uploadId).complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })))
	} catch {
		fresh = false
	}
	const object = await fileStore(env).get(key)
	if (!object) return error(404, "no such upload")
	const path = cleanPath(object.customMetadata?.path)
	if (!path) {
		await object.body.cancel()
		return error(400, "bad path")
	}
	if (fresh && object.size > maxFileBytes(env, MAX_FILE_BYTES)) {
		await object.body.cancel()
		await fileStore(env).delete(key)
		return error(413, tooLarge(env))
	}
	const sha256 = await sha256Stream(object.body)
	const type = mime(object.httpMetadata?.contentType)
	const expectSha256 = expectOf(object.customMetadata?.expect)
	if (!expectSha256) return error(400, EXPECT_ERROR)
	return index(env, userId, roomId, { id: fileId, path, r2Key: key, size: object.size, type, sha256, author: HUMAN, expectSha256 })
}

export async function uploadRoute(request: Request, env: Env, lookup: SessionLookup): Promise<Response | null> {
	try {
		return await routeUpload(request, env, lookup)
	} catch (e) {
		const why = storageRefusal(e)
		if (why) return error(413, why)
		throw e
	}
}

async function routeUpload(request: Request, env: Env, lookup: SessionLookup): Promise<Response | null> {
	const url = new URL(request.url)
	const route = filesPath(url.pathname)
	if (!route || request.method === "GET" || request.method === "HEAD") return null
	const user = await lookup(request, env)
	if (!user) return error(401, "unauthorized")
	const { roomId, rest } = route
	if (!isSpace(roomId)) return error(404, "not found")
	const uploadId = url.searchParams.get("uploadId") ?? ""
	const [head, fileId = "", n] = rest

	if (!rest.length && request.method === "PUT") return putOne(request, env, user.id, roomId, url)
	if (head === "pending") return pendingRoute(request, env, user.id, roomId, rest.slice(1))
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
		await fileStore(env).resumeMultipartUpload(key, uploadId)
			.abort()
			.catch(() => {})
		return new Response(null, { status: 204 })
	}
	return error(404, "not found")
}
