import { describe, expect, it, vi } from "vitest"
import type { KernelClient } from "./client"
import { KernelLease } from "./lease"
import type { LeaseRow } from "./store"

type Store = ConstructorParameters<typeof KernelLease>[0]["store"]

const row = (over: Partial<LeaseRow> = {}): LeaseRow => ({
  sessionId: "s1",
  mode: "headful",
  createdAt: 0,
  lastUse: 0,
  tabs: {},
  takeover: false,
  watchUntil: 0,
  dead: false,
  ...over,
})

function memoryStore(initial?: LeaseRow) {
  let current = initial
  const patches: Partial<LeaseRow>[] = []
  const store = {
    lease: () => current,
    urls: async () => (current ? { cdpUrl: "wss://cdp.example" } : undefined),
    putLease: async (next: LeaseRow) => {
      current = next
    },
    patchLease: (patch: Partial<LeaseRow>) => {
      patches.push(patch)
      current = current ? { ...current, ...patch } : current
    },
    deleteLease: () => {
      current = undefined
    },
    profileReady: () => true,
    setProfileReady: () => {},
    setBroken: () => {},
  } as unknown as Store
  return { store, patches, current: () => current }
}

function client(over: Partial<KernelClient> = {}): KernelClient {
  return {
    createBrowser: async () => ({ sessionId: "new", cdpUrl: "wss://new.example" }),
    deleteBrowser: async () => {},
    listActive: async () => [],
    alive: async () => true,
    createProfile: async () => {},
    ...over,
  }
}

const wake = () => ({ set: vi.fn(async () => {}), clear: vi.fn(async () => {}) })

describe("kernel lease", () => {
  it("runs the liveness check outside the serial queue", async () => {
    const mem = memoryStore(row())
    let release!: (alive: boolean) => void
    const alive = new Promise<boolean>((resolve) => {
      release = resolve
    })
    const lease = new KernelLease({
      store: mem.store,
      client: async () => client({ alive: () => alive }),
      profile: async () => "profile",
      wake: wake(),
      now: () => 10,
    })

    const checking = lease.dead("s1")
    const info = await lease.lease("agent")
    expect(info.sessionId).toBe("s1")

    release(true)
    await expect(checking).resolves.toBe(false)
  })

  it("does not mark a session dead once a newer lease replaced it", async () => {
    const mem = memoryStore(row())
    let release!: (alive: boolean) => void
    const alive = new Promise<boolean>((resolve) => {
      release = resolve
    })
    const lease = new KernelLease({
      store: mem.store,
      client: async () => client({ alive: () => alive }),
      profile: async () => "profile",
      wake: wake(),
      now: () => 10,
    })

    const checking = lease.dead("s1")
    await mem.store.putLease(row({ sessionId: "s2" }), { cdpUrl: "wss://cdp.example" })
    release(false)

    await expect(checking).resolves.toBe(false)
    expect(mem.current()?.dead).toBe(false)
  })

  it("marks the session dead when Kernel says it is gone", async () => {
    const mem = memoryStore(row())
    const lease = new KernelLease({
      store: mem.store,
      client: async () => client({ alive: async () => false }),
      profile: async () => "profile",
      wake: wake(),
      now: () => 10,
    })

    await expect(lease.dead("s1")).resolves.toBe(true)
    expect(mem.current()?.dead).toBe(true)
  })

  it("deletes active browsers that no lease references", async () => {
    const mem = memoryStore()
    const deleted: string[] = []
    const alarm = wake()
    const lease = new KernelLease({
      store: mem.store,
      client: async () =>
        client({
          listActive: async () => ["orphan"],
          deleteBrowser: async (sessionId) => {
            deleted.push(sessionId)
          },
        }),
      profile: async () => "profile",
      wake: alarm,
      now: () => 5,
    })

    await lease.reap()

    expect(deleted).toEqual(["orphan"])
    expect(alarm.clear).toHaveBeenCalled()
  })

  it("keeps the browser the lease references", async () => {
    const mem = memoryStore(row({ lastUse: 5 }))
    const deleted: string[] = []
    const lease = new KernelLease({
      store: mem.store,
      client: async () =>
        client({
          listActive: async () => ["s1", "orphan"],
          deleteBrowser: async (sessionId) => {
            deleted.push(sessionId)
          },
        }),
      profile: async () => "profile",
      wake: wake(),
      now: () => 5,
    })

    await lease.reap()

    expect(deleted).toEqual(["orphan"])
  })
})
