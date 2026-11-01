import { describe, expect, it } from "vitest"
import { resolveThreadDetailsVisibility } from "./thread-details-items"
import { threadDetailsDefaultOpen, type ThreadDetailsPresence } from "./thread-details-default"

const presence = (over: Partial<ThreadDetailsPresence> = {}): ThreadDetailsPresence => ({
  now: false,
  waiting: false,
  progress: false,
  helpers: false,
  outputs: false,
  used: false,
  memory: false,
  ...over,
})

const visibility = resolveThreadDetailsVisibility({})

const open = (input: { desktop?: boolean; hasHistory?: boolean; shown?: Partial<ThreadDetailsPresence> } = {}) =>
  threadDetailsDefaultOpen({
    desktop: input.desktop ?? true,
    hasHistory: input.hasHistory ?? true,
    visibility,
    presence: presence(input.shown),
  })

describe("thread details default", () => {
  it("stays closed when the panel would only show its empty state", () => {
    expect(open()).toBe(false)
  })

  it("opens on desktop when a task, helper or file is waiting", () => {
    expect(open({ shown: { progress: true } })).toBe(true)
    expect(open({ shown: { helpers: true } })).toBe(true)
    expect(open({ shown: { outputs: true } })).toBe(true)
  })

  it("opens when the room is working or has a question", () => {
    expect(open({ shown: { now: true } })).toBe(true)
    expect(open({ shown: { waiting: true } })).toBe(true)
    expect(open({ shown: { used: true } })).toBe(true)
  })

  it("stays closed on a phone or in a room without history", () => {
    expect(open({ desktop: false, shown: { progress: true } })).toBe(false)
    expect(open({ hasHistory: false, shown: { progress: true } })).toBe(false)
  })

  it("stays closed when the owner hid the section that has something to show", () => {
    expect(
      threadDetailsDefaultOpen({
        desktop: true,
        hasHistory: true,
        visibility: resolveThreadDetailsVisibility({ helpers: false, outputs: false }),
        presence: presence({ helpers: true, outputs: true }),
      }),
    ).toBe(false)
  })
})
