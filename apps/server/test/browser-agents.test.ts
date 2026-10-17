import { describe, expect, test } from "bun:test"
import type { BrowserSession, PageView, Step, Tab } from "@kiko/browser/page/types"
import { BrowserConnection } from "../src/agent/browser/connection"
import { buildAgent, forTalker } from "../src/agent/factory"
import type { BrowserState, LeasePort, LiveLink } from "../src/agent/browser/lease"
import { BROWSER_INFO_EXT, browserExtension, browserInfoExtension, PAUSED, type BrowserToolDeps } from "../src/agent/browser/tools"

const view = (url: string): PageView => ({ key: url, url, title: url, controls: [], text: "", omitted: 0 })

function world() {
  const live = new Map<string, { tab: Tab; steps: Step[]; at: string }>()
  const fronted: string[] = []
  let n = 0
  const make = (url: string) => {
    const id = `t${++n}`
    const steps: Step[] = []
    const rec = { steps, at: url } as { tab: Tab; steps: Step[]; at: string }
    rec.tab = {
      id,
      read: async () => view(rec.at),
      act: async (step: Step) => {
        steps.push(step)
        if (step.op === "goto") rec.at = step.url
        return { ok: true }
      },
      screenshot: async () => new Uint8Array(),
      takeNotes: () => [],
      front: async () => void fronted.push(id),
      close: async () => void live.delete(id),
    }
    live.set(id, rec)
    return rec.tab
  }
  const connect = async (): Promise<BrowserSession> => {
    const mine = new Set<string>()
    return {
      openTab: async (url) => {
        const tab = make(url ?? "about:blank")
        mine.add(tab.id)
        return tab
      },
      tab: (id) => (mine.has(id) ? live.get(id)?.tab : undefined),
      attach: async (id) => {
        if (!live.has(id)) return undefined
        mine.add(id)
        return live.get(id)?.tab
      },
      listTabs: async () => [...mine].filter((id) => live.has(id)).map((id) => ({ id, url: live.get(id)?.at ?? "", title: live.get(id)?.at ?? "" })),
      closed: new Promise<void>(() => {}),
      close: async () => {},
    }
  }
  return { live, connect, make, fronted }
}

function leaseWith(over: Partial<BrowserState> = {}, live?: (mode: "watch" | "control", reason?: string) => Promise<LiveLink>) {
  const lives: [string, string | undefined][] = []
  const touches: Record<string, string>[] = []
  const lease: LeasePort = {
    lease: async () => ({ sessionId: "s1", cdpUrl: "wss://fake", mode: "headful", restarted: false, reopen: [] }),
    touch: async (tabs) => {
      touches.push(tabs)
      return true
    },
    dead: async () => true,
    handBack: async () => true,
    state: async () => ({ connected: true, takeover: false, mode: "headful", tabs: {}, list: [], ...over }),
    paused: async () => over.takeover ?? false,
    live:
      live ??
      (async (mode, reason) => {
        lives.push([mode, reason])
        return { ok: true, url: "https://live.test/abc", posted: reason !== undefined }
      }),
  }
  return { lease, lives, touches }
}

const conn = (w: ReturnType<typeof world>, lease: LeasePort, agentId = "r:a") => new BrowserConnection({ agentId, lease, idle: { arm: async () => {} }, connect: w.connect })

function deps(connection: BrowserConnection, lease: LeasePort): BrowserToolDeps {
  return { connection: () => connection, lease: () => lease, acceptsImages: () => false }
}

async function run(extension: ReturnType<typeof browserExtension>, tool: string, args: unknown, api: object = {}) {
  const t = extension.tools.find((x) => x.name === tool)
  if (!t || !("execute" in t)) throw new Error(`${tool} is not registered`)
  return (t.execute as (a: unknown, api: unknown, ctx: unknown) => Promise<{ output: { text?: string }[]; isError?: boolean }>)(args, api, { abortSignal: undefined })
}

describe("tabs belong to the worker that opened them", () => {
  test("two workers of one agent each keep their own current tab", async () => {
    const w = world()
    const { lease } = leaseWith()
    const c = conn(w, lease)
    const one = await c.currentTab("w1").then(async (tab) => tab ?? c.goto("https://one.test", "w1"))
    const two = await c.goto("https://two.test", "w2")
    expect(one.id).not.toBe(two.id)
    expect((await (await c.currentTab("w1"))?.read())?.url).toBe("https://one.test")
    expect((await (await c.currentTab("w2"))?.read())?.url).toBe("https://two.test")
    // A worker with no tab adopts nothing while another worker may still be on it.
    expect(await c.currentTab("w3")).toBeNull()
  })

  test("a new worker with two free tabs adopts neither, so it opens its own", async () => {
    const w = world()
    const { lease } = leaseWith()
    const c = conn(w, lease)
    await c.goto("https://one.test", "w1")
    await c.goto("https://two.test", "w2")
    expect(await c.currentTab("w3")).toBeNull()
  })

  test("browse with four urls leaves one tab open", async () => {
    const w = world()
    const { lease } = leaseWith()
    const c = conn(w, lease)
    const out = await run(browserExtension(deps(c, lease)), "browse", { urls: ["https://a.test", "https://b.test", "https://c.test", "https://d.test"] })
    expect(out.output[0]?.text?.match(/--- page/g)).toHaveLength(4)
    expect(w.live.size).toBe(1)
  })
})

describe("a run's end releases the agent's tabs", () => {
  test("release closes every tab and drops the agent's claim", async () => {
    const w = world()
    const { lease, touches } = leaseWith()
    const c = conn(w, lease)
    await c.goto("https://a.test")
    await c.goto("https://b.test", "w2")
    expect(w.live.size).toBe(2)
    expect(await c.release()).toBe(2)
    expect(w.live.size).toBe(0)
    expect(touches.at(-1)).toEqual({})
  })

  test("release is safe with no tab, and when the browser is not open", async () => {
    const w = world()
    const { lease, touches } = leaseWith({ mode: null })
    const c = conn(w, lease)
    expect(await c.release()).toBe(0)
    expect(touches).toEqual([])
  })

  test("a human in control keeps the tabs", async () => {
    const w = world()
    const { lease } = leaseWith({ takeover: true })
    const c = conn(w, lease)
    const tab = await c.goto("https://a.test")
    expect(await c.release()).toBe(0)
    expect(w.live.has(tab.id)).toBe(true)
  })
})

describe("the human's control stops the agent", () => {
  test("the page tools do nothing while the human has control", async () => {
    const w = world()
    const { lease } = leaseWith({ takeover: true })
    const c = conn(w, lease)
    const tools = browserExtension(deps(c, lease))
    expect((await run(tools, "browse", { urls: ["https://a.test"] })).output[0]?.text).toBe(PAUSED)
    expect((await run(tools, "browser_act", { steps: [{ op: "click", id: 1 }] })).output[0]?.text).toBe(PAUSED)
    expect((await run(tools, "browser_look", {})).output[0]?.text).toBe(PAUSED)
    expect(w.live.size).toBe(0)
  })
})

describe("the talker can hand the browser over without a worker", () => {
  test("browser_link is the talker's only browser tool", () => {
    const { lease } = leaseWith()
    const w = world()
    const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, browser: deps(conn(w, lease), lease) })
    const talker = forTalker(built.registry.snapshot().installed() as never) as { name: string; tools?: { name: string }[] }[]
    const names = talker.flatMap((e) => (e.tools ?? []).map((t) => t.name))
    expect(names).toContain("browser_link")
    expect(names).not.toContain("browse")
    expect(names).not.toContain("browser_act")
    expect(names).not.toContain("browser_look")
    expect(talker.map((e) => e.name)).toContain(BROWSER_INFO_EXT)
  })

  test("a watch link comes back to post, and a control link pauses the browser", async () => {
    const { lease, lives } = leaseWith()
    const info = browserInfoExtension(deps(conn(world(), lease), lease))
    const watch = await run(info, "browser_link", { mode: "watch" })
    expect(watch.output[0]?.text).toContain("https://live.test/abc")
    expect(watch.output[0]?.text).toContain("markdown link")
    const control = await run(info, "browser_link", { mode: "control", reason: "please sign in to github.com" })
    expect(control.output[0]?.text).toContain("posted the Take control card")
    expect(control.output[0]?.text).not.toContain("https://live.test")
    expect(lives).toEqual([["watch", undefined], ["control", "please sign in to github.com"]])
  })

  test("a control link brings the asking worker's tab to the front, so the human lands on it", async () => {
    const w = world()
    const { lease } = leaseWith()
    const c = conn(w, lease)
    await c.goto("https://other.test", "w1")
    const mail = await c.goto("https://mail.test", "w2")
    await run(browserInfoExtension(deps(c, lease)), "browser_link", { mode: "control", reason: "please sign in" }, { conversationId: "w2" })
    expect(w.fronted).toEqual([mail.id])
  })
})
