import { describe, expect, test } from "bun:test"
import { CURL_BODY_CAP, KernelError } from "../src/integrations/kernel/client"
import { basenameOf, decodeBase64, encodeBase64, FETCH_METHODS, FILE_CAP } from "../src/integrations/kernel/files"
import { KernelWiring } from "../src/user/kernel-wiring"

const OPEN = { sessionId: "s1", dead: false, tabs: {}, mode: "headless", lastUse: 0, createdAt: 0, takeover: false, watchUntil: 0 }

function wire(client: object, open = true): KernelWiring {
  const store = { connected: () => true, lease: () => (open ? OPEN : undefined), key: async () => "k", generation: 0 }
  return new KernelWiring({ ctx: {}, sql: {}, env: {}, alarms: {}, userId: () => "u", store, clientFor: () => client } as never)
}

describe("basenameOf", () => {
  test("keeps only the last path segment", () => {
    expect(basenameOf("/etc/passwd")).toBe("passwd")
    expect(basenameOf("..\\..\\win.ini")).toBe("win.ini")
  })

  test("replaces unsafe characters and drops leading dots", () => {
    expect(basenameOf("../../a;rm -rf *.txt")).toBe("a_rm -rf _.txt")
    expect(basenameOf(".hidden")).toBe("hidden")
  })

  test("refuses a name that is empty after sanitizing", () => {
    expect(() => basenameOf("/")).toThrow(KernelError)
    expect(() => basenameOf("...")).toThrow(KernelError)
  })
})

describe("base64 caps", () => {
  test("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes)
  })

  test("refuses a payload over 10 MB before decoding", () => {
    const huge = "A".repeat(Math.ceil((FILE_CAP * 4) / 3) + 100)
    expect(() => decodeBase64(huge)).toThrow("over 10 MB")
  })

  test("accepts a payload at exactly 10 MB", () => {
    const bytes = new Uint8Array(FILE_CAP)
    expect(decodeBase64(encodeBase64(bytes)).byteLength).toBe(FILE_CAP)
  })
})

describe("fetch edge", () => {
  test("only the six fetch methods are allowed", () => {
    expect(Object.keys(FETCH_METHODS).sort()).toEqual(["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"])
    expect(FETCH_METHODS.OPTIONS).toBeUndefined()
  })

  test("fetch tells the model when Kernel cut the body", async () => {
    const wiring = wire({ curl: async () => ({ status: 200, headers: {}, body: "x".repeat(CURL_BODY_CAP), truncated: true }) })
    const out = await wiring.fetch({ url: "https://example.com" })
    expect(out.truncated).toBe(true)
    expect(out.body.length).toBe(CURL_BODY_CAP)
  })

  test("fetch leaves a whole body marked whole", async () => {
    const out = await wire({ curl: async () => ({ status: 200, headers: {}, body: "ok", truncated: false }) }).fetch({ url: "https://example.com" })
    expect(out).toMatchObject({ body: "ok", truncated: false })
  })

  test("fetch refuses a bad method before any Kernel call", async () => {
    const wiring = wire({ curl: async () => { throw new Error("called") } })
    await expect(wiring.fetch({ url: "https://example.com", method: "OPTIONS" as never })).rejects.toThrow("bad method")
  })
})

describe("scheme and connection checks", () => {
  test("refuses a non-http url before any Kernel call", async () => {
    const calls: string[] = []
    const wiring = wire({ curl: async (id: string) => void calls.push(id) })
    await expect(wiring.fetch({ url: "file:///etc/passwd" })).rejects.toThrow("only http and https urls")
    expect(calls).toEqual([])
  })

  test("refuses file operations when no browser is open", async () => {
    const wiring = wire({}, false)
    await expect(wiring.putFile("a.txt", new Uint8Array([1]))).rejects.toThrow("No browser is open")
    await expect(wiring.getFile("/tmp/a.txt")).rejects.toThrow("No browser is open")
  })

  test("getFile refuses paths outside /tmp and the downloads folder", async () => {
    const wiring = wire({})
    await expect(wiring.getFile("/etc/passwd")).rejects.toThrow("only files under /tmp or the downloads folder")
    await expect(wiring.getFile("/tmp/../etc/passwd")).rejects.toThrow("only files under /tmp or the downloads folder")
  })
})
