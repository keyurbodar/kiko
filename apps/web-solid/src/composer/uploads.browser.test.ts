import { describe, expect, it, vi } from "vitest"
import { progressLabel, releaseUpload, retryUpload, startUpload, uploadState } from "./uploads"

const ROOM = "01900000-0000-7000-8000-000000000051"
const MB = 1024 * 1024

class FakeXhr {
  static sent: FakeXhr[] = []
  readonly upload = new EventTarget()
  private readonly events = new EventTarget()
  status = 0
  responseText = ""
  timeout = 0
  url = ""
  open(_method: string, url: string) {
    this.url = url
  }
  setRequestHeader() {}
  addEventListener(type: string, listener: EventListener) {
    this.events.addEventListener(type, listener)
  }
  send() {
    FakeXhr.sent.push(this)
  }
  abort() {
    this.events.dispatchEvent(new Event("abort"))
  }
  progress(loaded: number, total: number) {
    this.upload.dispatchEvent(new ProgressEvent("progress", { lengthComputable: true, loaded, total }))
  }
  finish(status: number, body = "{}") {
    this.status = status
    this.responseText = body
    this.events.dispatchEvent(new Event("load"))
  }
}

function fakeXhr() {
  FakeXhr.sent = []
  vi.stubGlobal("XMLHttpRequest", FakeXhr)
  return { [Symbol.dispose]: () => void vi.unstubAllGlobals() }
}

describe("upload progress", () => {
  it("reports bytes sent out of the file size while the file uploads", async () => {
    using _xhr = fakeXhr()
    const size = Math.round(1.2 * MB)
    startUpload("up-bytes", ROOM, new Blob([new Uint8Array(size)]), "deck.pdf", "application/pdf")
    expect(uploadState("up-bytes")).toEqual({ status: "uploading", loaded: 0, total: size })

    FakeXhr.sent[0]!.progress(340 * 1024, size)
    const state = uploadState("up-bytes")
    expect(state).toEqual({ status: "uploading", loaded: 340 * 1024, total: size })
    expect(progressLabel(340 * 1024, size)).toBe("340 KB of 1.2 MB")

    FakeXhr.sent[0]!.finish(200)
    await expect.poll(() => uploadState("up-bytes")?.status).toBe("ready")
    releaseUpload("up-bytes")
  })

  it("starts again from zero bytes when a failed upload is retried", async () => {
    using _xhr = fakeXhr()
    startUpload("up-retry", ROOM, new Blob(["hello"]), "notes.md", "text/markdown")
    FakeXhr.sent[0]!.progress(3, 5)
    FakeXhr.sent[0]!.finish(500)
    await expect.poll(() => uploadState("up-retry")?.status).toBe("failed")

    retryUpload("up-retry")
    expect(uploadState("up-retry")).toEqual({ status: "uploading", loaded: 0, total: 5 })
    releaseUpload("up-retry")
  })
})

describe("progressLabel", () => {
  it("never shows more bytes than the file has", () => {
    expect(progressLabel(2 * MB, 1.5 * MB)).toBe("1.5 MB of 1.5 MB")
    expect(progressLabel(512, 2048)).toBe("512 B of 2.0 KB")
  })
})
