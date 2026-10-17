import { describe, expect, test } from "bun:test"
import { BROWSER } from "@kiko/browser/config"
import type { BrowserSession, PageView, Step, Tab } from "@kiko/browser/page/types"
import { BrowserConnection, Busy, CLAIM_MS, IDLE_CLOSE_MS, RESTARTED } from "../src/agent/browser/connection"
import type { BrowserState, Lease, LeasePort } from "../src/agent/browser/lease"

/** `delay` holds an open for that many ms, so a test can open other tabs while it is in flight. */
function fakeBrowser(delay: (url: string) => number = () => 0) {
  const opened: string[] = []
  const live = new Map<string, { tab: Tab; url: () => string }>()
  let n = 0
  const sessions: { kill: () => void }[] = []
  const connect = async (_cdpUrl: string): Promise<BrowserSession> => {
    const adopted = new Set<string>()
    let close!: () => void
    const closed = new Promise<void>((r) => {
      close = r
    })
    sessions.push({ kill: close })
    const tabOf = (url: string): Tab => {
      let at = url
      opened.push(url)
      const id = `t${++n}`
      const notes: string[] = []
      const tab: Tab = {
        id,
        read: async (): Promise<PageView> => ({ key: at, url: at, title: at, controls: [], text: "", omitted: 0 }),
        act: async (step: Step) => {
          if (step.op === "goto") at = step.url
          return { ok: true }
        },
        screenshot: async () => new Uint8Array(),
        takeNotes: () => notes.splice(0, notes.length),
        front: async () => {},
        close: async () => {
          live.delete(id)
        },
      }
      live.set(id, { tab, url: () => at })
      adopted.add(id)
      return tab
    }
    return {
      openTab: async (url) => {
        const ms = delay(url ?? "about:blank")
        if (ms) await new Promise((r) => setTimeout(r, ms))
        return tabOf(url ?? "about:blank")
      },
      tab: (id) => (adopted.has(id) ? live.get(id)?.tab : undefined),
      attach: async (id) => {
        if (!live.has(id)) return undefined
        adopted.add(id)
        return live.get(id)?.tab
      },
      listTabs: async () => [...live].filter(([id]) => adopted.has(id)).map(([id, t]) => ({ id, url: t.url(), title: t.url() })),
      closed,
      close: async () => close(),
    }
  }
  return { opened, live, connect, killLast: () => sessions.at(-1)?.kill() }
}

function fakeLease(state: Partial<BrowserState> = {}) {
  const calls: string[] = []
  let restartNext = false
  let session = 1
  const lease: LeasePort = {
    lease: async (): Promise<Lease> => {
      calls.push("lease")
      const restarted = restartNext
      restartNext = false
      if (restarted) session++
      return { sessionId: `s${session}`, cdpUrl: "wss://fake", mode: "headful", restarted, reopen: [] }
    },
    touch: async () => true,
    dead: async () => {
      calls.push("dead")
      restartNext = true
      return true
    },
    handBack: async () => true,
    state: async () => ({ connected: true, takeover: false, tabs: {}, list: [], ...state }),
    paused: async () => false,
    live: async () => ({ ok: true, url: "https://live.test/abc", posted: false }),
  }
  return { lease, calls }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("browser connection", () => {
  test("after the browser dies, the next call reports it dead, leases again, and reopens the agent's own tab", async () => {
    const browser = fakeBrowser()
    const { lease, calls } = fakeLease()
    const conn = new BrowserConnection({ agentId: "r:a", lease, idle: { arm: async () => {} }, connect: browser.connect })
    await conn.use(async () => (await conn.goto("https://news.ycombinator.com")).read())
    const tab = await conn.currentTab()
    await tab?.act({ op: "goto", url: "https://news.ycombinator.com/newest" })
    await tab?.read()

    browser.killLast()
    await tick()

    const again = await conn.use(async () => (await conn.currentTab())?.read())
    expect(again?.url).toBe("https://news.ycombinator.com/newest")
    expect(calls).toEqual(["lease", "dead", "lease"])
    expect(browser.opened.at(-1)).toBe("https://news.ycombinator.com/newest")
    expect(conn.takeNote()).toBe(RESTARTED)
  })

  test("an idle close keeps the tab: the next call attaches to the same page instead of loading it again", async () => {
    const browser = fakeBrowser()
    const { lease, calls } = fakeLease()
    const armed: number[] = []
    const conn = new BrowserConnection({ agentId: "r:a", lease, idle: { arm: async (at) => void armed.push(at) }, connect: browser.connect, now: () => 1_000 })
    const tab = await conn.use(() => conn.goto("https://mail.test/compose"))
    expect(armed).toEqual([1_000 + IDLE_CLOSE_MS])
    expect(await conn.idle()).toBe("closed")
    expect(browser.live.has(tab.id)).toBe(true)
    await tick()
    const again = await conn.use(async () => conn.currentTab())
    expect(again?.id).toBe(tab.id)
    expect(browser.opened).toEqual(["https://mail.test/compose"])
    expect(calls).toEqual(["lease", "lease"])
    expect(conn.takeNote()).toBeUndefined()
  })

  test("an agent object that slept finds its tab through the lease, and a new worker carries on in it", async () => {
    const browser = fakeBrowser()
    const first = fakeLease()
    const before = new BrowserConnection({ agentId: "r:a", lease: first.lease, idle: { arm: async () => {} }, connect: browser.connect })
    const tab = await before.use(() => before.goto("https://mail.test/compose", "w1"), "w1")
    await before.idle()
    const { lease } = fakeLease({ list: [{ id: tab.id, agent: "r:a", url: "https://mail.test/compose" }] })
    const after = new BrowserConnection({ agentId: "r:a", lease, idle: { arm: async () => {} }, connect: browser.connect })
    const current = await after.use(() => after.currentTab("w2"), "w2")
    expect(current?.id).toBe(tab.id)
    expect(browser.opened).toHaveLength(1)
  })

  test("a worker's tab is its own while it is working, and free for another worker after it stopped", async () => {
    const browser = fakeBrowser()
    const { lease } = fakeLease()
    let now = 0
    const conn = new BrowserConnection({ agentId: "r:a", lease, idle: { arm: async () => {} }, connect: browser.connect, now: () => now })
    const tab = await conn.use(() => conn.goto("https://mail.test", "w1"), "w1")
    expect(await conn.use(() => conn.currentTab("w2"), "w2")).toBeNull()
    now += CLAIM_MS
    expect((await conn.use(() => conn.currentTab("w2"), "w2"))?.id).toBe(tab.id)
  })

  test("a full browser closes the tabs of workers that stopped before it refuses", async () => {
    const browser = fakeBrowser()
    const { lease } = fakeLease()
    let now = 0
    const conn = new BrowserConnection({ agentId: "r:a", lease, idle: { arm: async () => {} }, connect: browser.connect, now: () => now })
    const old = await conn.use(() => conn.goto("https://old.test", "w1"), "w1")
    now += CLAIM_MS
    for (let i = 0; i < BROWSER.tabsPerBrowser - 1; i++) await conn.borrow([`https://${i}.test`])
    await conn.use(() => conn.goto("https://new.test", "w2"), "w2")
    expect(browser.live.has(old.id)).toBe(false)
    expect(browser.live.size).toBe(BROWSER.tabsPerBrowser)
  })

  test("parallel borrows cannot both pass the tab cap", async () => {
    const browser = fakeBrowser()
    const { lease } = fakeLease()
    const conn = new BrowserConnection({ agentId: "r:a", lease, idle: { arm: async () => {} }, connect: browser.connect })
    const five = (tag: string) => ["a", "b", "c", "d", "e"].map((u) => `https://${u}.${tag}.test`)
    const results = await Promise.allSettled([conn.borrow(five("x")), conn.borrow(five("y"))])
    const [won, lost] = results
    expect(won?.status).toBe("fulfilled")
    expect(lost?.status === "rejected" && lost.reason).toBeInstanceOf(Busy)
    expect(browser.opened).toHaveLength(5)
    if (won?.status === "fulfilled") await won.value.done()
    const again = await conn.borrow(Array.from({ length: 8 }, (_, i) => `https://${i}.z.test`))
    expect(again.tabs).toHaveLength(8)
    await again.done()
  })

  test("a ninth tab is refused at once, naming who holds the others", async () => {
    const browser = fakeBrowser()
    const { lease } = fakeLease({ tabs: { "r:scout": 5, "r:writer": 3 } })
    const conn = new BrowserConnection({ agentId: "r:a", lease, idle: { arm: async () => {} }, connect: browser.connect })
    const err = await conn.use(() => conn.goto("https://example.com")).catch((e) => e)
    expect(err).toBeInstanceOf(Busy)
    expect(err.message).toContain("scout has 5")
    expect(err.message).toContain("writer has 3")
  })

  test("a run's end closes every tab it held and drops the claim", async () => {
    const browser = fakeBrowser()
    const states: Record<string, string>[] = []
    const base = fakeLease()
    const lease: LeasePort = {
      ...base.lease,
      touch: async (tabs) => {
        states.push(tabs)
        return true
      },
    }
    const conn = new BrowserConnection({ agentId: "r:a", lease, idle: { arm: async () => {} }, connect: browser.connect })
    await conn.goto("https://a.test")
    await conn.goto("https://b.test", "w2")
    expect(browser.live.size).toBe(2)
    expect(await conn.release()).toBe(2)
    expect(browser.live.size).toBe(0)
    expect(states.at(-1)).toEqual({})
  })
})
