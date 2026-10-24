import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createPendingDeletes } from "./pending-delete"

describe("pending deletes", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("folds the row, then hides it, and deletes only when the undo window ends", () => {
    const commit = vi.fn()
    const deletes = createPendingDeletes({ undoMs: 6000, foldMs: 200, commit })
    deletes.start("a")
    expect(deletes.isLeaving("a")).toBe(true)
    vi.advanceTimersByTime(200)
    expect([deletes.isLeaving("a"), deletes.isHidden("a")]).toEqual([false, true])
    vi.advanceTimersByTime(5000)
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(commit).toHaveBeenCalledExactlyOnceWith("a")
    expect(deletes.isHidden("a")).toBe(false)
  })

  it("never deletes a chat the owner took back", () => {
    const commit = vi.fn()
    const deletes = createPendingDeletes({ undoMs: 6000, foldMs: 200, commit })
    deletes.start("a")
    vi.advanceTimersByTime(300)
    expect(deletes.undo("a")).toBe(true)
    expect(deletes.isHidden("a")).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(commit).not.toHaveBeenCalled()
  })

  it("deletes everything still waiting when the page goes away", () => {
    const commit = vi.fn()
    const deletes = createPendingDeletes({ undoMs: 6000, foldMs: 200, commit })
    deletes.start("a")
    deletes.start("b")
    deletes.flushAll()
    expect(commit.mock.calls).toEqual([["a"], ["b"]])
    vi.advanceTimersByTime(10_000)
    expect(commit).toHaveBeenCalledTimes(2)
  })
})
