import { describe, expect, test } from "bun:test"
import type { BrowserSession, PageView, Step, Tab } from "@yuki/browser/page/types"
import { BrowserConnection, Busy, IDLE_CLOSE_MS, RESTARTED } from "../src/agent/browser/connection"
import type { BrowserState, Lease, LeasePort } from "../src/agent/browser/lease"

function fakeBrowser() {
  const opened: string[] = []
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
      return {
        id,
        read: async (): Promise<PageView> => ({ key: at, url: at, title: at, controls: [], text: "", omitted: 0 }),
        act: async (step: Step) => {
          if (step.op === "goto") at = step.url
          return { ok: true }
        },
        screenshot: async () => new Uint8Array(),
        close: async () => {},
      }
    }
    return {
      openTab: async (url) => tabOf(url ?? "about:blank"),
      tab: () => undefined,
      onPopup: () => {},
      closed,
      close: async () => close(),
    }
  }
  return { opened, connect, killLast: () => sessions.at(-1)?.kill() }
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
    expect(conn.isOpen()).toBe(false)

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
