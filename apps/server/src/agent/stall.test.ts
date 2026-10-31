import { describe, expect, it, vi } from "vitest"
import { FIRST_BYTE_MS, orStall } from "./stall"

describe("orStall", () => {
  it("returns work that finishes before the timer", async () => {
    await expect(orStall(Promise.resolve("answer"), FIRST_BYTE_MS)).resolves.toBe("answer")
  })

  it("times out when nothing arrives", async () => {
    vi.useFakeTimers()
    try {
      const pending = orStall(new Promise<never>(() => {}), FIRST_BYTE_MS)
      const failed = expect(pending).rejects.toThrow("the model stopped responding")
      await vi.advanceTimersByTimeAsync(FIRST_BYTE_MS)
      await failed
    } finally {
      vi.useRealTimers()
    }
  })

  it("stops waiting as soon as the signal aborts", async () => {
    const controller = new AbortController()
    const pending = orStall(new Promise<never>(() => {}), FIRST_BYTE_MS, controller.signal)
    const reason = new Error("stopped")
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it("rejects at once for a signal that already aborted", async () => {
    const controller = new AbortController()
    const reason = new Error("stopped")
    controller.abort(reason)
    await expect(orStall(new Promise<never>(() => {}), FIRST_BYTE_MS, controller.signal)).rejects.toBe(reason)
  })
})
