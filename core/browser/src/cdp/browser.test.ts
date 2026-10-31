import { beforeEach, describe, expect, it, vi } from "vitest"
import { connect } from "./browser"
import type { CdpSession } from "./session"

const mock = vi.hoisted(() => ({ session: null as unknown }))

vi.mock("./session", () => ({
  openSession: async () => mock.session,
}))

type Sent = { method: string; params?: Record<string, unknown> }

function fakeSession() {
  const sent: Sent[] = []
  const listeners = new Map<string, Set<(params: unknown) => void>>()
  const on = (event: string, listener: (params: unknown) => void) => {
    const set = listeners.get(event) ?? new Set()
    listeners.set(event, set)
    set.add(listener)
    return () => set.delete(listener)
  }
  const send = async (method: string, params?: Record<string, unknown>) => {
    sent.push({ method, params })
    if (method === "Target.attachToTarget") return { sessionId: "s1" }
    if (method === "Target.createTarget") return { targetId: "t1" }
    return {}
  }
  const channel = (sessionId?: string) => ({ sessionId, send, on, waitFor: async () => undefined })
  const close = vi.fn(async () => {})
  const session = {
    ...channel(),
    channel,
    closed: new Promise<void>(() => {}),
    close,
  } as unknown as CdpSession
  const emit = (event: string, params: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(params)
  }
  return { session, sent, emit, close }
}

const popup = (targetId: string, openerId: string) => ({
  targetInfo: { type: "page", targetId, openerId, url: "https://popup.example/" },
})

describe("connect", () => {
  let fake: ReturnType<typeof fakeSession>

  beforeEach(() => {
    fake = fakeSession()
    mock.session = fake.session
  })

  it("tracks a popup opened by a tracked tab and closes it with the session", async () => {
    const session = await connect("ws://cdp")
    await session.openTab()
    fake.emit("Target.targetCreated", popup("t2", "t1"))
    expect(session.popups()).toEqual([{ id: "t2", url: "https://popup.example/" }])
    await session.close()
    expect(fake.sent).toContainEqual({ method: "Target.closeTarget", params: { targetId: "t2" } })
    expect(session.popups()).toEqual([])
    expect(fake.close).toHaveBeenCalledOnce()
  })

  it("ignores a target whose opener is not tracked", async () => {
    const session = await connect("ws://cdp")
    fake.emit("Target.targetCreated", popup("t9", "nope"))
    expect(session.popups()).toEqual([])
  })

  it("forgets a popup the browser destroyed", async () => {
    const session = await connect("ws://cdp")
    await session.openTab()
    fake.emit("Target.targetCreated", popup("t2", "t1"))
    fake.emit("Target.targetDestroyed", { targetId: "t2" })
    expect(session.popups()).toEqual([])
  })
})
