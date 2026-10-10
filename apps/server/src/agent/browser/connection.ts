import { connect } from "@yuki/browser/cdp/browser"
import { BROWSER } from "@yuki/browser/config"
import type { BrowserSession, Tab } from "@yuki/browser/page/types"
import { count } from "../../lib/dev-stats"
import type { LeasePort } from "./lease"

/** An open CDP socket counts as activity to Kernel, so it closes this long after the last browser call. */
export const IDLE_CLOSE_MS = 15_000
export const BROWSER_IDLE_WAKEUP = "browser-idle"

export const RESTARTED = "The browser was replaced, so your tab was reopened at its last address. Anything the page did not save, like a half-filled form, is gone."

export type IdleTimer = { arm(at: number): Promise<void> }

export type ConnectionDeps = {
  /** The id the lease counts this agent's tabs under. */
  agentId: string
  lease: LeasePort
  idle: IdleTimer
  connect?: (cdpUrl: string) => Promise<BrowserSession>
  now?: () => number
}

/** The agent's current tab. `tab` is gone after an idle close or a restart, and `url` reopens it. */
type Held = { tab?: Tab; url: string }

export class Busy extends Error {
  constructor(holders: Record<string, number>) {
    const who = Object.entries(holders).filter(([, n]) => n > 0).map(([agent, n]) => `${agent.split(/[:/]/).at(-1)} has ${n}`)
    super(`the browser is full: ${BROWSER.tabsPerBrowser} tabs are open (${who.join(", ")}). ask one of them to finish, or try again later.`)
    this.name = "Busy"
  }
}

/**
 * One agent's browser connection: the CDP socket, the agent's current tab, and the short-lived tabs
 * its calls open. It leases lazily, reconnects after the socket closes, and reopens the current tab
 * at the agent's own record of its last address, so every agent reopens its own tab after a restart.
 */
export class BrowserConnection {
  private session: BrowserSession | null = null
  private opening: Promise<BrowserSession> | null = null
  private current: Held | null = null
  private readonly borrowed = new Map<string, string>()
  private busy = 0
  private closingByUs = false
  private lostSocket = false
  /** The Kernel session this agent last connected to. A new one means the agent reopens its own tab. */
  private sessionId: string | null = null
  private note: string | undefined
  private readonly connectTo: (cdpUrl: string) => Promise<BrowserSession>
  private readonly now: () => number

  constructor(private readonly deps: ConnectionDeps) {
    this.connectTo = deps.connect ?? ((url) => connect(url))
    this.now = deps.now ?? Date.now
  }

  /** Runs one browser call, then reports the agent's tabs and pushes the idle close back. */
  async use<T>(run: () => Promise<T>): Promise<T> {
    this.busy++
    try {
      return await run()
    } finally {
      this.busy--
      if (this.session) await this.deps.lease.touch(this.tabs()).catch(() => false)
      await this.deps.idle.arm(this.now() + IDLE_CLOSE_MS)
    }
  }

  /** A note for the model, once: the browser restarted under the agent. */
  takeNote(): string | undefined {
    const note = this.note
    this.note = undefined
    return note
  }

  private tabs(): Record<string, string> {
    const out: Record<string, string> = Object.fromEntries(this.borrowed)
    if (this.current?.tab) out[this.current.tab.id] = this.current.url
    return out
  }

  private async socket(): Promise<BrowserSession> {
    if (this.session) return this.session
    this.opening ??= this.open().finally(() => {
      this.opening = null
    })
    return this.opening
  }

  private async open(): Promise<BrowserSession> {
    if (this.lostSocket && this.sessionId) await this.deps.lease.dead(this.sessionId).catch(() => false)
    const t0 = performance.now()
    const lease = await this.deps.lease.lease()
    const t1 = performance.now()
    const session = await this.connectTo(lease.cdpUrl)
    count("browser.lease.ms", Math.round(t1 - t0))
    count("browser.connect.ms", Math.round(performance.now() - t1))
    if ((lease.restarted || (this.sessionId !== null && lease.sessionId !== this.sessionId)) && this.current) this.note = RESTARTED
    this.sessionId = lease.sessionId
    this.closingByUs = false
    this.lostSocket = false
    if (this.current) this.current.tab = undefined
    this.borrowed.clear()
    void session.closed.then(() => {
      if (this.session !== session) return
      this.session = null
      if (!this.closingByUs) this.lostSocket = true
    })
    this.session = session
    return session
  }

  private async room(extra: number): Promise<void> {
    const { tabs } = await this.deps.lease.state()
    const mine = Object.keys(this.tabs()).length
    const others = Object.entries(tabs).reduce((n, [, count]) => n + count, 0) - (tabs[this.deps.agentId] ?? 0)
    if (others + mine + extra > BROWSER.tabsPerBrowser) throw new Busy(tabs)
  }

  private track(held: Held, tab: Tab): Tab {
    return {
      id: tab.id,
      read: async () => {
        const t = performance.now()
        const view = await tab.read()
        count("browser.read.ms", Math.round(performance.now() - t))
        held.url = view.url
        return view
      },
      act: (step) => tab.act(step),
      screenshot: () => tab.screenshot(),
      close: () => tab.close(),
    }
  }

  /** The agent's current tab, reopened at its last address when the socket closed. Null if it never opened one. */
  async currentTab(): Promise<Tab | null> {
    if (!this.current) return null
    const session = await this.socket()
    if (!this.current.tab) {
      await this.room(1)
      this.current.tab = this.track(this.current, await session.openTab(this.current.url))
    }
    return this.current.tab
  }

  /** Points the current tab at `url`, opening it if needed. */
  async goto(url: string): Promise<Tab> {
    const tab = await this.currentTab()
    if (tab && this.current) {
      const result = await tab.act({ op: "goto", url })
      if (!result.ok) throw new Error(`could not open ${url}: ${result.reason}`)
      this.current.url = url
      return tab
    }
    const session = await this.socket()
    await this.room(1)
    const held: Held = { url }
    const t = performance.now()
    held.tab = this.track(held, await session.openTab(url))
    count("browser.open.ms", Math.round(performance.now() - t))
    this.current = held
    return held.tab
  }

  /** Opens one tab per entry, already at its url, for one call. They count as the agent's until `done` closes them. */
  async borrow(urls: (string | undefined)[]): Promise<{ tabs: Tab[]; done: () => Promise<void> }> {
    const session = await this.socket()
    await this.room(urls.length)
    const opened = await Promise.allSettled(urls.map((url) => session.openTab(url)))
    const tabs = opened.flatMap((o) => (o.status === "fulfilled" ? [o.value] : []))
    for (const [i, t] of tabs.entries()) this.borrowed.set(t.id, urls[i] ?? "about:blank")
    const done = async () => {
      for (const t of tabs) this.borrowed.delete(t.id)
      await Promise.all(tabs.map((t) => t.close().catch(() => {})))
    }
    const failed = opened.find((o): o is PromiseRejectedResult => o.status === "rejected")
    if (failed) {
      await done()
      throw failed.reason
    }
    return { tabs, done }
  }

  /** The idle wakeup fired. Closes the tabs and the socket, keeps the current tab's address, and releases the lease. */
  async idle(): Promise<"busy" | "closed"> {
    if (this.busy > 0) {
      await this.deps.idle.arm(this.now() + IDLE_CLOSE_MS)
      return "busy"
    }
    const session = this.session
    this.session = null
    if (session) {
      this.closingByUs = true
      if (this.current?.tab) await this.current.tab.close().catch(() => {})
      await session.close().catch(() => {})
    }
    if (this.current) this.current.tab = undefined
    this.borrowed.clear()
    await this.deps.lease.release().catch(() => {})
    return "closed"
  }

  isOpen(): boolean {
    return this.session !== null
  }
}
