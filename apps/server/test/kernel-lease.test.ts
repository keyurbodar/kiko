import { describe, expect, test } from "bun:test"
import { type KernelClient, KernelError } from "../src/integrations/kernel/client"
import { IDLE_MS, KernelLease, type LeaseStore, reapDecision, TAKEOVER_RECHECK_MS } from "../src/integrations/kernel/lease"
import type { LeaseRow, LeaseUrls } from "../src/integrations/kernel/store"

/** A store in memory with the same behavior the lease relies on. */
function memoryStore() {
  let row: LeaseRow | undefined
  let urls: LeaseUrls | undefined
  let profile = false
  const state = { broken: false }
  const store: LeaseStore = {
    generation: 0,
    lease: () => (row ? { ...row, tabs: structuredClone(row.tabs) } : undefined),
    urls: async () => urls,
    putLease: async (r, u) => {
      row = { ...r }
      urls = u
      return true
    },
    patchLease: (patch) => {
      if (row) row = { ...row, ...patch }
    },
    deleteLease: () => {
      row = undefined
      urls = undefined
    },
    profileReady: () => profile,
    setProfileReady: (on) => void (profile = on),
    setBroken: (on) => void (state.broken = on),
  }
  return { store, state }
}

/** A Kernel that records every call and holds the browsers that are alive. */
function fakeKernel(script: { createErrors?: KernelError[]; deleteError?: KernelError } = {}) {
  const calls: string[] = []
  const live = new Set<string>()
  let maxLive = 0
  let n = 0
  const createErrors = [...(script.createErrors ?? [])]
  const client: KernelClient = {
    async createBrowser({ headless, profile }) {
      calls.push(`create ${headless ? "headless" : "headful"} ${profile}`)
      await Promise.resolve()
      const err = createErrors.shift()
      if (err) throw err
      const sessionId = `s${++n}`
      live.add(sessionId)
      maxLive = Math.max(maxLive, live.size)
      return { sessionId, cdpUrl: `wss://cdp/${sessionId}`, ...(headless ? {} : { liveUrl: `https://live/${sessionId}` }) }
    },
    async deleteBrowser(id) {
      calls.push(`delete ${id}`)
      await Promise.resolve()
      if (script.deleteError) throw script.deleteError
      if (!live.delete(id)) throw new KernelError("not_found", "gone")
    },
    listActive: async () => [...live],
    alive: async (id) => live.has(id),
    async createProfile(name) {
      calls.push(`profile ${name}`)
    },
    deleteProfile: async (name) => void calls.push(`delete profile ${name}`),
    async curl(id, req) {
      calls.push(`curl ${id} ${req.method ?? "GET"}`)
      return { status: 200, headers: {}, body: req.url, durationMs: 1 }
    },
    async writeFile(id, path) {
      calls.push(`write ${id} ${path}`)
    },
    async readFile(id, path) {
      calls.push(`read ${id} ${path}`)
      return new Uint8Array([1])
    },
  }
  return { client, calls, live, maxLive: () => maxLive }
}

function setup(script: Parameters<typeof fakeKernel>[0] = {}, start = 1_000_000) {
  const { store, state } = memoryStore()
  const kernel = fakeKernel(script)
  const clock = { now: start }
  const sleeps: number[] = []
  const wakes: (number | null)[] = []
  const lease = new KernelLease({
    store,
    client: async () => kernel.client,
    profile: async () => "yuki-test",
    wake: { set: async (at) => void wakes.push(at), clear: async () => void wakes.push(null) },
    now: () => clock.now,
    sleep: async (ms) => void (sleeps.push(ms), (clock.now += ms)),
  })
  return { lease, store, state, kernel, clock, sleeps, wakes }
}

describe("reaper decision table", () => {
  const base = { lastUse: 1_000, takeover: false, watchUntil: 0, dead: false }
  const cases: [string, Partial<typeof base>, number, ReturnType<typeof reapDecision>][] = [
    ["fresh browser waits for the idle time", {}, 1_000 + 10, { delete: false, at: 1_000 + IDLE_MS }],
    ["idle past the warm window is deleted", {}, 1_000 + IDLE_MS, { delete: true }],
    ["recent use pushes the idle time out", { lastUse: 200_000 }, 250_000, { delete: false, at: 200_000 + IDLE_MS }],
    ["a browser used inside the idle window survives any age", { lastUse: 10_000_000 }, 10_000_000 + IDLE_MS - 1, { delete: false, at: 10_000_000 + IDLE_MS }],
    ["an idle browser is deleted at its idle time, whatever its age", { lastUse: 1_000 }, 1_000 + IDLE_MS, { delete: true }],
    ["takeover keeps it however old", { takeover: true }, 1_000 + IDLE_MS * 20, { delete: false, at: 1_000 + IDLE_MS * 20 + TAKEOVER_RECHECK_MS }],
    ["watching keeps it until the watch ends", { watchUntil: 5_000_000 }, 4_000_000, { delete: false, at: 5_000_000 }],
    ["a watch in the past does not count", { watchUntil: 500 }, 1_000 + IDLE_MS, { delete: true }],
    ["a dead browser is deleted at once", { dead: true, takeover: true }, 1_001, { delete: true }],
  ]
  for (const [name, row, now, want] of cases) {
    test(name, () => {
      expect(reapDecision({ ...base, ...row }, now)).toEqual(want)
    })
  }
})

describe("lease", () => {
  test("two agents asking at once share one browser, made headless on the user's profile", async () => {
    const t = setup()
    const [a, b] = await Promise.all([t.lease.lease("room/ada"), t.lease.lease("room/bob")])
    expect(a.cdpUrl).toBe(b.cdpUrl)
    expect(a).toMatchObject({ mode: "headless", restarted: false })
    expect(t.kernel.calls).toEqual(["profile yuki-test", "create headless yuki-test"])
    expect(t.lease.status()).toEqual({ mode: "headless", tabs: { "room/ada": 0, "room/bob": 0 } })
  })

  test("the profile is created once", async () => {
    const t = setup()
    await t.lease.lease("a")
    await t.lease.close()
    await t.lease.lease("a")
    expect(t.kernel.calls.filter((c) => c.startsWith("profile"))).toHaveLength(1)
  })

  test("a switch deletes the old browser before it creates the new one, and reports the tabs", async () => {
    const t = setup()
    await t.lease.lease("room/ada")
    t.lease.touch("room/ada", { t1: "https://a.test/", t2: "https://b.test/" })
    const switched = await t.lease.switchMode("headful")
    expect(t.kernel.calls.slice(2)).toEqual(["delete s1", "create headful yuki-test"])
    expect(t.kernel.maxLive()).toBe(1)
    expect(switched).toEqual({ cdpUrl: "wss://cdp/s2", mode: "headful", tabs: { "room/ada": ["https://a.test/", "https://b.test/"] } })
    expect((await t.lease.lease("room/bob")).mode).toBe("headful")
    expect(t.kernel.calls.filter((c) => c.startsWith("create"))).toHaveLength(2)
  })

  test("a switch to the mode already running changes nothing", async () => {
    const t = setup()
    await t.lease.lease("a")
    await t.lease.switchMode("headless")
    expect(t.kernel.calls.filter((c) => c.startsWith("create") || c.startsWith("delete"))).toEqual(["create headless yuki-test"])
  })

  test("a switch keeps the human's takeover", async () => {
    const t = setup()
    await t.lease.lease("a")
    t.lease.setTakeover(true)
    await t.lease.switchMode("headful")
    expect(t.store.lease()?.takeover).toBe(true)
  })

  test("a dead browser is replaced on the next lease, and the caller gets its tabs back", async () => {
    const t = setup()
    await t.lease.lease("a")
    t.lease.touch("a", { t1: "https://a.test/" })
    t.kernel.live.delete("s1")
    expect(await t.lease.dead("s1")).toBe(true)
    expect(t.lease.touch("a")).toBe(false)
    const next = await t.lease.lease("a")
    expect(next).toMatchObject({ restarted: true, reopen: ["https://a.test/"], cdpUrl: "wss://cdp/s2" })
    expect(t.kernel.calls.slice(-2)).toEqual(["delete s1", "create headless yuki-test"])
    expect(t.kernel.maxLive()).toBe(1)
  })

  test("a dropped socket on a live browser, or a report about an old browser, keeps every agent's tabs", async () => {
    const t = setup()
    await t.lease.lease("a")
    await t.lease.lease("b")
    expect(await t.lease.dead("s1")).toBe(false)
    expect(await t.lease.dead("s0")).toBe(false)
    expect(t.lease.touch("b")).toBe(true)
    expect((await t.lease.lease("a")).sessionId).toBe("s1")
  })

  test("releasing an agent drops its tabs and keeps the browser", async () => {
    const t = setup()
    await t.lease.lease("a")
    await t.lease.lease("b")
    t.lease.release("a")
    expect(t.lease.status()?.tabs).toEqual({ b: 0 })
  })
})

describe("reaper", () => {
  test("keeps a browser inside its warm window and arms the next look", async () => {
    const t = setup()
    await t.lease.lease("a")
    t.clock.now += 60_000
    t.lease.touch("a")
    t.clock.now += IDLE_MS - 1_000
    await t.lease.reap()
    expect(t.store.lease()).toBeDefined()
    expect(t.wakes.at(-1)).toBe(1_000_000 + 60_000 + IDLE_MS)
  })

  test("deletes an idle browser and clears the wakeup", async () => {
    const t = setup()
    await t.lease.lease("a")
    t.clock.now += IDLE_MS
    await t.lease.reap()
    expect(t.store.lease()).toBeUndefined()
    expect(t.kernel.live.size).toBe(0)
    expect(t.wakes.at(-1)).toBeNull()
  })

  test("a browser Kernel already reaped counts as deleted", async () => {
    const t = setup()
    await t.lease.lease("a")
    t.kernel.live.clear()
    t.clock.now += IDLE_MS
    await t.lease.reap()
    expect(t.store.lease()).toBeUndefined()
  })

  test("a failed delete keeps the row, so the retry has something to delete", async () => {
    const t = setup({ deleteError: new KernelError("failed", "boom") })
    await t.lease.lease("a")
    t.clock.now += IDLE_MS
    await expect(t.lease.reap()).rejects.toThrow("boom")
    expect(t.store.lease()).toBeDefined()
  })

  test("takeover and watching keep it", async () => {
    const t = setup()
    await t.lease.lease("a")
    t.lease.setTakeover(true)
    t.clock.now += IDLE_MS * 20
    await t.lease.reap()
    expect(t.store.lease()).toBeDefined()
    t.lease.setTakeover(false)
    t.lease.watchUntil(t.clock.now + 10_000)
    await t.lease.reap()
    expect(t.store.lease()).toBeDefined()
  })

  test("a browser touched after the idle window is kept, not replaced", async () => {
    const t = setup()
    await t.lease.lease("a")
    t.clock.now += IDLE_MS + 1
    t.lease.touch("a")
    const next = await t.lease.lease("a")
    expect(next.cdpUrl).toBe("wss://cdp/s1")
    expect(next.restarted).toBe(false)
    expect(t.kernel.maxLive()).toBe(1)
  })
})

describe("Kernel failures", () => {
  test("a 429 with a short Retry-After waits once and retries", async () => {
    const t = setup({ createErrors: [new KernelError("rate_limited", "busy", 2)] })
    expect((await t.lease.lease("a")).mode).toBe("headless")
    expect(t.sleeps).toEqual([2_000])
  })

  test("a 429 with a long Retry-After is busy at once", async () => {
    const t = setup({ createErrors: [new KernelError("rate_limited", "busy", 30)] })
    await expect(t.lease.lease("a")).rejects.toMatchObject({ kind: "rate_limited", message: "Kernel is busy. Try again in 30 s" })
    expect(t.sleeps).toEqual([])
    expect(t.store.lease()).toBeUndefined()
  })

  test("a second 429 is not retried again", async () => {
    const t = setup({ createErrors: [new KernelError("rate_limited", "busy", 1), new KernelError("rate_limited", "busy", 1)] })
    await expect(t.lease.lease("a")).rejects.toMatchObject({ kind: "rate_limited" })
    expect(t.kernel.calls.filter((c) => c.startsWith("create"))).toHaveLength(2)
  })

  test("a 529 retries once", async () => {
    const t = setup({ createErrors: [new KernelError("capacity", "full")] })
    expect((await t.lease.lease("a")).cdpUrl).toBe("wss://cdp/s1")
    const failing = setup({ createErrors: [new KernelError("capacity", "full"), new KernelError("capacity", "full")] })
    await expect(failing.lease.lease("a")).rejects.toMatchObject({ kind: "capacity" })
  })

  test("a 401 marks the key broken", async () => {
    const t = setup({ createErrors: [new KernelError("unauthorized", "no")] })
    await expect(t.lease.lease("a")).rejects.toMatchObject({ kind: "unauthorized" })
    expect(t.state.broken).toBe(true)
  })

  test("a failed lease does not wedge the queue", async () => {
    const t = setup({ createErrors: [new KernelError("failed", "boom")] })
    await expect(t.lease.lease("a")).rejects.toThrow("boom")
    expect((await t.lease.lease("a")).mode).toBe("headless")
  })
})

describe("wipe", () => {
  test("deletes the browser, then the profile", async () => {
    const t = setup()
    await t.lease.lease("a")
    await t.lease.wipe()
    expect(t.kernel.calls.slice(-2)).toEqual(["delete s1", "delete profile yuki-test"])
    expect(t.store.lease()).toBeUndefined()
  })
})
