import { describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { setThreadDetailsFloating, threadDetailsOpenFor, toggleThreadDetails } from "./thread-details-layer"

const fake = vi.hoisted(() => ({ rows: new Map<string, { preview: string; lastFrom?: string }>() }))

vi.mock("../../state/room", () => ({
  fileSrc: () => "",
  room: { chatById: (id: string) => fake.rows.get(id), messages: () => [] },
}))

const CHAT = "01900000-0000-7000-8000-0000000000d1"
const OLD = "01900000-0000-7000-8000-0000000000d2"
const FRESH = "01900000-0000-7000-8000-0000000000d3"

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

  it("opens by default for a chat with history even before its messages load", async () => {
    await page.viewport(1440, 900)
    localStorage.clear()
    setThreadDetailsFloating(false)
    fake.rows.set(OLD, { preview: "hi", lastFrom: "human" })
    fake.rows.set(FRESH, { preview: "" })

    expect(threadDetailsOpenFor(OLD)).toBe(true)
    expect(threadDetailsOpenFor(FRESH)).toBe(false)
  })
})
