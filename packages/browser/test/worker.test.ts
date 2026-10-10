import { describe, expect, test } from "bun:test"
import { BROWSER } from "../src/config"
import { jevDecider } from "../src/decide/jev"
import { modelDecider, parseReply } from "../src/decide/model"
import type { JevPort } from "../src/decide/ports"
import { choices } from "../src/plan/candidates"
import { fastSteps } from "../src/plan/fast"
import { chainOf, runTask, runTasks } from "../src/worker/run"
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
    const r = await runTask(tab, { goal: "look up kernel", values: { query: "kernel" } }, deps(d))
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
    expect(parseReply("k7", keys)).toEqual({ key: "k7", unsure: false, after: [] })
    expect(parseReply("k7 unsure", keys)).toEqual({ key: "k7", unsure: true, after: [] })
    expect(parseReply("**K70**.", keys)).toEqual({ key: "k70", unsure: false, after: [] })
    expect(parseReply("I think the answer is k7, but unsure", keys)).toEqual({ key: "k7", unsure: true, after: [] })
    expect(parseReply("no idea", keys)).toBeNull()
  })

  test("parseReply chains only a reply made of keys, at most chainMax", () => {
    const keys = ["k1", "k2", "k3", "k4", "done"]
    expect(parseReply("k1 k2 k3 k4", keys)?.after).toEqual(["k2", "k3"])
    expect(parseReply("k1, then k2", keys)?.after).toEqual([])
    expect(parseReply("k1 k2 unsure", keys)?.after).toEqual([])
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

describe("chains", () => {
  // name, email, a box, a submit button, and a link; submit goes to "sent"
  const form: Site = {
    pages: {
      form: page("form", [
        { role: "textbox", label: "Name" },
        { role: "textbox", label: "Email" },
        { role: "checkbox", label: "Bacon" },
        { role: "button", label: "Submit" },
        { role: "link", label: "Help" },
      ]),
      sent: page("sent", [{ label: "again" }]),
      help: page("help", [{ label: "home" }]),
    },
    go: { "form:click:4": "sent", "form:click:5": "help" },
  }
  // Names that match no label, so the decider, not the fast path, picks.
  const values = { who: "Ada", where: "a@b.c" }
  const chained = (keys: string[]) => {
    const d = scripted((n, input) => (n === 0 ? { key: keys[0] as string } : { key: "done" }))
    const base = d.decide.bind(d)
    d.decide = async (input, signal) => {
      const r = await base(input, signal)
      if (d.calls === 1) r.after = keys.slice(1).map((k) => input.options.find((o) => o.key === k)!)
      return r
    }
    return d
  }

  test("fills two fields and ticks a box with one decision and one read", async () => {
    const { tab, acted } = fakeTab(form, "form")
    let reads = 0
    const read = tab.read
    tab.read = async () => (reads++, read())
    const r = await runTask(tab, { goal: "order", values }, deps(chained(["t1v0", "t2v1", "k3"])))
    expect(acted.map((s) => s.op)).toEqual(["type", "type", "click"])
    expect(r.stop).toBe("done")
    expect(reads).toBe(2)
  })

  test("a chain stops after a step that can navigate", () => {
    const options = (keys: string[]) => keys.map((k) => ({ key: k, text: k, step: k.startsWith("t") ? { op: "type" as const, id: Number(k[1]), text: "x" } : { op: "click" as const, id: Number(k.slice(1)) } }))
    const p = form.pages.form as NonNullable<Site["pages"][string]>
    const keys = (ks: string[]) => chainOf({ choice: options(ks)[0]!, confidence: null, runnersUp: [], after: options(ks).slice(1) }, p).map((c) => c.key)
    expect(keys(["k5", "t1", "t2"])).toEqual(["k5"])
    expect(keys(["k4", "k3"])).toEqual(["k4"])
    expect(keys(["t1", "k3", "k4"])).toEqual(["t1", "k3", "k4"])
    expect(keys(["t1", "k4", "t2"])).toEqual(["t1", "k4"])
  })

  test("a failed step ends the chain", async () => {
    const broken: Site = { ...form, go: { ...form.go, "form:type:1": { fail: "gone" } } }
    const { tab, acted } = fakeTab(broken, "form")
    const r = await runTask(tab, { goal: "order", values }, deps(chained(["t1v0", "t2v1", "k4"])))
    expect(acted.map((s) => s.op)).toEqual(["type"])
    expect(r.actions[0]).toContain("failed: gone")
  })
})

describe("fast path", () => {
  const fields = (labels: string[]) => page("f", [...labels.map((label) => ({ role: "textbox", label })), { role: "button", label: "Send" }])
  const picks = (p: ReturnType<typeof page>, goal: string, values: Record<string, string>) =>
    fastSteps(p, goal, values, choices(p, goal, values)).map((c) => c.key)

  test("fills each field its value's name names, with no decider call", async () => {
    const p = fields(["Customer name:", "E-mail address:", "Comments"])
    expect(picks(p, "order", { name: "Ada", email: "a@b.c" })).toEqual(["t1v0", "t2v1"])
    const d = scripted(() => ({ key: "done" }))
    const { tab, acted } = fakeTab({ pages: { f: p }, go: {} }, "f")
    await runTask(tab, { goal: "order", values: { name: "Ada", email: "a@b.c" } }, deps(d))
    expect(acted.map((s) => s.op === "type" && s.text)).toEqual(["Ada", "a@b.c"])
    expect(d.calls).toBe(1)
  })

  test("never fires when two choices tie", () => {
    expect(picks(fields(["First name", "Last name"]), "sign up", { name: "Ada" })).toEqual([])
    expect(picks(fields(["Your name and email"]), "sign up", { name: "Ada", email: "a@b.c" })).toEqual([])
    const two = page("s", [{ role: "searchbox", label: "Search" }, { role: "textbox", label: "Find" }])
    expect(picks(two, "search kernel", { query: "kernel" })).toEqual([])
  })

  test("skips a filled or secret field, and a search box when the goal does not say search", () => {
    expect(picks(page("f", [{ role: "textbox", label: "Name", value: "Bo" }]), "x", { name: "Ada" })).toEqual([])
    expect(picks(page("f", [{ role: "textbox", label: "Password", state: "secret" }]), "x", { password: "p" })).toEqual([])
    const search = page("s", [{ role: "searchbox", label: "Search" }])
    expect(picks(search, "look up kernel", { query: "kernel" })).toEqual([])
    expect(picks(search, "search for kernel", { query: "kernel" })).toEqual(["t1v0"])
  })
})
