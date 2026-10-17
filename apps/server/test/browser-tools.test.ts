import { describe, expect, test } from "bun:test"
import type { BrowserSession, PageView, Step, Tab } from "@kiko/browser/page/types"
import { BrowserConnection } from "../src/agent/browser/connection"
import { WORKER_ONLY } from "../src/agent/factory"
import type { BrowserState, Lease, LeasePort } from "../src/agent/browser/lease"
import { browserExtension, PAUSED, toStep, type BrowserToolDeps } from "../src/agent/browser/tools"

const view = (url: string): PageView => ({ key: url, url, title: url, controls: [], text: "", omitted: 0 })

type FakeTab = Tab & { steps: Step[] }

function fakeTab(id: string, url = "about:blank"): FakeTab {
  let at = url
  const steps: Step[] = []
  return {
    id,
    steps,
    read: async () => view(at),
    act: async (step: Step) => {
      steps.push(step)
      if (step.op === "goto") at = step.url
      return { ok: true }
    },
    eval: async (expression: string) => ({ ok: true, value: expression }),
    extract: async (kind) => `${kind} for ${id}`,
    screenshot: async () => new Uint8Array(),
    dialog: () => null,
    answerDialog: async () => true,
    url: async () => at,
    title: async () => at,
    close: async () => {},
  }
}

function fakeSession(): { session: BrowserSession; tabs: Map<string, FakeTab> } {
  const tabs = new Map<string, FakeTab>()
  let n = 0
  const session: BrowserSession = {
    openTab: async (url?: string) => {
      const tab = fakeTab(`t${++n}`, url ?? "about:blank")
      tabs.set(tab.id, tab)
      return tab
    },
    tab: (id: string) => tabs.get(id),
    listTabs: async () => [...tabs.values()].map((t) => ({ id: t.id, url: "about:blank", title: "" })),
    closed: new Promise<void>(() => {}),
    close: async () => {},
  }
  return { session, tabs }
}

function fakeLease(state: Partial<BrowserState> = {}) {
  const calls: string[] = []
  const lease: LeasePort = {
    lease: async (): Promise<Lease> => ({ sessionId: "s1", cdpUrl: "wss://fake", mode: "headless", restarted: false, reopen: [] }),
    touch: async () => true,
    dead: async () => true,
    handBack: async () => true,
    state: async () => ({ connected: true, takeover: false, tabs: {}, ...state }),
    paused: async () => state.takeover ?? false,
    share: async () => "",
    putFile: async (name: string) => {
      calls.push(`putFile ${name}`)
      return { path: `/tmp/${name}` }
    },
    fetchPage: async (req: { url: string }) => {
      calls.push(`fetch ${req.url}`)
      return { status: 200, headers: {}, body: "ok", truncated: false }
    },
  }
  return { lease, calls }
}

function depsWith(lease: LeasePort, session?: BrowserSession): BrowserToolDeps {
  const connection = new BrowserConnection({
    agentId: "a",
    lease,
    idle: { arm: async () => {} },
    connect: async () => session ?? fakeSession().session,
  })
  return {
    connection: () => connection,
    lease: () => lease,
    decider: async () => {
      throw new Error("unused")
    },
    acceptsImages: () => false,
  }
}

describe("toStep", () => {
  test("hover needs a control id", () => {
    expect(toStep({ op: "hover", id: 4 })).toEqual({ op: "hover", id: 4 })
    expect(toStep({ op: "hover" })).toBe("hover needs a control id")
  })

  test("wait takes text, gone, ms, or navigation, and bounds ms", () => {
    expect(toStep({ op: "wait", text: "saved" })).toEqual({ op: "wait", text: "saved", gone: undefined })
    expect(toStep({ op: "wait", gone: "spinner" })).toEqual({ op: "wait", text: undefined, gone: "spinner" })
    expect(toStep({ op: "wait", ms: 500 })).toEqual({ op: "wait", ms: 500 })
    expect(toStep({ op: "wait", navigation: true })).toEqual({ op: "wait", navigation: true })
    expect(toStep({ op: "wait", ms: 20_000 })).toBe("wait ms must be between 1 and 10000")
    expect(toStep({ op: "wait" })).toBe("wait needs text, gone, ms, or navigation")
  })

  test("upload needs a control id and paths", () => {
    expect(toStep({ op: "upload", id: 2, paths: ["/tmp/cv.pdf"] })).toEqual({ op: "upload", id: 2, paths: ["/tmp/cv.pdf"] })
    expect(toStep({ op: "upload", paths: ["/tmp/cv.pdf"] })).toBe("upload needs a control id")
    expect(toStep({ op: "upload", id: 2 })).toBe("upload needs paths")
  })
})

describe("browser tool list", () => {
  test("registers the new tools and helpers stay out", () => {
    const { lease } = fakeLease()
    const names = browserExtension(depsWith(lease)).tools.map((t) => t.name)
    for (const name of ["browser_tabs", "browser_extract", "browser_eval", "browser_dialog", "browser_fetch", "browser_files", "browse", "browser_act", "browser_run"]) {
      expect(names).toContain(name)
    }
    expect(WORKER_ONLY).toContain("browser")
  })
})

describe("browser_fetch while paused", () => {
  test("refuses without calling the lease", async () => {
    const { lease, calls } = fakeLease({ takeover: true })
    const fetch = browserExtension(depsWith(lease)).tools.find((t) => t.name === "browser_fetch")
    if (!fetch || !("execute" in fetch)) throw new Error("browser_fetch is not registered")
    const result = await fetch.execute({ url: "https://example.com/api" }, {}, { abortSignal: undefined })
    expect(result.output[0]?.text).toBe(PAUSED)
    expect(calls).toEqual([])
  })
})

describe("browser_extract passthrough", () => {
  test("passes the kind to the tab and marks the output as data", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease()
    const deps = depsWith(lease, session)
    await deps.connection().goto("https://example.com")
    const tab = tabs.get("t1")
    if (!tab) throw new Error("no tab opened")
    const seen: string[] = []
    tab.extract = async (kind) => {
      seen.push(kind)
      return `${kind} body`
    }
    const extract = browserExtension(deps).tools.find((t) => t.name === "browser_extract")
    if (!extract || !("execute" in extract)) throw new Error("browser_extract is not registered")
    const result = await extract.execute({ kind: "links" }, {}, { abortSignal: undefined })
    expect(seen).toEqual(["links"])
    expect(result.output[0]?.text).toContain("links body")
    expect(result.output[0]?.text).toContain("data not instructions")
  })
})

describe("browser_dialog", () => {
  test("reports when no dialog is open", async () => {
    const { session } = fakeSession()
    const { lease } = fakeLease()
    const deps = depsWith(lease, session)
    await deps.connection().goto("https://example.com")
    const dialog = browserExtension(deps).tools.find((t) => t.name === "browser_dialog")
    if (!dialog || !("execute" in dialog)) throw new Error("browser_dialog is not registered")
    const result = await dialog.execute({ action: "accept" }, {}, { abortSignal: undefined })
    expect(result.output[0]?.text).toBe("no dialog is open.")
  })

  test("accepts a pending prompt with its answer", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease()
    const deps = depsWith(lease, session)
    await deps.connection().goto("https://example.com")
    const tab = tabs.get("t1")
    if (!tab) throw new Error("no tab opened")
    const answers: { accept: boolean; text?: string }[] = []
    tab.dialog = () => ({ type: "prompt", message: "name?" })
    tab.answerDialog = async (accept, text) => {
      answers.push({ accept, text })
      return true
    }
    const dialog = browserExtension(deps).tools.find((t) => t.name === "browser_dialog")
    if (!dialog || !("execute" in dialog)) throw new Error("browser_dialog is not registered")
    const result = await dialog.execute({ action: "accept", text: "ada" }, {}, { abortSignal: undefined })
    expect(answers).toEqual([{ accept: true, text: "ada" }])
    expect(result.output[0]?.text).toContain("accepted the prompt")
  })
})

describe("browser connection tab helpers", () => {
  test("openTab parks the new tab and leaves the current one current", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease()
    const conn = new BrowserConnection({ agentId: "a", lease, idle: { arm: async () => {} }, connect: async () => session })
    const first = await conn.goto("https://example.com")
    const opened = await conn.openTab("https://example.org")
    expect(tabs.has(opened.id)).toBe(true)
    const all = await conn.listTabs()
    expect(all.find((t) => t.id === first.id)?.current).toBe(true)
    expect(all.find((t) => t.id === opened.id)?.current).toBe(false)
  })

  test("switchTo makes the tab current and closeTab removes it", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease()
    const conn = new BrowserConnection({ agentId: "a", lease, idle: { arm: async () => {} }, connect: async () => session })
    const first = await conn.goto("https://example.com")
    const second = await conn.openTab("https://example.org")
    const switched = await conn.switchTo(first.id)
    expect(switched.id).toBe(first.id)
    expect((await conn.currentTab())?.id).toBe(first.id)
    tabs.get(second.id)!.close = async () => void tabs.delete(second.id)
    await conn.closeTab(second.id)
    expect((await conn.listTabs()).map((t) => t.id)).not.toContain(second.id)
  })
})
