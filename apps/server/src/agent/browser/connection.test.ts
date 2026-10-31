import { describe, expect, it } from "vitest"
import type { BrowserSession, PageView, Tab } from "@kiko/browser/page/types"
import type { BrowserCheck } from "../../user/kernel-wiring"
import { BrowserConnection, type IdleTimer } from "./connection"
import type { Lease, LeasePort } from "./lease"

const PAGE: PageView = { key: "pages", url: "https://one.example", title: "one", controls: [], text: "", omitted: 0 }

function fakeTab(id: string, url: string): Tab {
  return {
    id,
    read: async () => ({ ...PAGE, url }),
    act: async () => ({ ok: true }),
    screenshot: async () => new Uint8Array(),
    takeNotes: () => [],
    front: async () => {},
    close: async () => {},
  }
}

function fakeSession(tabs: Map<string, Tab>): BrowserSession {
  return {
    openTab: async (url) => {
      const tab = fakeTab(`t${tabs.size + 1}`, url ?? "about:blank")
      tabs.set(tab.id, tab)
      return tab
    },
    tab: (id) => tabs.get(id),
    attach: async (id) => tabs.get(id),
    listTabs: async () => [...tabs.values()].map((tab) => ({ id: tab.id, url: "", title: "" })),
    closed: new Promise<void>(() => {}),
    close: async () => {},
  }
}

const CHECK: BrowserCheck = { connected: true, takeover: false, mode: "headful", tabs: {}, list: [] }

function setup() {
  let now = 0
  const touches: Record<string, string>[] = []
  const arms: number[] = []
  const lease: LeasePort = {
    lease: async (): Promise<Lease> => ({
      sessionId: "s1",
      cdpUrl: "wss://cdp.example",
      mode: "headful",
      restarted: false,
      reopen: [],
    }),
    touch: async (tabs) => {
      touches.push(tabs)
      return true
    },
    dead: async () => false,
    state: async () => CHECK,
    paused: async () => false,
    live: async () => ({ ok: true, url: "https://live.example", posted: false }),
    handBack: async () => false,
  }
  const idle: IdleTimer = {
    arm: async (at) => {
      arms.push(at)
    },
  }
  const tabs = new Map<string, Tab>()
  const connection = new BrowserConnection({
    agentId: "room:kiko",
    lease,
    idle,
    connect: async () => fakeSession(tabs),
    now: () => now,
  })
  return {
    connection,
    touches,
    arms,
    at: (ms: number) => {
      now = ms
    },
  }
}

describe("browser connection", () => {
  it("persists the lease and arms the idle timer only when a call needs it", async () => {
    const { connection, touches, arms, at } = setup()
    await connection.goto("https://one.example")

    await connection.use(async () => undefined)
    expect(touches).toEqual([{ t1: "https://one.example" }])
    expect(arms).toHaveLength(1)

    at(1_000)
    await connection.use(async () => undefined)
    at(2_000)
    await connection.use(async () => undefined)
    expect(touches).toHaveLength(1)
    expect(arms).toHaveLength(1)

    at(9_000)
    await connection.use(async () => undefined)
    expect(touches).toHaveLength(1)
    expect(arms).toHaveLength(2)
  })

  it("persists again as soon as the tabs change", async () => {
    const { connection, touches } = setup()
    await connection.goto("https://one.example")
    await connection.use(async () => undefined)

    await connection.goto("https://two.example")
    await connection.use(async () => undefined)

    expect(touches).toEqual([{ t1: "https://one.example" }, { t1: "https://two.example" }])
  })

  it("persists the last use once a minute while the tabs sit still", async () => {
    const { connection, touches, at } = setup()
    await connection.goto("https://one.example")
    await connection.use(async () => undefined)

    at(61_000)
    await connection.use(async () => undefined)

    expect(touches).toHaveLength(2)
  })
})
