import { connect } from "@yuki/browser/cdp/browser"
import { BROWSER } from "@yuki/browser/config"
import type { BrowserSession, Tab } from "@yuki/browser/page/types"
import { count } from "../../lib/dev-guard"
import type { LeasePort } from "./lease"

export const IDLE_CLOSE_MS = 15_000
export const BROWSER_IDLE_WAKEUP = "browser-idle"

export const RESTARTED = "The browser was replaced, so your tab was reopened at its last address. Anything the page did not save, like a half-filled form, is gone."

export type IdleTimer = { arm(at: number): Promise<void> }

export type ConnectionDeps = {
  agentId: string
  lease: LeasePort
  idle: IdleTimer
  connect?: (cdpUrl: string) => Promise<BrowserSession>
  now?: () => number
}

type Held = { tab?: Tab; url: string; opening?: Promise<Tab> }

export class Busy extends Error {
  constructor(holders: Record<string, number>) {
    const who = Object.entries(holders).filter(([, n]) => n > 0).map(([agent, n]) => `${agent.split(/[:/]/).at(-1)} has ${n}`)
    super(`the browser is full: ${BROWSER.tabsPerBrowser} tabs are open (${who.join(", ")}). ask one of them to finish, or try again later.`)
    this.name = "Busy"
  }
}

export class BrowserConnection {
  private session: BrowserSession | null = null
  private dialing: Promise<BrowserSession> | null = null
  private current: Held | null = null
  private readonly borrowed = new Map<string, string>()
  /** Tabs the agent opened or switched away from: still open, still counted as its own, not current. */
  private readonly parked = new Map<string, string>()
  private busy = 0
  /** Slots reserved by opens still in flight. They are not in any tab map yet. */
  private opening = 0
  private lostSocket = false
  private sessionId: string | null = null
  private note: string | undefined
  private readonly connectTo: (cdpUrl: string) => Promise<BrowserSession>
  private readonly now: () => number

  constructor(private readonly deps: ConnectionDeps) {
    this.connectTo = deps.connect ?? ((url) => connect(url))
    this.now = deps.now ?? Date.now
  }

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

  takeNote(): string | undefined {
    const note = this.note
    this.note = undefined
    return note
  }

  private tabs(): Record<string, string> {
    const out: Record<string, string> = { ...Object.fromEntries(this.borrowed), ...Object.fromEntries(this.parked) }
    if (this.current?.tab) out[this.current.tab.id] = this.current.url
    return out
  }

  private async socket(): Promise<BrowserSession> {
    if (this.session) return this.session
    this.dialing ??= this.open().finally(() => {
      this.dialing = null
    })
    return this.dialing
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
    this.lostSocket = false
    if (this.current) this.current.tab = undefined
    this.borrowed.clear()
    this.parked.clear()
    void session.closed.then(() => {
      if (this.session !== session) return
      this.session = null
      this.lostSocket = true
    })
    this.session = session
    return session
  }

  /** The check and the hold run in one step after the await, so a parallel call counts the slots this one holds. */
  private async slots<T>(extra: number, open: () => Promise<T>): Promise<T> {
    const { tabs } = await this.deps.lease.state()
    const mine = Object.keys(this.tabs()).length
    const others = Object.entries(tabs).reduce((n, [agent, c]) => (agent === this.deps.agentId ? n : n + c), 0)
    if (others + mine + this.opening + extra > BROWSER.tabsPerBrowser) throw new Busy(tabs)
    this.opening += extra
    try {
      return await open()
    } finally {
      this.opening -= extra
    }
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
      eval: (expression) => tab.eval(expression),
      extract: (kind) => tab.extract(kind),
      screenshot: (opts) => tab.screenshot(opts),
      dialog: () => tab.dialog(),
      answerDialog: (accept, text) => tab.answerDialog(accept, text),
      url: () => tab.url(),
      title: () => tab.title(),
      close: () => tab.close(),
    }
  }

  private park(): void {
    const cur = this.current
    if (cur?.tab) this.parked.set(cur.tab.id, cur.url)
  }

  private tabOf(held: Held): Promise<Tab> {
    if (held.tab && this.session) return Promise.resolve(held.tab)
    held.opening ??= this.openHeld(held).finally(() => {
      held.opening = undefined
    })
    return held.opening
  }

  private openHeld(held: Held): Promise<Tab> {
    return this.slots(1, async () => {
      const session = await this.socket()
      const t = performance.now()
      const tab = this.track(held, await session.openTab(held.url))
      count("browser.open.ms", Math.round(performance.now() - t))
      // A switchTo during the open made this held non-current. Its tab must still count as the agent's, or the cap is not enforced and idle never closes it.
      if (this.current !== held) this.parked.set(tab.id, held.url)
      held.tab = tab
      return tab
    })
  }

  async currentTab(): Promise<Tab | null> {
    return this.current ? this.tabOf(this.current) : null
  }

  async goto(url: string): Promise<Tab> {
    const held = this.current
    if (held) {
      const tab = await this.tabOf(held)
      const result = await tab.act({ op: "goto", url })
      if (!result.ok) throw new Error(`could not open ${url}: ${result.reason}${result.detail ? ` (${result.detail})` : ""}${result.reason === "dialog" ? ". a dialog is open: call browser_dialog with accept or dismiss, then try again" : ""}`)
      held.url = url
      return tab
    }
    const fresh: Held = { url }
    this.current = fresh
    try {
      return await this.tabOf(fresh)
    } catch (e) {
      if (this.current === fresh) this.current = null
      throw e
    }
  }

  async listTabs(): Promise<{ id: string; url: string; title: string; current: boolean }[]> {
    const session = await this.socket()
    const all = await session.listTabs()
    const currentId = this.current?.tab?.id
    return all.map((t) => ({ ...t, current: t.id === currentId }))
  }

  openTab(url: string): Promise<Tab> {
    return this.slots(1, async () => {
      const session = await this.socket()
      const tab = await session.openTab(url)
      this.parked.set(tab.id, url)
      return tab
    })
  }

  async switchTo(id: string): Promise<Tab> {
    if (this.current?.tab?.id === id) return this.current.tab
    const session = await this.socket()
    const found = (await session.listTabs()).find((t) => t.id === id)
    if (!found) throw new Error(`no tab ${id}`)
    const target = await session.tab(id)
    if (!target) throw new Error(`no tab ${id}`)
    this.park()
    this.parked.delete(id)
    const held: Held = { url: found.url }
    held.tab = this.track(held, target)
    this.current = held
    return held.tab
  }

  async closeTab(id: string): Promise<void> {
    const session = await this.socket()
    const target = await session.tab(id)
    if (!target) throw new Error(`no tab ${id}`)
    await target.close()
    this.borrowed.delete(id)
    this.parked.delete(id)
    if (this.current?.tab?.id === id) this.current = null
  }

  async borrow(urls: (string | undefined)[]): Promise<{ tabs: Tab[]; done: () => Promise<void> }> {
    const { tabs, failed } = await this.slots(urls.length, async () => {
      const session = await this.socket()
      const opened = await Promise.allSettled(urls.map((url) => session.openTab(url)))
      const made: Tab[] = []
      opened.forEach((o, i) => {
        if (o.status !== "fulfilled") return
        made.push(o.value)
        this.borrowed.set(o.value.id, urls[i] ?? "about:blank")
      })
      return { tabs: made, failed: opened.find((o): o is PromiseRejectedResult => o.status === "rejected") }
    })
    const done = async () => {
      for (const t of tabs) this.borrowed.delete(t.id)
      await Promise.all(tabs.map((t) => t.close().catch(() => {})))
    }
    if (failed) {
      await done()
      throw failed.reason
    }
    return { tabs, done }
  }

  async idle(): Promise<"busy" | "closed"> {
    if (this.busy > 0) {
      await this.deps.idle.arm(this.now() + IDLE_CLOSE_MS)
      return "busy"
    }
    const session = this.session
    const tab = this.current?.tab
    this.session = null
    if (this.current) this.current.tab = undefined
    this.borrowed.clear()
    this.parked.clear()
    await tab?.close().catch(() => {})
    await session?.close().catch(() => {})
    if (this.session || this.dialing || this.busy > 0) return "closed"
    await this.deps.lease.release().catch(() => {})
    return "closed"
  }
}
