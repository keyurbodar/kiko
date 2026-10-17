import { describe, expect, test } from "bun:test"
import type { KernelClient } from "../src/integrations/kernel/client"
import type { LeaseRow, LeaseUrls } from "../src/integrations/kernel/store"
import { KernelWiring } from "../src/user/kernel-wiring"

const ROOM = "01ARZ3NDEKTSV4RRFFQ69G5FAV"

function setup(start?: Partial<LeaseRow>) {
  let row: LeaseRow | undefined = start && { sessionId: "old", mode: "headless", createdAt: 0, lastUse: 0, tabs: {}, dead: false, takeover: false, watchUntil: 0, ...start }
  let urls: LeaseUrls | undefined = row && { cdpUrl: "wss://cdp/old" }
  const calls: string[] = []
  const client = {
    createBrowser: async ({ headless }: { headless: boolean }) => {
      calls.push(`create ${headless ? "headless" : "headful"}`)
      return { sessionId: "new", cdpUrl: "wss://cdp/new", ...(headless ? {} : { liveUrl: "https://live/new?a=1" }) }
    },
    deleteBrowser: async (id: string) => void calls.push(`delete ${id}`),
    createProfile: async () => {},
  } as unknown as KernelClient
  const store = {
    connected: () => true,
    key: async () => "k",
    generation: 0,
    lease: () => row && { ...row },
    urls: async () => urls,
    putLease: async (r: LeaseRow, u: LeaseUrls) => void ((row = r), (urls = u)),
    patchLease: (p: Partial<LeaseRow>) => void (row &&= { ...row, ...p }),
    deleteLease: () => void ((row = undefined), (urls = undefined)),
    profileReady: () => true,
    setProfileReady: () => {},
    setBroken: () => {},
    control: () => control && structuredClone(control),
    setControl: (c: typeof control) => void (control = c),
  }
  let control: { at: number; waiters: { agentId: string; roomId: string }[] } | undefined
  const wakes: { room: string; id: string; to: string; body: string }[] = []
  const pending: Promise<unknown>[] = []
  const ROOMS = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      wake: async (w: { id: string; to: string; body: string }) => void wakes.push({ room: name, id: w.id, to: w.to, body: w.body }),
      browserAsk: async () => true,
    }),
  }
  const alarms = { setWakeup: async () => {}, clearWakeup: async () => {} }
  const ctx = { getWebSockets: () => [], waitUntil: (p: Promise<unknown>) => void pending.push(p) }
  const wiring = new KernelWiring({ ctx, sql: { exec: () => ({ toArray: () => [] }) }, env: { ROOM: ROOMS }, alarms, userId: () => "u", store, clientFor: () => client } as never)
  return { wiring, calls, row: () => row, wakes, settled: () => Promise.all(pending), setRow: (p: Partial<LeaseRow>) => void (row &&= { ...row, ...p }) }
}

describe("live view link", () => {
  test("a watch link with no browser open opens a visible one and returns its read-only link", async () => {
    const t = setup()
    const out = await t.wiring.liveLink("room-a/ada", ROOM, "watch")
    expect(t.calls).toEqual(["create headful"])
    expect(out).toMatchObject({ ok: true, posted: false })
    expect(out.ok && new URL(out.url).searchParams.get("readOnly")).toBe("true")
    expect(t.row()?.watchUntil).toBeGreaterThan(Date.now())
  })

  test("a control link with no browser open opens one and holds it for the human", async () => {
    const t = setup()
    const out = await t.wiring.liveLink("room-a/ada", ROOM, "control")
    expect(out.ok).toBe(true)
    expect(t.row()?.takeover).toBe(true)
  })

  test("Release control wakes the agent that asked and every agent it paused, each once", async () => {
    const t = setup()
    await t.wiring.liveLink(`${ROOM}:ada`, ROOM, "control", "please sign in")
    expect(t.wiring.paused(`${ROOM}:bob`, ROOM)).toBe(true)
    expect(t.wiring.paused(`${ROOM}:bob`, ROOM)).toBe(true)
    expect(t.wiring.handBack()).toBe(true)
    expect(t.wiring.handBack()).toBe(false)
    await t.settled()
    expect(t.row()?.takeover).toBe(false)
    expect(t.wakes.map((w) => w.to).sort()).toEqual(["ada", "bob"])
    expect(t.wakes[0]?.id).toMatch(/^browser-back:\d+:ada$/)
    expect(t.wakes[0]?.body).toContain("released control")
  })

  test("an agent that releases on the human's word wakes the others and not itself", async () => {
    const t = setup()
    await t.wiring.liveLink(`${ROOM}:ada`, ROOM, "control")
    t.wiring.paused(`${ROOM}:bob`, ROOM)
    expect(t.wiring.handBack(`${ROOM}:ada`)).toBe(true)
    await t.settled()
    expect(t.wakes.map((w) => w.to)).toEqual(["bob"])
  })

  test("control that times out wakes the waiting agents and says so", async () => {
    const t = setup()
    await t.wiring.liveLink(`${ROOM}:ada`, ROOM, "control")
    t.setRow({ watchUntil: Date.now() - 1 })
    await t.wiring.reap()
    await t.settled()
    expect(t.wakes.map((w) => w.to)).toEqual(["ada"])
    expect(t.wakes[0]?.body).toContain("timed out")
  })

  test("an agent that asks while the agents have control is not woken later", async () => {
    const t = setup()
    await t.wiring.liveLink(`${ROOM}:ada`, ROOM, "watch")
    expect(t.wiring.paused(`${ROOM}:bob`, ROOM)).toBe(false)
    t.wiring.handBack()
    await t.settled()
    expect(t.wakes).toEqual([])
  })

  test("a dead browser is replaced by a visible one", async () => {
    const t = setup({ dead: true })
    const out = await t.wiring.liveLink("room-a/ada", ROOM, "watch")
    expect(out.ok).toBe(true)
    expect(t.calls).toEqual(["delete old", "create headful"])
  })

  test("a link to the browser a worker is using keeps it: no new browser, no closed pages", async () => {
    const t = setup()
    const leased = await t.wiring.lease("room-a/ada:w1")
    t.wiring.touch("room-a/ada:w1", { t1: "https://www.youtube.com/shorts" })
    const out = await t.wiring.liveLink("room-a/ada", ROOM, "watch")
    expect(out.ok).toBe(true)
    expect(t.calls).toEqual(["create headful"])
    expect(t.row()?.sessionId).toBe(leased.sessionId)
    expect(t.row()?.tabs["room-a/ada:w1"]).toEqual({ t1: "https://www.youtube.com/shorts" })
  })
})
