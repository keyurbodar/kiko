import { describe, expect, test } from "bun:test"
import { BROWSER } from "../src/config"
import { jevDecider } from "../src/decide/jev"
import { modelDecider, parseReply } from "../src/decide/model"
import type { JevPort } from "../src/decide/ports"
import { runTask, runTasks } from "../src/worker/run"
import { fakeTab, live, page, scripted, type Site } from "./site"

const deps = (decider: ReturnType<typeof scripted>, paused = () => false) => ({ decider, paused, signal: live() })

// home -> (click 1) list -> (click 2) item
const site: Site = {
  pages: {
    home: page("home", [{ label: "list" }, { label: "other" }]),
    list: page("list", [{ label: "back" }, { label: "item" }]),
    item: page("item", [{ label: "end" }]),
  },
  go: { "home:click:1": "list", "list:click:2": "item" },
}

describe("runTask", () => {
  test("goes to the task's url first, unless the tab was opened there", async () => {
    for (const opened of [false, true]) {
      const { tab, acted } = fakeTab(site, "home")
      await runTask(tab, { goal: "x", url: "https://site.test/home" }, { ...deps(scripted(() => ({ key: "done" }))), opened })
      expect(acted.some((s) => s.op === "goto")).toBe(!opened)
    }
  })

  test("follows choices to done and logs short actions", async () => {
    const d = scripted((n) => ({ key: ["k1", "k2", "done"][n] }))
    const { tab } = fakeTab(site, "home")
    const r = await runTask(tab, { goal: "open the item" }, deps(d))
    expect(r.stop).toBe("done")
    expect(r.url).toBe("https://site.test/item")
    expect(r.actions).toEqual(['1 click link "list" (top nav)', '2 click link "item" (top nav)'])
  })

  test("stops unsure below the floor with the top 3 option texts, without acting", async () => {
    const d = scripted(() => ({ key: "k1", confidence: 0.4, runnersUp: ["k2", "sd"] }))
    const { tab, acted } = fakeTab(site, "home")
    const r = await runTask(tab, { goal: "x" }, deps(d))
    expect(r.stop).toBe("unsure")
    expect(r.options).toHaveLength(3)
    expect(r.options?.[0]).toContain('"list"')
    expect(acted).toHaveLength(0)
  })

  test("confidence at or above the floor, or null, acts", async () => {
    const d = scripted((n) => ({ key: n === 0 ? "k1" : "done", confidence: n === 0 ? BROWSER.confidenceFloor : 0.99 }))
    const r = await runTask(fakeTab(site, "home").tab, { goal: "x" }, deps(d))
    expect(r.stop).toBe("done")
  })

  test("stops stuck after 3 actions leave the page unchanged", async () => {
    const d = scripted(() => ({ key: "k2" }))
    const { tab, acted } = fakeTab(site, "home")
    const r = await runTask(tab, { goal: "x" }, deps(d))
    expect(r.stop).toBe("stuck")
    expect(acted).toHaveLength(BROWSER.unchangedLimit)
  })

  test("a changed page resets the unchanged count", async () => {
    const d = scripted((n) => ({ key: ["k2", "k2", "k1", "k1", "done"][n] }))
    const { tab } = fakeTab(site, "home")
    const r = await runTask(tab, { goal: "x" }, deps(d))
    expect(r.stop).toBe("done")
  })

  test("stuck choice stops stuck", async () => {
    const r = await runTask(fakeTab(site, "home").tab, { goal: "x" }, deps(scripted(() => ({ key: "stuck" }))))
    expect(r.stop).toBe("stuck")
  })

  test("needs_value when the chosen field has no value to type", async () => {
    const s: Site = { pages: { f: page("f", [{ role: "textbox", label: "Email" }]) }, go: {} }
    const d = scripted(() => ({ key: "t1" }))
    const { tab, acted } = fakeTab(s, "f")
    const r = await runTask(tab, { goal: "sign up" }, deps(d))
    expect(r.stop).toBe("needs_value")
    expect(acted).toHaveLength(0)
  })

  test("types a provided value", async () => {
    const s: Site = { pages: { f: page("f", [{ role: "searchbox", label: "Search" }]), r: page("r") }, go: { "f:type:1": "r" } }
    const d = scripted((n) => ({ key: n === 0 ? "t1v0" : "done" }))
    const { tab, acted } = fakeTab(s, "f")
    const r = await runTask(tab, { goal: "search", values: { query: "kernel" } }, deps(d))
    expect(r.stop).toBe("done")
    expect(acted[0]).toMatchObject({ op: "type", id: 1, text: "kernel" })
  })

  test("a secret field is never a choice, and stuck on it becomes needs_human", async () => {
    const s: Site = { pages: { l: page("l", [{ role: "textbox", label: "Password", state: "secret" }]) }, go: {} }
    let typeable = true
    const d = scripted((_, input) => {
      typeable = input.options.some((o) => o.step.op === "type")
      return { key: "stuck" }
    })
    const r = await runTask(fakeTab(s, "l").tab, { goal: "log in", values: { pw: "x" } }, deps(d))
    expect(r.stop).toBe("needs_human")
    expect(typeable).toBe(false)
  })

  test("an offscreen login box does not stop a worker that can go on", async () => {
    const s: Site = {
      pages: { a: page("a", [{ label: "results" }, { role: "textbox", label: "Password", state: "secret offscreen" }]), b: page("b", [{ label: "end" }]) },
      go: { "a:click:1": "b" },
    }
    const r = await runTask(fakeTab(s, "a").tab, { goal: "results" }, deps(scripted((n) => ({ key: ["k1", "done"][n] }))))
    expect(r.stop).toBe("done")
  })

  test("needs_human after navigating onto a login wall", async () => {
    const s: Site = {
      pages: { a: page("a", [{ label: "login" }]), l: page("l", [{ role: "textbox", label: "Code", state: "secret" }]) },
      go: { "a:click:1": "l" },
    }
    const r = await runTask(fakeTab(s, "a").tab, { goal: "x" }, deps(scripted((n) => ({ key: ["k1", "stuck"][n] }))))
    expect(r.stop).toBe("needs_human")
  })

  test("paused before acting", async () => {
    const { tab, acted } = fakeTab(site, "home")
    const r = await runTask(tab, { goal: "x" }, deps(scripted(() => ({ key: "k1" })), () => true))
    expect(r.stop).toBe("paused")
    expect(acted).toHaveLength(0)
  })

  test("pausing mid-run stops at the next action", async () => {
    let n = 0
    const { tab, acted } = fakeTab(site, "home")
    const r = await runTask(tab, { goal: "x" }, deps(scripted((i) => ({ key: i === 0 ? "k1" : "k2" })), () => n++ >= 1))
    expect(r.stop).toBe("paused")
    expect(acted).toHaveLength(1)
  })

  test("budget after stepsPerWorker steps", async () => {
    // Two pages that swap forever, so the page changes every time.
    const s: Site = {
      pages: { a: page("a", [{ label: "go" }]), b: page("b", [{ label: "go" }]) },
      go: { "a:click:1": "b", "b:click:1": "a" },
    }
    const d = scripted(() => ({ key: "k1" }))
    const r = await runTask(fakeTab(s, "a").tab, { goal: "x" }, deps(d))
    expect(r.stop).toBe("budget")
    expect(d.calls).toBe(BROWSER.stepsPerWorker)
  })

  test("a dialog stops with dialog, a crash with crashed", async () => {
    const s: Site = { pages: { a: page("a", [{ label: "go" }]) }, go: { "a:click:1": { fail: "dialog" } } }
    expect((await runTask(fakeTab(s, "a").tab, { goal: "x" }, deps(scripted(() => ({ key: "k1" }))))).stop).toBe("dialog")
    const c: Site = { pages: { a: page("a", [{ label: "go" }]) }, go: { "a:click:1": { fail: "crashed" } } }
    expect((await runTask(fakeTab(c, "a").tab, { goal: "x" }, deps(scripted(() => ({ key: "k1" }))))).stop).toBe("crashed")
  })

  test("a stale step re-reads once and decides again", async () => {
    let stale = true
    const { tab } = fakeTab(site, "home")
    const act = tab.act
    tab.act = async (s) => (stale ? ((stale = false), { ok: false, reason: "stale" as const }) : act(s))
    const d = scripted((n) => ({ key: ["k1", "k1", "done"][n] }))
    const r = await runTask(tab, { goal: "x" }, deps(d))
    expect(r.stop).toBe("done")
    expect(d.calls).toBe(3)
    expect(r.actions).toHaveLength(1)
  })

  test("a throwing read is a crash", async () => {
    const { tab } = fakeTab(site, "home")
    tab.read = async () => {
      throw new Error("target closed")
    }
    const r = await runTask(tab, { goal: "x" }, deps(scripted(() => ({ key: "done" }))))
    expect(r).toMatchObject({ stop: "crashed", note: "target closed" })
  })
})

describe("runTasks", () => {
  test("runs tasks at the same time and keeps order", async () => {
    const DELAY = 80
    const mk = () => fakeTab(site, "home")
    const tabs = [mk().tab, mk().tab, mk().tab, mk().tab]
    const d = scripted((_, i) => ({ key: i.page.key === "home" ? "k1" : "done" }), DELAY)
    const t0 = performance.now()
    const rs = await runTasks(tabs, [{ goal: "a" }, { goal: "b" }, { goal: "c" }, { goal: "d" }], deps(d))
    const ms = performance.now() - t0
    expect(rs.map((r) => r.stop)).toEqual(["done", "done", "done", "done"])
    // One task is two decisions. Four in a row would take 8 * DELAY.
    expect(ms).toBeLessThan(DELAY * 2 * 2)
  })

  test("tasks beyond workersPerRun are reported, not dropped", async () => {
    const tabs = Array.from({ length: 6 }, () => fakeTab(site, "home").tab)
    const rs = await runTasks(tabs, Array.from({ length: 6 }, () => ({ goal: "x" })), deps(scripted(() => ({ key: "done" }))))
    expect(rs).toHaveLength(6)
    expect(rs.filter((r) => r.stop === "budget")).toHaveLength(6 - BROWSER.workersPerRun)
  })
})

describe("deciders", () => {
  const p = page("p", [{ label: "list" }, { label: "other" }])
  const input = async () => {
    const { choices } = await import("../src/plan/candidates")
    return { goal: "g", values: { secret: "hunter2" }, page: p, options: choices(p, "g", { secret: "hunter2" }), history: ["a", "b", "c", "d"] }
  }

  test("parseReply finds the first key, unsure, and junk", () => {
    const keys = ["k7", "k70", "done", "stuck"]
    expect(parseReply("k7", keys)).toEqual({ key: "k7", unsure: false })
    expect(parseReply("k7 unsure", keys)).toEqual({ key: "k7", unsure: true })
    expect(parseReply("**K70**.", keys)).toEqual({ key: "k70", unsure: false })
    expect(parseReply("I think the answer is k7, but unsure", keys)).toEqual({ key: "k7", unsure: true })
    expect(parseReply("no idea", keys)).toBeNull()
  })

  test("model decider: null confidence, 0 when unsure, stuck at 0 on junk", async () => {
    const reply = (s: string) => modelDecider({ complete: async () => s })
    const i = await input()
    expect((await reply("k1").decide(i, live())).confidence).toBeNull()
    const u = await reply("k1 unsure").decide(i, live())
    expect([u.choice.key, u.confidence]).toEqual(["k1", 0])
    const j = await reply("???").decide(i, live())
    expect([j.choice.key, j.confidence]).toEqual(["stuck", 0])
  })

  test("model prompt is small and holds names, not values", async () => {
    let seen = ""
    await modelDecider({ complete: async (s, u) => ((seen = s + u), "k1") }).decide(await input(), live())
    expect(seen).toContain("secret")
    expect(seen).not.toContain("hunter2")
    expect(seen).not.toContain('"a"')
    expect(seen.length).toBeLessThan(4800)
  })

  test("jev decider sends names, the last 3 actions, no page text, and orders runners-up", async () => {
    let req: Parameters<JevPort["choose"]>[0] | undefined
    const d = jevDecider({
      choose: async (r) => ((req = r), { key: "k1", probabilities: { k1: 0.7, stuck: 0.05, sd: 0.2, k2: 0.04, nope: 0.9 }, confidence: 0.81 }),
    })
    const out = await d.decide(await input(), live())
    expect(JSON.stringify(req?.state)).not.toContain("hunter2")
    expect(req?.state).toEqual({ goal: "g", values: ["secret"], recent: ["b", "c", "d"], url: p.url, title: p.title })
    expect(req?.instructions).toContain("untrusted")
    expect(out.confidence).toBe(0.81)
    expect(out.runnersUp.map((c) => c.key)).toEqual(["sd", "stuck"])
  })
})
