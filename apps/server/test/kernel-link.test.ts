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
  }
  const alarms = { setWakeup: async () => {}, clearWakeup: async () => {} }
  const wiring = new KernelWiring({ ctx: { getWebSockets: () => [] }, sql: {}, env: {}, alarms, userId: () => "u", store, clientFor: () => client } as never)
  return { wiring, calls, row: () => row }
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

  test("a dead browser is replaced by a visible one", async () => {
    const t = setup({ dead: true })
    const out = await t.wiring.liveLink("room-a/ada", ROOM, "watch")
    expect(out.ok).toBe(true)
    expect(t.calls).toEqual(["delete old", "create headful"])
  })
})
