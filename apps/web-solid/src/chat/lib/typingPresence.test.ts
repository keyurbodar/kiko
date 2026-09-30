import { afterEach, describe, expect, test, vi } from "bun:test"
import { createRoot } from "solid-js"
import { createTypingPresence, type TypingPresence, type TypingPresenceOptions } from "./typingPresence"

const OPTIONS: TypingPresenceOptions = { timeout: 20, minVisible: 60, sendMs: 30 }

function presence(options: TypingPresenceOptions = OPTIONS): TypingPresence {
  return createRoot(() => createTypingPresence(options))
}

afterEach(() => {
  vi.useRealTimers()
})

describe("typing presence", () => {
  test("a ping puts the name on the roster", () => {
    vi.useFakeTimers()
    const store = presence()
    store.ping("kiko")
    expect(store.typists()).toEqual(["kiko"])
    expect(store.sending()).toBe(false)
  })

  test("holds the roster for the minimum window after the last ping expires", () => {
    vi.useFakeTimers()
    const store = presence()
    store.ping("kiko")

    // Past the 20ms idle deadline but inside the 60ms minimum window: still
    // up, because a name that flashed for 20ms reads as a glitch.
    vi.advanceTimersByTime(35)
    expect(store.typists()).toEqual(["kiko"])

    // One tick past the minimum window and it goes.
    vi.advanceTimersByTime(35)
    expect(store.typists()).toEqual([])
  })

  test("a name that keeps pinging never trips the minimum window", () => {
    vi.useFakeTimers()
    const store = presence()
    store.ping("kiko")
    vi.advanceTimersByTime(15)
    store.ping("kiko")
    vi.advanceTimersByTime(30)
    expect(store.typists()).toEqual(["kiko"])
    vi.advanceTimersByTime(60)
    expect(store.typists()).toEqual([])
  })

  test("the roster keeps the order names first appeared in", () => {
    vi.useFakeTimers()
    const store = presence()
    store.ping("kiko")
    vi.advanceTimersByTime(5)
    store.ping("aria")
    store.ping("kiko")
    expect(store.typists()).toEqual(["kiko", "aria"])
  })

  test("a name already past its minimum window leaves on the first idle tick", () => {
    vi.useFakeTimers()
    const store = presence({ timeout: 15, minVisible: 0, sendMs: 10 })
    store.ping("kiko")
    vi.advanceTimersByTime(20)
    expect(store.typists()).toEqual([])
  })

  test("send raises sending for exactly the send duration", () => {
    vi.useFakeTimers()
    const store = presence()
    store.send()
    expect(store.sending()).toBe(true)

    vi.advanceTimersByTime(29)
    expect(store.sending()).toBe(true)

    vi.advanceTimersByTime(1)
    expect(store.sending()).toBe(false)

    // And it does not come back on its own.
    vi.advanceTimersByTime(200)
    expect(store.sending()).toBe(false)
  })

  test("a leaving name holds the bubble for the send duration", () => {
    vi.useFakeTimers()
    const store = presence()
    store.ping("kiko")

    // The idle deadline at 20ms, then the minimum window running to 60ms.
    vi.advanceTimersByTime(70)
    expect(store.typists()).toEqual([])
    expect(store.sending()).toBe(true)

    vi.advanceTimersByTime(19)
    expect(store.sending()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(store.sending()).toBe(false)
  })

  test("a second send extends the hold rather than stacking timers", () => {
    vi.useFakeTimers()
    const store = presence()
    store.send()
    vi.advanceTimersByTime(20)
    store.send()
    vi.advanceTimersByTime(20)
    expect(store.sending()).toBe(true)
    vi.advanceTimersByTime(10)
    expect(store.sending()).toBe(false)
  })

  test("a cancelled roster clears the names and stays cleared", () => {
    vi.useFakeTimers()
    const store = presence()
    store.ping("kiko")
    store.ping("aria")
    store.clear()

    expect(store.typists()).toEqual([])

    // Nothing was left armed: the whole window elapses with no resurrection.
    vi.advanceTimersByTime(500)
    expect(store.typists()).toEqual([])
  })

  test("clear cancels a pending removal so the next name starts clean", () => {
    vi.useFakeTimers()
    const store = presence()
    store.ping("kiko")
    store.clear()
    store.ping("aria")
    vi.advanceTimersByTime(80)
    expect(store.typists()).toEqual([])
  })

  test("clear leaves a send in flight to finish, reset cuts it", () => {
    vi.useFakeTimers()
    const store = presence()
    store.ping("kiko")
    store.send()
    store.clear()

    expect(store.typists()).toEqual([])
    expect(store.sending()).toBe(true)
    vi.advanceTimersByTime(30)
    expect(store.sending()).toBe(false)

    store.send()
    expect(store.sending()).toBe(true)
    store.reset()
    expect(store.sending()).toBe(false)
    vi.advanceTimersByTime(200)
    expect(store.sending()).toBe(false)
  })

  test("the wave is readable and writable through one signal", () => {
    vi.useFakeTimers()
    const store = presence()
    const [phase, advance] = store.beat
    expect(phase()).toBe(0)
    advance(1.25)
    expect(phase()).toBe(1.25)
    advance((previous) => previous + 0.75)
    expect(phase()).toBe(2)
  })
})
