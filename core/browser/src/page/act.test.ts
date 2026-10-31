import { describe, expect, it, vi } from "vitest"
import type { Channel } from "../cdp/session"
import { act } from "./act"
import type { PageState } from "./read"

type WaitFor = (event: string, ms: number) => Promise<unknown>

const page = (over: Partial<PageState> = {}, waitFor: WaitFor = vi.fn(async () => undefined)) => {
  const channel = {
    sessionId: undefined,
    send: async () => ({}) as never,
    on: () => () => {},
    waitFor,
  } as unknown as Channel
  const state: PageState = { channel, targetId: "t1", labels: new Map(), notes: [], ...over }
  return { state, waitFor }
}

describe("wait for navigation", () => {
  it("waits on a load already in flight instead of a future one", async () => {
    const { state, waitFor } = page({ loading: Promise.resolve(), loaded: true })
    expect(await act(state, { op: "wait", navigation: true })).toEqual({ ok: true })
    expect(waitFor).not.toHaveBeenCalled()
    expect(state.loaded).toBe(false)
  })

  it("counts a load that finished before the wait", async () => {
    const { state, waitFor } = page({ loaded: true })
    expect(await act(state, { op: "wait", navigation: true })).toEqual({ ok: true })
    expect(waitFor).not.toHaveBeenCalled()
  })

  it("still times out when nothing loaded", async () => {
    const { state } = page()
    expect(await act(state, { op: "wait", navigation: true })).toEqual({
      ok: false,
      reason: "timeout",
      detail: "no page load within 8000 ms",
    })
  })

  it("succeeds when a later load lands", async () => {
    const { state } = page(
      {},
      vi.fn(async () => ({ timestamp: 1 })),
    )
    expect(await act(state, { op: "wait", navigation: true })).toEqual({ ok: true })
  })
})
