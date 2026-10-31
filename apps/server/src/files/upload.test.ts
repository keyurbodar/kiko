import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Env } from "../index"
import type { FileBucket } from "./store"
import { uploadRoute } from "./upload"

function fakeDigestStream() {
  return Object.assign(new WritableStream<Uint8Array>(), { digest: Promise.resolve(new ArrayBuffer(32)) })
}

const digestHost = globalThis as unknown as { crypto: { DigestStream?: unknown } }

beforeAll(() => {
  Object.defineProperty(digestHost.crypto, "DigestStream", { value: fakeDigestStream, configurable: true })
})

afterAll(() => {
  Reflect.deleteProperty(digestHost.crypto, "DigestStream")
})

const ROOM = "0190a5b2-7c3e-7a1b-8c2d-3e4f5a6b7c8d"
const FILE = "0190a5b2-7c3e-7a1b-8c2d-3e4f5a6b7c8d"

type Held = { bytes: Uint8Array; type: string; meta: Record<string, string> }

function fakeBucket() {
  const objects = new Map<string, Held>()
  const uploads = new Map<string, Held>()
  const info = (key: string, held: Held) => ({
    key,
    size: held.bytes.length,
    httpEtag: "",
    httpMetadata: { contentType: held.type },
    customMetadata: held.meta,
    writeHttpMetadata: () => {},
  })
  const bucket = {
    put: async () => {},
    head: async (key: string) => {
      const held = objects.get(key)
      return held ? info(key, held) : null
    },
    get: async (key: string) => {
      const held = objects.get(key)
      if (!held) return null
      return { ...info(key, held), body: new Response(held.bytes).body, arrayBuffer: async () => held.bytes.buffer }
    },
    delete: async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key)
    },
    createMultipartUpload: async (
      key: string,
      options: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } = {},
    ) => {
      const uploadId = crypto.randomUUID()
      uploads.set(uploadId, {
        bytes: new Uint8Array(),
        type: options.httpMetadata?.contentType ?? "",
        meta: options.customMetadata ?? {},
      })
      return { uploadId, abort: async () => void uploads.delete(uploadId) }
    },
    resumeMultipartUpload: (key: string, uploadId: string) => ({
      uploadPart: async () => ({ partNumber: 1, etag: "e" }),
      complete: async () => {
        const held = uploads.get(uploadId)
        if (!held) throw new Error("no such upload")
        uploads.delete(uploadId)
        objects.set(key, held)
      },
      abort: async () => void uploads.delete(uploadId),
    }),
  }
  return { bucket: bucket as unknown as FileBucket, objects }
}

describe("uploadRoute", () => {
  it("refuses a caller with no session", async () => {
    const { bucket, objects } = fakeBucket()
    const env = { FILES: bucket } as unknown as Env
    const request = new Request(`https://kiko.test/api/files/${ROOM}/uploads/${FILE}`, { method: "POST" })
    const response = await uploadRoute(request, env, async () => null)
    expect(response?.status).toBe(401)
    expect(objects.size).toBe(0)
  })

  it("deletes a completed upload whose object carries no expect metadata", async () => {
    const { bucket, objects } = fakeBucket()
    const env = { FILES: bucket } as unknown as Env
    const key = `u/owner/r/${ROOM}/${FILE}`
    const upload = await bucket.createMultipartUpload(key, {
      httpMetadata: { contentType: "text/markdown" },
      customMetadata: { path: "notes.md" },
    })
    const request = new Request(`https://kiko.test/api/files/${ROOM}/uploads/${FILE}?uploadId=${upload.uploadId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: "e" }] }),
    })
    const response = await uploadRoute(request, env, async () => ({ id: "owner" }))
    expect(response?.status).toBe(400)
    expect(objects.has(key)).toBe(false)
  })
})
