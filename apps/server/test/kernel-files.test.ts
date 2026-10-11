import { describe, expect, test } from "bun:test"
import { KernelError } from "../src/integrations/kernel/client"
import { KernelConnection } from "../src/integrations/kernel/connect"
import { basenameOf, decodeBase64, encodeBase64, FETCH_BODY_CAP, FETCH_METHODS, FILE_CAP } from "../src/integrations/kernel/files"

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

  test("fetchPage forwards timeoutMs and caps the body at the client", async () => {
    const seen: { timeoutMs?: number; body: string }[] = []
    const conn = new KernelConnection({
      store: { connected: () => true, lease: () => ({ sessionId: "s1", dead: false, tabs: {}, mode: "headless", lastUse: 0, takeover: false, watchUntil: 0 }), key: async () => "k", generation: 0 } as never,
      userId: () => "u",
      wake: { set: async () => {}, clear: async () => {} },
      clientFor: () => ({
        curl: async (_id: string, req: { timeoutMs?: number }) => {
          seen.push({ timeoutMs: req.timeoutMs, body: "x".repeat(FETCH_BODY_CAP + 5) })
          return { status: 200, headers: {}, body: "x".repeat(FETCH_BODY_CAP + 5), truncated: false }
        },
      }) as never,
    })
    const out = await conn.fetchPage({ url: "https://example.com", timeoutMs: 1234 })
    expect(seen[0]?.timeoutMs).toBe(1234)
    expect(out.body.length).toBe(FETCH_BODY_CAP + 5)
  })
})

describe("scheme and connection checks", () => {
  test("refuses a non-http url before any Kernel call", async () => {
    const calls: string[] = []
    const conn = new KernelConnection({
      store: { connected: () => true, lease: () => undefined, key: async () => "k", generation: 0 } as never,
      userId: () => "u",
      wake: { set: async () => {}, clear: async () => {} },
      clientFor: () => ({ curl: async (id: string) => void calls.push(id) }) as never,
    })
    await expect(conn.fetchPage({ url: "file:///etc/passwd" })).rejects.toThrow("only http and https urls")
    expect(calls).toEqual([])
  })

  test("refuses file operations when no browser is open", async () => {
    const conn = new KernelConnection({
      store: { connected: () => true, lease: () => undefined, key: async () => "k", generation: 0 } as never,
      userId: () => "u",
      wake: { set: async () => {}, clear: async () => {} },
      clientFor: () => ({}) as never,
    })
    await expect(conn.putFile("a.txt", new Uint8Array([1]))).rejects.toThrow("No browser is open")
    await expect(conn.getFile("/tmp/a.txt")).rejects.toThrow("No browser is open")
  })

  test("getFile refuses paths outside /tmp and the downloads folder", async () => {
    const conn = new KernelConnection({
      store: {
        connected: () => true,
        lease: () => ({ sessionId: "s1", dead: false, tabs: {}, mode: "headless", lastUse: 0, createdAt: 0, takeover: false, watchUntil: 0 }),
        key: async () => "k",
        generation: 0,
      } as never,
      userId: () => "u",
      wake: { set: async () => {}, clear: async () => {} },
      clientFor: () => ({}) as never,
    })
    await expect(conn.getFile("/etc/passwd")).rejects.toThrow("only files under /tmp or the downloads folder")
    await expect(conn.getFile("/tmp/../etc/passwd")).rejects.toThrow("only files under /tmp or the downloads folder")
  })
})
