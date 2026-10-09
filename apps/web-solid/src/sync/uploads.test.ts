import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { forgetUpload, moveUpload, progressLabel, readyAttachments, releaseUpload, retryFailedUploads, retryUpload, startUpload, uploadBlockReason, uploadState } from "./uploads"

// The composer's upload queue against a fake XMLHttpRequest: three at once, progress in 5% steps,
// t3code's failure words, retry under the same pending id, and a delete only for what was sent.

type Fake = {
  method: string
  url: string
  body: unknown
  headers: Record<string, string>
  progress(loaded: number, total: number): void
  finish(status: number, text?: string): void
  fail(kind: "error" | "timeout"): void
  aborted: boolean
}

const open: Fake[] = []
const deletes: string[] = []

class FakeXHR {
  timeout = 0
  status = 0
  responseText = ""
  private listeners: Record<string, (() => void)[]> = {}
  private progressListeners: ((e: { lengthComputable: boolean; loaded: number }) => void)[] = []
  upload = { addEventListener: (_: string, f: (e: { lengthComputable: boolean; loaded: number }) => void) => this.progressListeners.push(f) }
  private fake: Fake = {
    method: "",
    url: "",
    body: null,
    headers: {},
    aborted: false,
    progress: (loaded) => this.progressListeners.forEach((f) => f({ lengthComputable: true, loaded })),
    finish: (status, text = "") => {
      this.status = status
      this.responseText = text
      this.emit("load")
    },
    fail: (kind) => this.emit(kind),
  }
  open(method: string, url: string) {
    this.fake.method = method
    this.fake.url = url
  }
  setRequestHeader(k: string, v: string) {
    this.fake.headers[k] = v
  }
  addEventListener(name: string, f: () => void) {
    ;(this.listeners[name] ??= []).push(f)
  }
  private emit(name: string) {
    for (const f of this.listeners[name] ?? []) f()
  }
  send(body: unknown) {
    this.fake.body = body
    open.push(this.fake)
  }
  abort() {
    this.fake.aborted = true
    this.emit("abort")
  }
}

const original = { xhr: globalThis.XMLHttpRequest, fetch: globalThis.fetch }
beforeAll(() => {
  ;(globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") deletes.push(String(url))
    return new Response(null, { status: 204 })
  }) as typeof fetch
})
afterAll(() => {
  ;(globalThis as { XMLHttpRequest: unknown }).XMLHttpRequest = original.xhr
  globalThis.fetch = original.fetch
})

const tick = () => new Promise((r) => setTimeout(r, 0))
const blob = (size: number) => new Blob([new Uint8Array(size)])
const take = () => open.splice(0)

describe("the upload queue", () => {
  test("three upload at once, each as a PUT of pending bytes with its name and size", async () => {
    for (const id of ["a1", "a2", "a3", "a4"]) startUpload(id, "room1", blob(10), `${id}.txt`, "text/plain")
    const first = take()
    expect(first.length).toBe(3)
    expect(first[0]!.method).toBe("PUT")
    expect(first[0]!.url).toMatch(/^\/api\/files\/room1\/pending\/[0-9a-f-]{36}\?name=a1.txt&size=10$/)
    expect(first[0]!.headers["content-type"]).toBe("text/plain")
    first[0]!.finish(204)
    await tick()
    expect(take().length).toBe(1)
    for (const f of first.slice(1)) f.finish(204)
    await tick()
    expect(["a1", "a2", "a3"].map((id) => uploadState(id)?.status)).toEqual(["ready", "ready", "ready"])
    for (const id of ["a1", "a2", "a3", "a4"]) releaseUpload(id)
    take()
  })

  test("progress moves in 5% steps", async () => {
    startUpload("p1", "room1", blob(1000), "p.bin", "application/octet-stream")
    const [req] = take()
    req!.progress(420, 1000)
    expect(uploadState("p1")).toEqual({ status: "uploading", progress: 0.4 })
    expect(progressLabel(0.4)).toBe("40%")
    req!.progress(449, 1000)
    expect(uploadState("p1")).toEqual({ status: "uploading", progress: 0.4 })
    req!.progress(450, 1000)
    expect(uploadState("p1")).toEqual({ status: "uploading", progress: 0.45 })
    req!.finish(204)
    await tick()
    releaseUpload("p1")
    take()
  })

  test("a failure says why in t3code's words, blocks the send, and a retry uses the same pending id", async () => {
    startUpload("f1", "room1", blob(5), "f.txt", "text/plain")
    const [first] = take()
    first!.finish(413)
    await tick()
    expect(uploadState("f1")).toEqual({ status: "failed", reason: "Upload rejected (413)" })
    expect(uploadBlockReason(["f1"])).toBe("Retry or remove the failed attachment")
    retryUpload("f1")
    const [second] = take()
    expect(second!.url).toBe(first!.url)
    second!.fail("timeout")
    await tick()
    expect(uploadState("f1")).toEqual({ status: "failed", reason: "Upload timed out" })
    retryFailedUploads()
    const [third] = take()
    third!.fail("error")
    await tick()
    expect(uploadState("f1")).toEqual({ status: "failed", reason: "Upload failed" })
    releaseUpload("f1")
  })

  test("the send waits while anything uploads, and names every ready upload in order", async () => {
    startUpload("s1", "room1", blob(3), "one.png", "image/png")
    startUpload("s2", "room1", blob(4), "two.pdf", "application/pdf")
    const [one, two] = take()
    expect(uploadBlockReason(["s1", "s2"])).toBe("Attachments still uploading")
    one!.finish(204)
    await tick()
    expect(uploadBlockReason(["s1", "s2"])).toBe("Attachment still uploading")
    expect(readyAttachments([{ id: "s1", name: "one.png", type: "image/png", size: 3 }, { id: "s2", name: "two.pdf", type: "application/pdf", size: 4 }])).toBeNull()
    two!.finish(204)
    await tick()
    expect(uploadBlockReason(["s1", "s2"])).toBeNull()
    const ready = readyAttachments([{ id: "s1", name: "one.png", type: "image/png", size: 3 }, { id: "s2", name: "two.pdf", type: "application/pdf", size: 4 }])
    expect(ready?.map((a) => [a.name, a.pendingId])).toEqual([
      ["one.png", one!.url.split("/pending/")[1]!.split("?")[0]!],
      ["two.pdf", two!.url.split("/pending/")[1]!.split("?")[0]!],
    ])
    // A sent attachment is the room's: forgetting it deletes nothing.
    const before = deletes.length
    forgetUpload("s1")
    forgetUpload("s2")
    await tick()
    expect(deletes.length).toBe(before)
  })

  test("removing an attachment aborts its upload and deletes what reached the server", async () => {
    startUpload("r1", "room1", blob(3), "r.txt", "text/plain")
    const [req] = take()
    releaseUpload("r1")
    expect(req!.aborted).toBe(true)
    await tick()
    expect(deletes.at(-1)).toBe(req!.url.split("?")[0]!)
    expect(uploadState("r1")).toBeUndefined()
  })

  test("an attachment that moves to another chat uploads again there and the old upload is deleted", async () => {
    startUpload("m1", "room1", blob(3), "m.txt", "text/plain")
    const [old] = take()
    old!.finish(204)
    await tick()
    moveUpload("m1", "room2")
    await tick()
    expect(deletes.at(-1)).toBe(old!.url.split("?")[0]!)
    const [fresh] = take()
    expect(fresh!.url).toMatch(/^\/api\/files\/room2\/pending\//)
    releaseUpload("m1")
  })

  test("a file over 32 MB goes in 16 MB parts with progress across them", async () => {
    const size = 40 * 1024 * 1024
    startUpload("big", "room1", blob(size), "big.bin", "application/octet-stream")
    const [create] = take()
    expect(create!.url).toMatch(/\/pending\/[0-9a-f-]{36}\/parts$/)
    expect(JSON.parse(create!.body as string)).toEqual({ name: "big.bin", type: "application/octet-stream", size })
    create!.finish(200, JSON.stringify({ uploadId: "u1" }))
    await tick()
    const [p1] = take()
    expect(p1!.url).toMatch(/\/parts\/1\?uploadId=u1$/)
    expect((p1!.body as Blob).size).toBe(16 * 1024 * 1024)
    p1!.finish(200, JSON.stringify({ partNumber: 1, etag: "e1" }))
    await tick()
    const [p2] = take()
    p2!.progress(8 * 1024 * 1024, 16 * 1024 * 1024)
    expect(uploadState("big")).toEqual({ status: "uploading", progress: 0.6 })
    p2!.finish(200, JSON.stringify({ partNumber: 2, etag: "e2" }))
    await tick()
    const [p3] = take()
    expect((p3!.body as Blob).size).toBe(8 * 1024 * 1024)
    p3!.finish(200, JSON.stringify({ partNumber: 3, etag: "e3" }))
    await tick()
    const [done] = take()
    expect(done!.url).toMatch(/\/complete\?uploadId=u1$/)
    expect(JSON.parse(done!.body as string).parts.length).toBe(3)
    done!.finish(204)
    await tick()
    expect(uploadState("big")?.status).toBe("ready")
    releaseUpload("big")
  })
})
