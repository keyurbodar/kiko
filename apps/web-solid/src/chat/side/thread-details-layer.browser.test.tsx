import { describe, expect, it } from "vitest"
import { setThreadDetailsFloating, threadDetailsOpenFor, toggleThreadDetails } from "./thread-details-layer"

const CHAT = "01900000-0000-7000-8000-0000000000d1"

describe("thread details open state", () => {
  it("waits for the owner to ask before it floats over the chat, and keeps the docked choice", () => {
    localStorage.clear()
    setThreadDetailsFloating(false)
    toggleThreadDetails(CHAT)
    const docked = threadDetailsOpenFor(CHAT)

    setThreadDetailsFloating(true)
    expect(threadDetailsOpenFor(CHAT)).toBe(false)

    toggleThreadDetails(CHAT)
    expect(threadDetailsOpenFor(CHAT)).toBe(true)

    setThreadDetailsFloating(false)
    expect(threadDetailsOpenFor(CHAT)).toBe(docked)

    setThreadDetailsFloating(true)
    expect(threadDetailsOpenFor(CHAT)).toBe(false)
  })
})
