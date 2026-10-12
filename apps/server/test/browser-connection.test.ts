import { describe, expect, test } from "bun:test"
import { BROWSER } from "@yuki/browser/config"
import type { BrowserSession, PageView, Step, Tab } from "@yuki/browser/page/types"
import { BrowserConnection, Busy, IDLE_CLOSE_MS, RESTARTED } from "../src/agent/browser/connection"
import type { BrowserState, Lease, LeasePort } from "../src/agent/browser/lease"

/** `delay` holds an open for that many ms, so a test can switch tabs while it is in flight. */
function fakeBrowser(delay: (url: string) => number = () => 0) {
  const opened: string[] = []
  const live = new Map<string, { tab: Tab; url: () => string }>()
  let n = 0
  const sessions: { kill: () => void }[] = []
  const connect = async (_cdpUrl: string): Promise<BrowserSession> => {
    let close!: () => void
    const closed = new Promise<void>((r) => {
      close = r
    })
    sessions.push({ kill: close })
    const tabOf = (url: string): Tab => {
      let at = url
      opened.push(url)
      const id = `t${++n}`
      const tab: Tab = {
        id,
        read: async (): Promise<PageView> => ({ key: at, url: at, title: at, controls: [], text: "", omitted: 0 }),
        act: async (step: Step) => {
          if (step.op === "goto") at = step.url
          return { ok: true }
        },
        screenshot: async () => new Uint8Array(),
        close: async () => {
          live.delete(id)
        },
      }
      live.set(id, { tab, url: () => at })
      return tab
    }
    return {
      openTab: async (url) => {
        const ms = delay(url ?? "about:blank")
        if (ms) await new Promise((r) => setTimeout(r, ms))
        return tabOf(url ?? "about:blank")
      },
      tab: (id) => live.get(id)?.tab,
      listTabs: async () => [...live].map(([id, t]) => ({ id, url: t.url(), title: t.url() })),
      closed,
      close: async () => {
        live.clear()
        close()
      },
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
      return { sessionId: `s${session}`, cdpUrl: "wss://fake", mode: "headless", restarted, reopen: [] }
    },
    touch: async () => true,
    dead: async () => {
      calls.push("dead")
      restartNext = true
      return true
    },
    release: async () => {
      calls.push("release")
    },
    state: async () => ({ connected: true, takeover: false, tabs: {}, ...state }),
    paused: async () => false,
    share: async () => "",
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

  test("an idle close releases the lease without calling the browser dead, and arms 15 s after the last call", async () => {
    const browser = fakeBrowser()
    const { lease, calls } = fakeLease()
    const armed: number[] = []
    const conn = new BrowserConnection({ agentId: "r:a", lease, idle: { arm: async (at) => void armed.push(at) }, connect: browser.connect, now: () => 1_000 })
    await conn.use(() => conn.goto("https://example.com"))
    expect(armed).toEqual([1_000 + IDLE_CLOSE_MS])
    expect(await conn.idle()).toBe("closed")
    await tick()
    await conn.use(async () => (await conn.currentTab())?.read())
    expect(calls).toEqual(["lease", "release", "lease"])
    expect(conn.takeNote()).toBeUndefined()
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

  test("parallel single tabs admit exactly the cap", async () => {
    const browser = fakeBrowser()
    const { lease } = fakeLease()
    const conn = new BrowserConnection({ agentId: "r:a", lease, idle: { arm: async () => {} }, connect: browser.connect })
    const opens = Array.from({ length: 9 }, (_, i) => conn.openTab(`https://${i}.test`))
    const results = await Promise.allSettled(opens)
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(8)
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof Busy)).toHaveLength(1)
    expect(browser.opened).toHaveLength(8)
  })

  test("a tab opened while switchTo runs still counts against the cap, and idle closes it", async () => {
    const browser = fakeBrowser((url) => (url === "https://slow.test" ? 50 : 0))
    const { lease } = fakeLease()
    const conn = new BrowserConnection({ agentId: "r:a", lease, idle: { arm: async () => {} }, connect: browser.connect })
    const home = await conn.openTab("https://home.test")
    const opening = conn.goto("https://slow.test")
    await new Promise((r) => setTimeout(r, 10))
    await conn.switchTo(home.id)
    const slow = await opening
    const admitted = await Promise.allSettled(Array.from({ length: BROWSER.tabsPerBrowser }, (_, i) => conn.openTab(`https://${i}.test`)))
    expect(admitted.filter((r) => r.status === "fulfilled")).toHaveLength(BROWSER.tabsPerBrowser - 2)
    expect(await conn.idle()).toBe("closed")
    expect(browser.live.has(slow.id)).toBe(false)
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
})
