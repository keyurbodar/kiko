import { describe, expect, test } from "bun:test"
import type { BrowserSession, PageView, Step, Tab } from "@kiko/browser/page/types"
import { BrowserConnection } from "../src/agent/browser/connection"
import { WORKER_ONLY } from "../src/agent/factory"
import type { BrowserState, Lease, LeasePort } from "../src/agent/browser/lease"
import { browserExtension, browserInfoExtension, BROWSER_INFO_EXT, PAUSED, toStep, type BrowserToolDeps } from "../src/agent/browser/tools"
import { type FilesBackend, RoomFs } from "../src/files/room-fs"
import type { FsEntry } from "../src/room/files"

const view = (url: string, controls: PageView["controls"] = [], text = ""): PageView => ({ key: url, url, title: url, controls, text, omitted: 0 })

type FakeTab = Tab & { steps: Step[]; notes: string[] }

function fakeTab(id: string, url = "about:blank", gone?: () => void): FakeTab {
  let at = url
  const steps: Step[] = []
  const notes: string[] = []
  return {
    id,
    steps,
    notes,
    read: async () => view(at),
    act: async (step: Step) => {
      steps.push(step)
      if (step.op === "goto") at = step.url
      return { ok: true }
    },
    screenshot: async () => new Uint8Array([1, 2, 3]),
    takeNotes: () => notes.splice(0, notes.length),
    front: async () => {},
    close: async () => {
      gone?.()
    },
  }
}

function fakeSession(): { session: BrowserSession; tabs: Map<string, FakeTab> } {
  const tabs = new Map<string, FakeTab>()
  let n = 0
  const session: BrowserSession = {
    openTab: async (url?: string) => {
      const id = `t${++n}`
      const tab = fakeTab(id, url ?? "about:blank", () => tabs.delete(id))
      tabs.set(id, tab)
      return tab
    },
    tab: (id: string) => tabs.get(id),
    attach: async (id: string) => tabs.get(id),
    listTabs: async () => [...tabs.values()].map((t) => ({ id: t.id, url: "about:blank", title: "" })),
    closed: new Promise<void>(() => {}),
    close: async () => {},
  }
  return { session, tabs }
}

function fakeLease(state: Partial<BrowserState> = {}) {
  const calls: string[] = []
  const lease: LeasePort = {
    lease: async (): Promise<Lease> => ({ sessionId: "s1", cdpUrl: "wss://fake", mode: "headful", restarted: false, reopen: [] }),
    touch: async (tabs) => {
      calls.push(`touch ${JSON.stringify(tabs)}`)
      return true
    },
    dead: async () => true,
    handBack: async () => true,
    state: async () => ({ connected: true, takeover: false, tabs: {}, list: [], ...state }),
    paused: async () => state.takeover ?? false,
    live: async () => ({ ok: true, url: "https://live.test/abc", posted: false }),
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
  return { connection: () => connection, lease: () => lease, acceptsImages: () => false }
}

const tool = (extension: ReturnType<typeof browserExtension>, name: string) => {
  const found = extension.tools.find((t) => t.name === name)
  if (!found || !("execute" in found)) throw new Error(`${name} is not registered`)
  return found.execute as (args: unknown, api: unknown, ctx: unknown) => Promise<{ output: { text?: string }[]; isError?: boolean }>
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

  test("a control step without an id is refused", () => {
    expect(toStep({ op: "click", id: 2 })).toEqual({ op: "click", id: 2 })
    expect(toStep({ op: "click" })).toBe("click needs a control id")
    expect(toStep({ op: "type", text: "ada" })).toBe("type needs a control id")
    expect(toStep({ op: "select", id: 1 })).toBe("select needs an option")
    expect(toStep({ op: "press" })).toBe("press needs a key")
  })
})

describe("the browser has four tools", () => {
  test("only browse, browser_act, and browser_look carry page work", () => {
    const { lease } = fakeLease()
    const names = browserExtension(depsWith(lease)).tools.map((t) => t.name)
    expect(names.sort()).toEqual(["browse", "browser_act", "browser_look"])
    expect(browserInfoExtension(depsWith(lease)).tools.map((t) => t.name)).toEqual(["browser_link"])
    expect(WORKER_ONLY).toContain("browser")
  })
})

describe("browse", () => {
  test("opens up to four urls and closes the borrowed ones", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease()
    const deps = depsWith(lease, session)
    const out = await tool(browserExtension(deps), "browse")({ urls: ["https://a.test", "https://b.test", "https://c.test"] }, {}, { abortSignal: undefined })
    expect(out.output[0]?.text).toContain("--- page 1")
    expect(out.output[0]?.text).toContain("--- page 3")
    // The first url is the scope's tab, so only the two borrowed tabs close.
    expect(tabs.size).toBe(1)
    expect(await deps.connection().currentTab()).toBeDefined()
  })

  test("with no urls it reads the current tab and says when there is none", async () => {
    const { session } = fakeSession()
    const { lease } = fakeLease()
    const deps = depsWith(lease, session)
    const browse = tool(browserExtension(deps), "browse")
    expect((await browse({}, {}, { abortSignal: undefined })).output[0]?.text).toContain("Call browse with a url first")
    await deps.connection().goto("https://a.test")
    expect((await browse({}, {}, { abortSignal: undefined })).output[0]?.text).toContain("https://a.test")
  })

  test("find returns only the controls and paragraphs that mention it", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease()
    const deps = depsWith(lease, session)
    const tab = await deps.connection().goto("https://a.test")
    const fake = tabs.get(tab.id) as FakeTab
    fake.read = async () => ({
      ...view("https://a.test", [
        { id: 1, role: "link", label: "Sign in" },
        { id: 2, role: "link", label: "Privacy" },
      ], "Welcome to the site.\n\nThe privacy policy is long.\n\nContact us."),
    })
    const out = await tool(browserExtension(deps), "browse")({ find: "privacy" }, {}, { abortSignal: undefined })
    const text = out.output[0]?.text ?? ""
    expect(text).toContain("2 link \"Privacy\"")
    expect(text).not.toContain("1 link \"Sign in\"")
    expect(text).toContain("The privacy policy is long.")
    expect(text).not.toContain("Welcome to the site.")
  })

  test("a bad url is refused before a tab opens", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease()
    const out = await tool(browserExtension(depsWith(lease, session)), "browse")({ urls: ["file:///etc/passwd"] }, {}, { abortSignal: undefined })
    expect(out).toMatchObject({ isError: true })
    expect(tabs.size).toBe(0)
  })

  test("a page that never answers does not hold the call past its deadline", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease()
    const deps = { ...depsWith(lease, session), browseMs: 50 }
    const tab = await deps.connection().goto("https://a.test")
    const fake = tabs.get(tab.id) as FakeTab
    fake.read = () => new Promise<PageView>(() => {})
    const started = performance.now()
    const out = await tool(browserExtension(deps), "browse")({}, {}, { abortSignal: undefined })
    expect(out.output[0]?.text).toContain("no answer within")
    expect(performance.now() - started).toBeLessThan(5_000)
  })
})

describe("browser_act", () => {
  test("runs the steps in order and returns the fresh page", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease()
    const deps = depsWith(lease, session)
    const tab = await deps.connection().goto("https://a.test")
    const out = await tool(browserExtension(deps), "browser_act")({ steps: [{ op: "click", id: 1 }, { op: "wait", ms: 100 }] }, {}, { abortSignal: undefined })
    expect(out.output[0]?.text).toContain("did: click 1; wait.")
    expect((tabs.get(tab.id) as FakeTab).steps).toEqual([{ op: "click", id: 1 }, { op: "wait", ms: 100 }])
  })

  test("a bad step does nothing", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease()
    const deps = depsWith(lease, session)
    const tab = await deps.connection().goto("https://a.test")
    const out = await tool(browserExtension(deps), "browser_act")({ steps: [{ op: "click" }] }, {}, { abortSignal: undefined })
    expect(out.output[0]?.text).toBe("step 1: click needs a control id. nothing was done.")
    expect((tabs.get(tab.id) as FakeTab).steps).toEqual([])
  })

  test("a dialog the browser answered is reported after the result", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease()
    const deps = depsWith(lease, session)
    const tab = await deps.connection().goto("https://a.test")
    const fake = tabs.get(tab.id) as FakeTab
    fake.act = async () => {
      fake.notes.push('confirm said "delete it?": accepted')
      return { ok: true }
    }
    const out = await tool(browserExtension(deps), "browser_act")({ steps: [{ op: "click", id: 1 }] }, {}, { abortSignal: undefined })
    expect(out.output[0]?.text).toContain('confirm said "delete it?": accepted')
  })
})

describe("browser_look", () => {
  const memoryFiles = () => {
    const files = new Map<string, { bytes: Uint8Array; type: string }>()
    const entry = (path: string): FsEntry & { kind: "file" } => {
      const f = files.get(path)!
      return { kind: "file", path, id: path, size: f.bytes.length, type: f.type, sha256: `sha:${path}`, r2Key: `key:${path}`, at: 0 }
    }
    const backend: FilesBackend = {
      stat: async (path) => (files.has(path) ? entry(path) : null),
      list: async () => [],
      bytes: async (key) => files.get(key.slice(4))?.bytes ?? null,
      write: async (path, bytes, type) => {
        files.set(path, { bytes, type })
        return { ok: true, entry: entry(path) }
      },
      move: async () => ({ ok: false, code: "invalid", message: "no" }),
      remove: async () => ({ ok: false, code: "invalid", message: "no" }),
      mkdir: async () => ({ ok: false, code: "invalid", message: "no" }),
      commit: async () => ({ ok: true }),
    }
    return { files, fs: new RoomFs("look", backend) }
  }

  test("a model that sees images gets the screenshot as an image", async () => {
    const { session } = fakeSession()
    const { lease } = fakeLease()
    const deps = { ...depsWith(lease, session), acceptsImages: () => true }
    await deps.connection().goto("https://a.test")
    const out = (await tool(browserExtension(deps), "browser_look")({}, { agent: async () => ({ model: undefined }) }, { abortSignal: undefined })) as { output: { type: string }[] }
    expect(out.output[0]?.type).toBe("image")
  })

  test("with save it writes a chat file and returns its path", async () => {
    const { session } = fakeSession()
    const { lease } = fakeLease()
    const { files, fs } = memoryFiles()
    const deps = { ...depsWith(lease, session), acceptsImages: () => true }
    await deps.connection().goto("https://a.test")
    const api = { agent: async () => ({ model: undefined }), env: fs }
    const out = await tool(browserExtension(deps), "browser_look")({ save: true }, api, { abortSignal: undefined })
    expect(out.output[0]?.text).toContain("saved to /browser-")
    const saved = [...files.entries()]
    expect(saved).toHaveLength(1)
    expect(saved[0]?.[0]).toStartWith("browser-")
    expect(saved[0]?.[1].type).toBe("image/jpeg")
  })
})

describe("the human's control stops the agent", () => {
  test("browse and browser_act do nothing while the human has control", async () => {
    const { session, tabs } = fakeSession()
    const { lease } = fakeLease({ takeover: true })
    const deps = depsWith(lease, session)
    for (const [name, args] of [["browse", { urls: ["https://a.test"] }], ["browser_act", { steps: [{ op: "click", id: 1 }] }]] as const) {
      expect((await tool(browserExtension(deps), name)(args, {}, { abortSignal: undefined })).output[0]?.text).toBe(PAUSED)
    }
    expect(tabs.size).toBe(0)
  })
})

describe("browser_link", () => {
  test("the talker has browser_link and no page tools", async () => {
    const { lease } = fakeLease()
    const names = browserInfoExtension(depsWith(lease)).tools.map((t) => t.name)
    expect(names).toEqual(["browser_link"])
    expect(BROWSER_INFO_EXT).toBe("browser-info")
  })

  test("a failure comes back as an error, not a link", async () => {
    const { lease } = fakeLease()
    const failing: LeasePort = { ...lease, live: async () => ({ ok: false as const, error: "No browser is open" }) }
    const out = await tool(browserInfoExtension(depsWith(failing)), "browser_link")({ mode: "watch" }, {}, { abortSignal: undefined })
    expect(out).toMatchObject({ isError: true })
    expect(out.output[0]?.text).toBe("No browser is open")
  })
})
