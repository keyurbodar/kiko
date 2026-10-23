import { fileStore, maxFileBytes } from "./store"
import { sha256Stream } from "@kiko/durable/hash"
import type { Actor } from "@kiko/protocol"
import type { Env } from "../index"
import { ownerStub } from "../lib/names"
import type { SessionLookup } from "../router"
import type { NewFile } from "../room/files"
import { pendingRoute } from "./pending"
import {
  cleanPath,
  declaredSize,
  deleteFiles,
  error,
  fileKey,
  filesPath,
  HOME,
  isFileId,
  isSpace,
  json,
  MAX_SINGLE_PUT_BYTES,
  mime,
  part,
  refuse,
  storageRefusal,
  tooLarge,
} from "./paths"

const MAX_FILE_BYTES = 512 * 1024 * 1024
const HUMAN: Actor = { kind: "human" }

const expectOf = (value: unknown): string | null =>
  typeof value === "string" && /^(none|[0-9a-f]{64})$/.test(value) ? value : null
const EXPECT_ERROR = "say what you saw at the path: the sha256 of its bytes, or none for a new file"

async function index(env: Env, userId: string, roomId: string, input: NewFile): Promise<Response> {
  const owner = ownerStub(env.OWNER, userId)
  const { file, drop, conflict, refused } =
    roomId === HOME ? await owner.userCall("homePut", [input]) : await owner.roomCall(roomId, "putFile", [input])
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
    await fileStore(env)
      .resumeMultipartUpload(key, uploadId)
      .complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })))
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
  return index(env, userId, roomId, {
    id: fileId,
    path,
    r2Key: key,
    size: object.size,
    type,
    sha256,
    author: HUMAN,
    expectSha256,
  })
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
    await fileStore(env)
      .resumeMultipartUpload(key, uploadId)
      .abort()
      .catch(() => {})
    return new Response(null, { status: 204 })
  }
  return error(404, "not found")
}
