import { fileStore } from "./store"
import { sha256Stream, toHex } from "@kiko/durable/hash"
import { attachmentError, attachmentType } from "@kiko/protocol"
import type { Env } from "../index"
import { ownerStub } from "../lib/names"
import { declaredSize, deleteFiles, error, fileKey, HOME, isControl, isFileId, json, MAX_SINGLE_PUT_BYTES, mime, part, refuse, storageRefusal } from "./upload"

type Room = { owner: ReturnType<typeof ownerStub>; roomId: string }

function cleanName(raw: unknown): string | null {
	if (typeof raw !== "string") return null
	const name = raw.trim()
	return name && name.length <= 255 && ![...name].some(isControl) ? name : null
}

function admit(env: Env, name: string, type: string, size: number): Response | null {
	const why = attachmentError({ name, type, size })
	if (why) return error(size > 0 ? 413 : 400, why)
	return refuse(size, env)
}

async function store(request: Request, env: Env, key: string, type: string, size: number): Promise<{ sha256: string } | { error: string; status: number }> {
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
			fileStore(env).put(key, toStore.pipeThrough(new FixedLengthStream(size)), { httpMetadata: { contentType: type } }),
			toHash.pipeTo(digest),
		])
	} catch (e) {
		await fileStore(env).delete(key).catch(() => {})
		const why = storageRefusal(e)
		if (why) return { error: why, status: 413 }
		return { error: `Body was ${seen} bytes, expected ${size}.`, status: 400 }
	}
	if (seen !== size) {
		await fileStore(env).delete(key)
		return { error: `Body was ${seen} bytes, expected ${size}.`, status: 400 }
	}
	return { sha256: toHex(await digest.digest) }
}

async function finish(env: Env, stub: Room, id: string, key: string, sha256: string, size: number): Promise<Response> {
	const out = await stub.owner.roomCall(stub.roomId, "pendingReady", [id, sha256, size])
	if (out === "ok") return new Response(null, { status: 204 })
	await fileStore(env).delete(key)
	return out === "gone" ? error(410, "the upload was removed") : error(400, "Content-Length must match the upload size.")
}

async function putOne(request: Request, env: Env, userId: string, roomId: string, id: string, url: URL): Promise<Response> {
	const name = cleanName(url.searchParams.get("name"))
	const size = declaredSize(url.searchParams.get("size"))
	if (!name) return error(400, "bad name")
	if (size === null) return error(400, "bad size")
	const type = attachmentType({ name, type: mime(request.headers.get("content-type")) })
	const refused = admit(env, name, type, size)
	if (refused) return refused
	if (declaredSize(request.headers.get("content-length")) !== size) return error(400, "Content-Length must match the upload size.")
	if (size > MAX_SINGLE_PUT_BYTES) return error(413, "too large for one request, use a multipart upload")
	const stub: Room = { owner: ownerStub(env.OWNER, userId), roomId }
	const key = fileKey(userId, roomId, id)
	const taken = await stub.owner.roomCall(stub.roomId, "pendingOpen", [{ id, name, type, size, r2Key: key }])
	if (taken) return error(409, taken)
	const stored = await store(request, env, key, type, size)
	if ("error" in stored) {
		await stub.owner.roomCall(stub.roomId, "pendingRemove", [id])
		return error(stored.status, stored.error)
	}
	return finish(env, stub, id, key, stored.sha256, size)
}

async function createParts(request: Request, env: Env, userId: string, roomId: string, id: string): Promise<Response> {
	const body = await json(request)
	if (!body) return error(400, "expected a json body")
	const name = cleanName(body.name)
	const size = typeof body.size === "number" ? declaredSize(String(body.size)) : null
	if (!name) return error(400, "bad name")
	if (size === null) return error(400, "bad size")
	const type = attachmentType({ name, type: mime(typeof body.type === "string" ? body.type : "") })
	const refused = admit(env, name, type, size)
	if (refused) return refused
	const stub: Room = { owner: ownerStub(env.OWNER, userId), roomId }
	const key = fileKey(userId, roomId, id)
	const upload = await fileStore(env).createMultipartUpload(key, { httpMetadata: { contentType: type } })
	const taken = await stub.owner.roomCall(stub.roomId, "pendingOpen", [{ id, name, type, size, r2Key: key, uploadId: upload.uploadId }])
	if (taken) {
		await upload.abort().catch(() => {})
		return error(409, taken)
	}
	return Response.json({ uploadId: upload.uploadId })
}

async function complete(request: Request, env: Env, userId: string, roomId: string, id: string, uploadId: string): Promise<Response> {
	const body = await json(request)
	const parts = body?.parts
	if (!Array.isArray(parts) || !parts.every((p) => p && Number.isSafeInteger(p.partNumber) && typeof p.etag === "string")) {
		return error(400, "bad parts")
	}
	const stub: Room = { owner: ownerStub(env.OWNER, userId), roomId }
	const key = fileKey(userId, roomId, id)
	await fileStore(env).resumeMultipartUpload(key, uploadId)
		.complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })))
		.catch(() => null)
	const object = await fileStore(env).get(key)
	if (!object) return error(404, "no such upload")
	return finish(env, stub, id, key, await sha256Stream(object.body), object.size)
}

async function remove(env: Env, userId: string, roomId: string, id: string): Promise<Response> {
	const stub: Room = { owner: ownerStub(env.OWNER, userId), roomId }
	const row = await stub.owner.roomCall(stub.roomId, "pendingRemove", [id])
	if (!row) return error(404, "not pending")
	if (row.uploadId) await fileStore(env).resumeMultipartUpload(row.r2Key, row.uploadId).abort().catch(() => {})
	await deleteFiles(fileStore(env), row.r2Key)
	return new Response(null, { status: 204 })
}

export function pendingRoute(request: Request, env: Env, userId: string, roomId: string, rest: readonly string[]): Promise<Response> | Response {
	const url = new URL(request.url)
	const [id = "", sub, n] = rest
	if (roomId === HOME || !isFileId(id)) return error(404, "not found")
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
