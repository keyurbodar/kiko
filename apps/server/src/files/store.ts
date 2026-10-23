import type { Env } from "../index"
import { ownerStub } from "../lib/names"
import type { BlobStore } from "./blob-store"
import { MAX_STORE_FILE_BYTES, type StoredInfo } from "./file-limits"

export interface StoredObject {
  key: string
  size: number
  httpEtag: string
  httpMetadata?: { contentType?: string }
  customMetadata?: Record<string, string>
  writeHttpMetadata(headers: Headers): void
}

interface StoredBody extends StoredObject {
  body: ReadableStream<Uint8Array>
  arrayBuffer(): Promise<ArrayBuffer>
}

type PutOptions = { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }
type Part = { partNumber: number; etag: string }

export interface FileBucket {
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string,
    options?: PutOptions,
  ): Promise<unknown>
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<StoredBody | null>
  head(key: string): Promise<StoredObject | null>
  delete(keys: string | string[]): Promise<void>
  createMultipartUpload(key: string, options?: PutOptions): Promise<{ uploadId: string; abort(): Promise<void> }>
  resumeMultipartUpload(
    key: string,
    uploadId: string,
  ): {
    uploadPart(n: number, body: ReadableStream<Uint8Array>): Promise<Part>
    complete(parts: Part[]): Promise<unknown>
    abort(): Promise<void>
  }
}

const KEY = /^u\/([^/]+)\/r\/([^/]+)\/[^/]+$/

function describe(key: string, info: StoredInfo): StoredObject {
  return {
    key,
    size: info.size,
    httpEtag: info.etag,
    httpMetadata: { contentType: info.type },
    customMetadata: info.meta,
    writeHttpMetadata: (headers) => headers.set("content-type", info.type),
  }
}

function bytesOf(value: ArrayBuffer | ArrayBufferView | string): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value)
  return value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

class OwnerBucket implements FileBucket {
  constructor(private readonly ns: Env["OWNER"]) {}

  #stub(key: string) {
    const m = KEY.exec(key)
    if (!m) throw new Error("not a file key")
    return ownerStub(this.ns, m[1] as string)
  }

  async put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string,
    options: PutOptions = {},
  ) {
    const body = value instanceof ReadableStream ? value : bytesOf(value)
    return this.#stub(key).blobPut(
      key,
      body,
      options.httpMetadata?.contentType ?? "application/octet-stream",
      options.customMetadata ?? {},
    )
  }

  async get(key: string, options: { range?: { offset: number; length: number } } = {}): Promise<StoredBody | null> {
    const out = await this.#stub(key).blobGet(key, options.range?.offset, options.range?.length)
    if (!out) return null
    const { body } = out
    return { ...describe(key, out.info), body, arrayBuffer: () => new Response(body).arrayBuffer() }
  }

  async head(key: string) {
    const info = await this.#stub(key).blobHead(key)
    return info ? describe(key, info) : null
  }

  async delete(keys: string | string[]) {
    const byObject = new Map<string, string[]>()
    for (const key of typeof keys === "string" ? [keys] : keys) {
      const m = KEY.exec(key)
      if (m) byObject.set(`${m[1]}/${m[2]}`, [...(byObject.get(`${m[1]}/${m[2]}`) ?? []), key])
    }
    for (const group of byObject.values()) await this.#stub(group[0] as string).blobRemove(group)
  }

  async createMultipartUpload(key: string, options: PutOptions = {}) {
    const stub = this.#stub(key)
    const uploadId = await stub.blobStartUpload(
      key,
      options.httpMetadata?.contentType ?? "application/octet-stream",
      options.customMetadata ?? {},
    )
    return { uploadId, abort: async () => stub.blobAbort(uploadId) }
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    const stub = this.#stub(key)
    return {
      uploadPart: (n: number, body: ReadableStream<Uint8Array>) => stub.blobPutPart(uploadId, n, body),
      complete: (parts: Part[]) => stub.blobFinish(key, uploadId, parts),
      abort: async () => stub.blobAbort(uploadId),
    }
  }
}

export function fileStore(env: Pick<Env, "FILES" | "OWNER">, local?: FileBucket): FileBucket {
  return local ?? (env.FILES ? (env.FILES as unknown as FileBucket) : new OwnerBucket(env.OWNER))
}

export const maxFileBytes = (env: Pick<Env, "FILES">, r2Max: number) =>
  env.FILES ? r2Max : Math.min(r2Max, MAX_STORE_FILE_BYTES)

export function localBucket(blobs: BlobStore): FileBucket {
  return {
    async put(key, value, options = {}) {
      return blobs.put(
        key,
        value instanceof ReadableStream ? value : bytesOf(value),
        options.httpMetadata?.contentType ?? "application/octet-stream",
        options.customMetadata ?? {},
      )
    },
    async get(key, options = {}) {
      const out = blobs.get(key, options.range?.offset, options.range?.length)
      if (!out) return null
      const { body } = out
      return { ...describe(key, out.info), body, arrayBuffer: () => new Response(body).arrayBuffer() }
    },
    async head(key) {
      const info = blobs.head(key)
      return info ? describe(key, info) : null
    },
    async delete(keys) {
      blobs.remove(typeof keys === "string" ? [keys] : keys)
    },
    async createMultipartUpload(key, options = {}) {
      const uploadId = blobs.startUpload(
        key,
        options.httpMetadata?.contentType ?? "application/octet-stream",
        options.customMetadata ?? {},
      )
      return { uploadId, abort: async () => blobs.abort(uploadId) }
    },
    resumeMultipartUpload(key, uploadId) {
      return {
        uploadPart: (n, body) => blobs.putPart(uploadId, n, body),
        complete: async (parts) => blobs.finish(key, uploadId, parts),
        abort: async () => blobs.abort(uploadId),
      }
    },
  }
}
