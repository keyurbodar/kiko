import { describe, expect, test } from "bun:test"
import type { ModelPort } from "@kiko/browser/decide/ports"
import type { DecideInput } from "@kiko/browser/decide/types"
import type { BrowserSession, PageView, Step, Tab } from "@kiko/browser/page/types"
import { BrowserConnection } from "../src/agent/browser/connection"
import { chooseDecider, pickDecider } from "../src/agent/browser/deciders"
import { forTalker, buildAgent } from "../src/agent/factory"
import type { BrowserState, LeasePort, LiveLink } from "../src/agent/browser/lease"
import { BROWSER_INFO_EXT, browserExtension, browserInfoExtension, PAUSED, type BrowserToolDeps } from "../src/agent/browser/tools"

const view = (url: string): PageView => ({ key: url, url, title: url, controls: [], text: "", omitted: 0 })

function world() {
  const live = new Map<string, { tab: Tab; steps: Step[]; at: string }>()
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
      eval: async () => ({ ok: true, value: "" }),
      extract: async () => "",
      screenshot: async () => new Uint8Array(),
      dialog: () => null,
      answerDialog: async () => true,
      url: async () => rec.at,
      title: async () => rec.at,
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
      tab: (id) => live.get(id)?.tab,
      listTabs: async () => [...mine].filter((id) => live.has(id)).map((id) => ({ id, url: live.get(id)?.at ?? "", title: live.get(id)?.at ?? "" })),
      closed: new Promise<void>(() => {}),
      close: async () => {},
    }
  }
  return { live, connect, make }
}

function leaseWith(over: Partial<BrowserState> = {}, live?: (mode: "watch" | "control", reason?: string) => Promise<LiveLink>) {
  const lives: [string, string | undefined][] = []
  const lease: LeasePort = {
    lease: async () => ({ sessionId: "s1", cdpUrl: "wss://fake", mode: "headless", restarted: false, reopen: [] }),
    touch: async () => true,
    dead: async () => true,
    release: async () => {},
    state: async () => ({ connected: true, takeover: false, mode: "headless", tabs: {}, list: [], ...over }),
    paused: async () => over.takeover ?? false,
    live:
      live ??
      (async (mode, reason) => {
        lives.push([mode, reason])
        return { ok: true, url: "https://live.test/abc", posted: reason !== undefined }
      }),
    putFile: async () => ({ path: "" }),
    getFile: async () => ({ name: "", base64: "", size: 0 }),
    listFiles: async () => [],
    fetchPage: async () => ({ status: 200, headers: {}, body: "", truncated: false }),
  }
  return { lease, lives }
}

const conn = (w: ReturnType<typeof world>, lease: LeasePort, agentId = "r:a") => new BrowserConnection({ agentId, lease, idle: { arm: async () => {} }, connect: w.connect })

function deps(connection: BrowserConnection, lease: LeasePort): BrowserToolDeps {
  return {
    connection: () => connection,
    lease: () => lease,
    decider: async () => {
      throw new Error("unused")
    },
    acceptsImages: () => false,
  }
}

async function run(extension: ReturnType<typeof browserExtension>, tool: string, args: unknown, api: object = {}) {
  const t = extension.tools.find((x) => x.name === tool)
  if (!t || !("execute" in t)) throw new Error(`${tool} is not registered`)
  return (t.execute as (a: unknown, api: unknown, ctx: unknown) => Promise<{ output: { text?: string }[]; isError?: boolean }>)(args, api, { abortSignal: undefined })
}

describe("tabs belong to the agent that opened them", () => {
  test("an agent cannot close or switch to another agent's tab", async () => {
    const w = world()
    const theirs = w.make("https://b.test")
    const { lease } = leaseWith({ list: [{ id: theirs.id, agent: "room:bob", url: "https://b.test" }] })
    const mine = conn(w, lease)
    await mine.goto("https://a.test")
    await expect(mine.closeTab(theirs.id)).rejects.toThrow("belongs to bob")
    expect(w.live.has(theirs.id)).toBe(true)
    await expect(mine.switchTo(theirs.id)).rejects.toThrow("belongs to bob")
  })

  test("a tab whose owner released it (no row in the lease) can be closed", async () => {
    const w = world()
    const { lease } = leaseWith({ list: [] })
    const mine = conn(w, lease)
    const tab = await mine.openTab("https://a.test")
    await mine.closeTab(tab.id)
    expect(w.live.has(tab.id)).toBe(false)
  })

  test("two workers of one agent each keep their own current tab", async () => {
    const w = world()
    const { lease } = leaseWith()
    const c = conn(w, lease)
    const one = await c.goto("https://one.test", "w1")
    const two = await c.goto("https://two.test", "w2")
    expect(one.id).not.toBe(two.id)
    expect((await (await c.currentTab("w1"))?.read())?.url).toBe("https://one.test")
    expect((await (await c.currentTab("w2"))?.read())?.url).toBe("https://two.test")
    await expect(c.switchTo(one.id, "w2")).rejects.toThrow("another of your workers")
    await expect(c.closeTab(one.id, "w2")).rejects.toThrow("another of your workers")
  })

  test("close_all closes this agent's tabs and spares what its other workers are on", async () => {
    const w = world()
    const { lease } = leaseWith()
    const c = conn(w, lease)
    const busy = await c.goto("https://busy.test", "w1")
    await c.goto("https://mine.test", "w2")
    const extra = await c.openTab("https://extra.test")
    const tools = browserExtension(deps(c, lease))
    const out = await run(tools, "browser_tabs", { action: "close_all" }, { conversationId: "w2" })
    expect(out.output[0]?.text).toBe("closed 2 tabs")
    expect([...w.live.keys()]).toEqual([busy.id])
    expect(w.live.has(extra.id)).toBe(false)
  })

  test("idle closes the tabs the agent opened and switched away from, not only the current one", async () => {
    const w = world()
    const { lease } = leaseWith()
    const c = conn(w, lease)
    await c.goto("https://home.test")
    await c.openTab("https://parked.test")
    await c.openTab("https://parked2.test")
    expect(w.live.size).toBe(3)
    expect(await c.idle()).toBe("closed")
    expect(w.live.size).toBe(0)
  })

  test("browser_tabs list shows titles, marks the current tab, and names the other agents' tabs as theirs", async () => {
    const w = world()
    const theirs = w.make("https://b.test/page")
    const { lease } = leaseWith({ list: [{ id: theirs.id, agent: "room:bob", url: "https://b.test/page" }] })
    const c = conn(w, lease)
    await c.goto("https://a.test")
    const out = await run(browserExtension(deps(c, lease)), "browser_tabs", { action: "list" })
    const lines = out.output[0]?.text?.split("\n") ?? []
    expect(lines[0]).toMatch(/^\* t\d+ https:\/\/a\.test https:\/\/a\.test$/)
    expect(lines[1]).toContain("bob https://b.test/page (theirs)")
  })

  test("open switches to the new tab and keeps the old one open", async () => {
    const w = world()
    const { lease } = leaseWith()
    const c = conn(w, lease)
    await c.goto("https://a.test")
    const out = await run(browserExtension(deps(c, lease)), "browser_tabs", { action: "open", url: "https://b.test" })
    expect(out.output[0]?.text).toContain("now your current tab")
    expect((await (await c.currentTab())?.read())?.url).toBe("https://b.test")
    expect(w.live.size).toBe(2)
  })
})

describe("the human's control stops the agent", () => {
  test("browser_act does nothing and says so while the human has control", async () => {
    const w = world()
    const { lease } = leaseWith({ takeover: true })
    const c = conn(w, lease)
    const tab = await c.goto("https://a.test")
    const before = w.live.get(tab.id)?.steps.length
    const out = await run(browserExtension(deps(c, lease)), "browser_act", { steps: [{ op: "click", id: 1 }] })
    expect(out.output[0]?.text).toBe(PAUSED)
    expect(w.live.get(tab.id)?.steps.length).toBe(before)
  })

  test("browse and browser_tabs are refused too", async () => {
    const w = world()
    const { lease } = leaseWith({ takeover: true })
    const tools = browserExtension(deps(conn(w, lease), lease))
    for (const [tool, args] of [["browse", { urls: ["https://a.test"] }], ["browser_tabs", { action: "list" }]] as const) {
      expect((await run(tools, tool, args)).output[0]?.text).toBe(PAUSED)
    }
    expect(w.live.size).toBe(0)
  })
})

describe("the talker can show the browser without a worker", () => {
  test("browser_link and browser_status are talker tools; the page tools are not", () => {
    const { lease } = leaseWith()
    const w = world()
    const built = buildAgent({ role: "", lead: true, model: { provider: "faux", modelId: "faux-1" }, browser: deps(conn(w, lease), lease) })
    const talker = forTalker(built.registry.snapshot().installed() as never) as { name: string; tools?: { name: string }[] }[]
    const names = talker.flatMap((e) => (e.tools ?? []).map((t) => t.name))
    expect(names).toContain("browser_link")
    expect(names).toContain("browser_status")
    expect(names).not.toContain("browse")
    expect(names).not.toContain("browser_act")
    expect(talker.map((e) => e.name)).toContain(BROWSER_INFO_EXT)
  })

  test("browser_link returns the live link to post as a markdown link, and a control link pauses the browser", async () => {
    const { lease, lives } = leaseWith()
    const info = browserInfoExtension(deps(conn(world(), lease), lease))
    const watch = await run(info, "browser_link", { mode: "watch" })
    expect(watch.output[0]?.text).toContain("https://live.test/abc")
    expect(watch.output[0]?.text).toContain("markdown link")
    const control = await run(info, "browser_link", { mode: "control", reason: "please sign in to github.com" })
    expect(control.output[0]?.text).toContain("posted the control link")
    expect(control.output[0]?.text).not.toContain("https://live.test")
    expect(lives).toEqual([["watch", undefined], ["control", "please sign in to github.com"]])
  })

  test("browser_link reports a failure as an error, not a link", async () => {
    const { lease } = leaseWith({}, async () => ({ ok: false, error: "No browser is open" }))
    const out = await run(browserInfoExtension(deps(conn(world(), lease), lease)), "browser_link", { mode: "watch" })
    expect(out).toMatchObject({ isError: true })
    expect(out.output[0]?.text).toBe("No browser is open")
  })

  test("browser_status lists tabs with owners and who has control", async () => {
    const { lease } = leaseWith({ takeover: true, list: [{ id: "T1", agent: "room:bob", url: "https://b.test/x" }] })
    const out = await run(browserInfoExtension(deps(conn(world(), lease), lease)), "browser_status", {})
    expect(out.output[0]?.text).toBe("headless browser. the human has control; browser tools are paused.\nT1 bob https://b.test/x")
  })

  test("browser_status says when no key is connected", async () => {
    const { lease } = leaseWith({ connected: false })
    const out = await run(browserInfoExtension(deps(conn(world(), lease), lease)), "browser_status", {})
    expect(out.output[0]?.text).toContain("has not connected a Kernel key")
  })
})

describe("the browser works without a judge key", () => {
  const input: DecideInput = {
    goal: "open the docs",
    values: {},
    page: view("https://a.test"),
    options: [
      { key: "k1", text: "1 link \"Docs\"", step: { op: "click", id: 1 } },
      { key: "s0", text: "stuck", step: { op: "stuck" } },
    ],
    history: [],
  }
  const model: ModelPort = { complete: async () => "k1" }
  const signal = new AbortController().signal

  test("no judge: the agent's own model decides and passages rank lexically", async () => {
    const picked = await chooseDecider(model, async () => null)
    expect(picked.name).toBe("model")
    expect((await picked.decider.decide(input, signal)).choice.key).toBe("k1")
    const scores = await picked.ranker.rank("docs", ["about docs and more docs", "nothing here"], signal)
    expect(scores[0]).toBeGreaterThan(scores[1] ?? 0)
  })

  test("a lookup that throws is the same as having no judge", async () => {
    const picked = await chooseDecider(model, async () => {
      throw new Error("listProviders failed")
    })
    expect(picked.name).toBe("model")
  })

  test("a judge that errors falls back to the agent's model for the step and to the lexical ranker", async () => {
    const broken = {
      choose: async () => {
        throw new Error("jev failed: error 401")
      },
      noul: async () => {
        throw new Error("jev failed: error 401")
      },
    }
    const picked = pickDecider(model, broken)
    expect((await picked.decider.decide(input, signal)).choice.key).toBe("k1")
    const scores = await picked.ranker.rank("docs", ["about docs and more docs", "nothing here"], signal)
    expect(scores[0]).toBeGreaterThan(scores[1] ?? 0)
  })

  test("a stopped call is not retried on the model", async () => {
    const stop = new AbortController()
    stop.abort()
    const broken = {
      choose: async () => {
        throw new Error("aborted")
      },
    }
    await expect(pickDecider(model, broken).decider.decide(input, stop.signal)).rejects.toThrow("aborted")
  })
})
