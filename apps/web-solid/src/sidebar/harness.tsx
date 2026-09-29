import { ThemeProvider } from "@kiko/ui"
import { applyThemePalette, BUILT_IN_THEMES } from "@kiko/ui/app-theme"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { render } from "solid-js/web"
import "./harness.css"
import { BOTS, GROUPS } from "../lib/fixtures"
import type { BotPresence, RosterBot } from "../lib/types"
import Sidebar from "./sidebar"
import { orderRoster, type RosterRecord } from "./roster-logic"
import "./sidebar.css"

const searchRecords = (): RosterRecord[] =>
  roster.bots.map((bot) => ({
    id: bot.id,
    name: bot.name,
    hay: `${bot.name}\n${bot.preview}`.toLowerCase(),
    updatedAt: bot.updatedAt,
    pinned: bot.pinned,
  }))

const params = new URLSearchParams(location.search)
const flag = (name: string) => params.get(name) === "1"
const scale = Number(params.get("scale") ?? 0)

const PRESENCES: readonly BotPresence[] = ["idle", "typing", "working", "sleeping"]
const WORDS = [
  "token bridge",
  "composer draft",
  "keyboard pass",
  "menu primitives",
  "avatar stack",
  "unread badge",
  "rail collapse",
  "search filter",
]

const seeded = flag("empty")
  ? []
  : (flag("pinned")
      ? BOTS.filter((bot) => !bot.pinned)
      : scale > BOTS.length
        ? scaledBots(scale)
        : [...BOTS]
    ).map((bot) => (flag("unread") ? { ...bot, unread: 0 } : bot))

const [roster, setRoster] = createStore<{ bots: RosterBot[] }>({ bots: seeded })
const groups = flag("empty") ? [] : GROUPS
const [activeThreadId, setActiveThreadId] = createSignal<string | null>(seeded[0]?.id ?? null)

const root = document.getElementById("root")
if (!root) throw new Error("Root element #root not found")

applyThemePalette(BUILT_IN_THEMES[0], "dark")

const actionLog: string[] = []

render(
  () => (
    <ThemeProvider>
      <Sidebar
        bots={roster.bots}
        groups={groups}
        activeThreadId={activeThreadId()}
        onSelectThread={setActiveThreadId}
        initialCollapsed={flag("rail")}
        onAction={(action, threadId) => actionLog.push(`${action.id}:${threadId}`)}
        onCreateAgent={() => actionLog.push("create-agent")}
        onCreateGroup={() => actionLog.push("create-group")}
      />
    </ThemeProvider>
  ),
  root,
)

const text = (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? null
const attribute = (selector: string, name: string) =>
  [...document.querySelectorAll(selector)].map((node) => node.getAttribute(name))
const indexOf = (id: string) => roster.bots.findIndex((bot) => bot.id === id)
const mutations = { count: 0, names: [] as string[] }
const observer = new MutationObserver((records) => {
  mutations.count += records.length
  for (const record of records) mutations.names.push(record.attributeName ?? record.type)
})

Object.assign(window, {
  __sidebar: {
    setActiveThreadId,
    activeThreadId: () => activeThreadId(),
    scale: () => roster.bots.length,
    rows: () => document.querySelectorAll('[data-component="sidebar-row"]').length,
    railItems: () => document.querySelectorAll('[data-component="sidebar-rail-item"]').length,
    headers: () =>
      [...document.querySelectorAll('[data-slot="sidebar-section-header"]')].map(
        (node) => node.textContent ?? "",
      ),
    names: () =>
      [...document.querySelectorAll('[data-slot="sidebar-row-name"]')].map(
        (node) => node.textContent ?? "",
      ),
    unread: () => attribute('[data-component="sidebar-row"]', "data-unread").map((v) => v !== null),
    presence: () => attribute('[data-component="sidebar-row"]', "data-presence"),
    active: () => attribute('[data-component="sidebar-row"]', "data-active").map((v) => v !== null),
    focused: () => document.activeElement?.getAttribute("data-component"),
    empty: () => text('[data-slot="sidebar-empty"]'),
    query: () =>
      (document.querySelector('[data-slot="text-input-v2-input"]') as HTMLInputElement | null)?.value ??
      null,
    sidebarToken: () =>
      getComputedStyle(document.documentElement).getPropertyValue("--kiko-sidebar").trim(),
    rowBackground: () => {
      const row = document.querySelector('[data-component="sidebar-row"]')
      return row ? getComputedStyle(row).backgroundColor : null
    },
    setPresence: (id: string, presence: BotPresence) => {
      const index = indexOf(id)
      if (index < 0) return false
      setRoster("bots", index, "presence", presence)
      return true
    },
    actionLog: () => actionLog.slice(),
    setUnread: (id: string, unread: number) => {
      const index = indexOf(id)
      if (index < 0) return false
      setRoster("bots", index, "unread", unread)
      return true
    },
    benchFilter: (query: string, runs: number) => {
      const records = searchRecords()
      const t0 = performance.now()
      for (let run = 0; run < runs; run++) orderRoster(records, GROUPS, query)
      return +((performance.now() - t0) / runs).toFixed(3)
    },
    watch: () => {
      const list = document.querySelector('[data-slot="sidebar-list"]')
      if (!list) return false
      observer.disconnect()
      mutations.count = 0
      mutations.names = []
      observer.observe(list, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      })
      return true
    },
    unwatch: async () => {
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, 0)
      await promise
      observer.disconnect()
      return { count: mutations.count, names: mutations.names }
    },
  },
})

function scaledBots(count: number): RosterBot[] {
  const out: RosterBot[] = [...BOTS]
  for (let index = out.length; index < count; index++) {
    const name = `${WORDS[index % WORDS.length]} ${index}`
    out.push({
      id: `synthetic-${index}`,
      name,
      preview: `${name} — generated row ${index} for the filter benchmark`,
      updatedAt: BOTS[index % BOTS.length].updatedAt - index * 60_000,
      presence: PRESENCES[index % PRESENCES.length],
      unread: index % 4,
      pinned: index % 7 === 0,
    })
  }
  return out
}
