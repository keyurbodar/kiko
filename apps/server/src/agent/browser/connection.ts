import { connect } from "@kiko/browser/cdp/browser"
import { BROWSER } from "@kiko/browser/config"
import type { BrowserSession, Tab } from "@kiko/browser/page/types"
import { count } from "../../lib/dev-guard"
import type { LeasePort } from "./lease"

/** With no call for this long the socket closes, so the object can sleep. The tabs stay open in the browser. */
export const IDLE_CLOSE_MS = 15_000
/** A worker keeps its tab to itself while it made a call this recently. After that another worker may take it over. */
export const CLAIM_MS = 60_000
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

/** A worker's current tab. `id` outlives the socket, so the next socket attaches to the same page. */
type Held = { id?: string; tab?: Tab; url: string; opening?: Promise<Tab> }

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
  /** The tab each worker is on. A worker is a scope, so two workers of one agent never drive the same tab at once. */
  private readonly held = new Map<string, Held>()
  private readonly borrowed = new Map<string, string>()
  /** Tabs the agent opened or switched away from: still open, still counted as its own, not current. */
  private readonly parked = new Map<string, string>()
  /** Calls in flight and the last call's time, per scope. */
  private readonly running = new Map<string, number>()
  private readonly seen = new Map<string, number>()
  private busy = 0
  /** Slots reserved by opens still in flight. They are not in any tab map yet. */
  private opening = 0
  private lostSocket = false
  private sessionId: string | null = null
  private seeded = false
  private note: string | undefined
  private readonly connectTo: (cdpUrl: string) => Promise<BrowserSession>
  private readonly now: () => number

  constructor(private readonly deps: ConnectionDeps) {
    this.connectTo = deps.connect ?? ((url) => connect(url))
    this.now = deps.now ?? Date.now
  }

  async use<T>(run: () => Promise<T>, scope = ""): Promise<T> {
    this.busy++
    this.running.set(scope, (this.running.get(scope) ?? 0) + 1)
    this.seen.set(scope, this.now())
    try {
      return await run()
    } finally {
      this.busy--
      this.running.set(scope, (this.running.get(scope) ?? 1) - 1)
      this.seen.set(scope, this.now())
      if (this.session) await this.deps.lease.touch(this.tabs()).catch(() => false)
      await this.deps.idle.arm(this.now() + IDLE_CLOSE_MS)
    }
  }

  /** The dialog notes from the calls since the last read, so a confirm the browser answered says what it agreed to. */
  takeNote(): string | undefined {
    const note = this.note
    this.note = undefined
    return note
  }

  private tabs(): Record<string, string> {
    const out: Record<string, string> = { ...Object.fromEntries(this.borrowed), ...Object.fromEntries(this.parked) }
    for (const h of this.held.values()) if (h.id) out[h.id] = h.url
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
    const replaced = lease.restarted || (this.sessionId !== null && lease.sessionId !== this.sessionId)
    this.borrowed.clear()
    for (const h of this.held.values()) h.tab = undefined
    if (replaced) {
      if (this.held.size) this.note = RESTARTED
      for (const h of this.held.values()) h.id = undefined
      this.parked.clear()
    } else {
      await this.seed()
      await this.reattach(session)
    }
    this.sessionId = lease.sessionId
    this.lostSocket = false
    void session.closed.then(() => {
      if (this.session !== session) return
      this.session = null
      this.lostSocket = true
    })
    this.session = session
    return session
  }

  /** The socket closed but the browser did not: attach to the same pages, so a login or a half-written form is still there. */
  private async reattach(session: BrowserSession): Promise<void> {
    const attach = (id: string) => session.attach(id).catch(() => undefined)
    await Promise.all([
      ...[...this.held.values()].map(async (h) => {
        if (!h.id) return
        const tab = await attach(h.id)
        if (tab) h.tab = this.track(h, tab)
        else h.id = undefined
      }),
      ...[...this.parked.keys()].map(async (id) => {
        if (!(await attach(id))) this.parked.delete(id)
      }),
    ])
  }

  /**
   * An object that slept comes back with its maps empty, and so does a second worker. The lease still lists the tabs
   * this agent had open, so they come back as parked tabs: adoptable, and counted against the cap.
   */
  private async seed(): Promise<void> {
    if (this.seeded) return
    this.seeded = true
    const { list } = await this.deps.lease.state().catch(() => ({ list: [] }))
    const known = new Set<string>()
    for (const h of this.held.values()) if (h.id) known.add(h.id)
    for (const t of list ?? []) if (t.agent === this.deps.agentId && !known.has(t.id)) this.parked.set(t.id, t.url)
  }

  /** The check and the hold run in one step after the await, so a parallel call counts the slots this one holds. */
  private async slots<T>(extra: number, open: () => Promise<T>): Promise<T> {
    const { tabs } = await this.deps.lease.state()
    const others = Object.entries(tabs).reduce((n, [agent, c]) => (agent === this.deps.agentId ? n : n + c), 0)
    const over = () => others + Object.keys(this.tabs()).length + this.opening + extra - BROWSER.tabsPerBrowser
    if (over() > 0) await this.reclaim(over())
    if (over() > 0) throw new Busy(tabs)
    this.opening += extra
    try {
      return await open()
    } finally {
      this.opening -= extra
    }
  }

  /** A full browser first closes the tabs of this agent's workers that stopped calling. */
  private async reclaim(n: number): Promise<void> {
    const now = this.now()
    const free = [...this.held]
      .filter(([key, h]) => h.id && !this.running.get(key) && this.seen.has(key) && now - (this.seen.get(key) ?? 0) >= CLAIM_MS)
      .sort(([a], [b]) => (this.seen.get(a) ?? 0) - (this.seen.get(b) ?? 0))
      .map(([, h]) => h.id as string)
      .slice(0, n)
    if (!free.length) return
    const session = await this.socket()
    await Promise.all(free.map((id) => session.tab(id)?.close().catch(() => {})))
    for (const id of free) this.forget(id)
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
      act: async (step) => {
        const result = await tab.act(step)
        const notes = tab.takeNotes()
        if (notes.length) this.note = [...(this.note ? [this.note] : []), ...notes].join("\n")
        return result
      },
      screenshot: (opts) => tab.screenshot(opts),
      takeNotes: () => tab.takeNotes(),
      front: () => tab.front(),
      close: () => tab.close(),
    }
  }

  private park(scope: string): void {
    const cur = this.held.get(scope)
    if (cur?.id) this.parked.set(cur.id, cur.url)
  }

  private tabOf(held: Held, scope: string): Promise<Tab> {
    if (held.tab && this.session) return Promise.resolve(held.tab)
    held.opening ??= this.openHeld(held, scope).finally(() => {
      held.opening = undefined
    })
    return held.opening
  }

  private async openHeld(held: Held, scope: string): Promise<Tab> {
    const session = await this.socket()
    if (held.tab) return held.tab
    if (held.id) {
      const again = await session.attach(held.id).catch(() => undefined)
      if (again) {
        held.tab = this.track(held, again)
        return held.tab
      }
      held.id = undefined
    }
    return this.slots(1, async () => {
      const t = performance.now()
      const tab = this.track(held, await session.openTab(held.url))
      count("browser.open.ms", Math.round(performance.now() - t))
      // A new tab elsewhere during the open made this held non-current. Its tab must still count as the agent's, or the cap is not enforced.
      if (this.held.get(scope) !== held) this.parked.set(tab.id, held.url)
      held.id = tab.id
      held.tab = tab
      return tab
    })
  }

  /**
   * The scope's tab. A worker with none yet, such as a new worker after the human handed the browser back, takes the
   * agent's one free tab, so it carries on where the last worker stopped instead of loading the page again.
   */
  async currentTab(scope = ""): Promise<Tab | null> {
    const held = this.held.get(scope) ?? (await this.adoptFree(scope))
    return held ? this.tabOf(held, scope) : null
  }

  private async adoptFree(scope: string): Promise<Held | undefined> {
    await this.seed()
    const claimed = this.claimed(scope)
    const free = [...this.parked, ...[...this.held.values()].flatMap((h) => (h.id ? [[h.id, h.url] as const] : []))].filter(([id]) => !claimed.has(id))
    if (free.length !== 1) return undefined
    const [id, url] = free[0] as readonly [string, string]
    this.forget(id)
    const held: Held = { id, url }
    this.held.set(scope, held)
    return held
  }

  /** Opens `url` in the scope's tab, or in a new one when it has none. A tab that leaves the agent's pages is kept, not reused. */
  async goto(url: string, scope = ""): Promise<Tab> {
    const held = this.held.get(scope)
    if (held) {
      const tab = await this.tabOf(held, scope)
      const result = await tab.act({ op: "goto", url })
      if (!result.ok) throw new Error(`could not open ${url}: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`)
      held.url = url
      return tab
    }
    const fresh: Held = { url }
    this.held.set(scope, fresh)
    try {
      return await this.tabOf(fresh, scope)
    } catch (e) {
      if (this.held.get(scope) === fresh) this.held.delete(scope)
      throw e
    }
  }

  /** Reads a page in a tab of its own, closed as soon as it is read. The tab it opened in is not the scope's current tab. */
  async borrow(urls: readonly string[]): Promise<{ tabs: Tab[]; done: () => Promise<void> }> {
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

  /** Brings the scope's tab to the front of the live view, so a human who takes control lands on the page that needs them. */
  async front(scope = ""): Promise<void> {
    const own = Object.keys(this.tabs())
    const id = this.held.get(scope)?.id ?? (own.length === 1 ? own[0] : undefined)
    if (!id) return
    const session = await this.socket()
    await (session.tab(id) ?? (await session.attach(id)))?.front()
  }

  /** The tabs other workers of this agent are on: in a call now, or within the last `CLAIM_MS`. */
  private claimed(scope: string): Set<string> {
    const now = this.now()
    const ids = new Set<string>()
    for (const [key, h] of this.held) {
      if (key === scope || !h.id) continue
      const at = this.seen.get(key)
      if ((this.running.get(key) ?? 0) > 0 || at === undefined || now - at < CLAIM_MS) ids.add(h.id)
    }
    return ids
  }

  /**
   * Closes every tab this agent holds and drops its claim from the lease, so the room's browser chip goes away. The
   * browser, its profile and its logins stay for the next run. A human in control keeps the tabs: they are mid-task.
   * Safe to call with no tab, and more than once: the second call finds nothing to close.
   */
  async release(): Promise<number> {
    const state = await this.deps.lease.state()
    // A human in control is mid-task: their tabs stay where they left them.
    if (state.takeover) return 0
    const own = (state.list ?? []).filter((t) => t.agent === this.deps.agentId).map((t) => t.id)
    const ids = [...new Set([...Object.keys(this.tabs()), ...own])]
    if (!ids.length) return 0
    // A browser this agent already holds is worth a socket, so its tabs really close; never create one to close nothing.
    const session = this.session ?? (own.length ? await this.socket().catch(() => null) : null)
    for (const id of ids) {
      const tab = session?.tab(id) ?? (await session?.attach(id).catch(() => undefined))
      await tab?.close().catch(() => {})
      this.forget(id)
    }
    await this.deps.lease.touch({}).catch(() => false)
    return ids.length
  }

  private forget(id: string): void {
    this.borrowed.delete(id)
    this.parked.delete(id)
    for (const [key, h] of this.held) if (h.id === id) this.held.delete(key)
  }

  /**
   * Closes the socket and keeps every tab. A worker waiting on its model, or on the human holding the browser, must come
   * back to the same page: closing the tabs here is what lost a half-done Gmail session. The tabs end when the agent's
   * run ends, when a full browser reclaims them, or when the user's browser closes after 24 hours unused.
   */
  async idle(): Promise<"busy" | "closed"> {
    if (this.busy > 0) {
      await this.deps.idle.arm(this.now() + IDLE_CLOSE_MS)
      return "busy"
    }
    const session = this.session
    this.session = null
    for (const h of this.held.values()) h.tab = undefined
    await session?.close().catch(() => {})
    return "closed"
  }
}
