import { dismissToastV2, ToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../test/render"
import type { RosterBot } from "../lib/types"
import "./sidebar.css"
import { closeChat } from "./actions"
import { ChatSections, type ChatSectionsProps } from "./chat-panel"
import type { Need } from "./needs"

const bot = (id: string, name: string, patch: Partial<RosterBot> = {}): RosterBot => ({
  id,
  name,
  preview: `${name} preview`,
  updatedAt: 1,
  presence: "idle",
  unread: 0,
  pinned: false,
  ...patch,
})

const quiet: Omit<ChatSectionsProps, "bots"> = {
  needs: new Map(),
  activeId: null,
  mainId: null,
  muted: new Set(),
  now: 1,
  loading: false,
}

const names = (container: ParentNode) =>
  [...container.querySelectorAll<HTMLElement>("[data-chat-id]")].map(
    (row) => row.querySelector(".chat-name")?.textContent,
  )

const sectionOf = (container: ParentNode, id: string) =>
  container.querySelector(`[data-chat-id="${id}"]`)?.closest("[data-section]")?.getAttribute("data-section")

describe("chat sections", () => {
  it("lifts chats that need the owner into a Needs you section with the ask as the preview", async () => {
    const retry = vi.fn()
    const needs = new Map<string, Need>([
      ["a", { kind: "ask", text: "Approve 4,200 refund to Rahul" }],
      ["g", { kind: "failed", text: "Could not reach Swiggy.", retry }],
    ])
    await using screen = await render(() => (
      <ChatSections {...quiet} needs={needs} bots={[bot("a", "Alpha"), bot("b", "Beta"), bot("g", "Gamma")]} />
    ))
    const section = screen.container.querySelector('[data-component="sidebar-needs"]') as HTMLElement
    await expect.element(screen.getByText("Needs you")).toBeVisible()
    expect(names(section)).toEqual(["Alpha", "Gamma"])
    expect(section.querySelector('[data-chat-id="a"]')?.textContent).toContain("Approve 4,200 refund to Rahul")
    expect(section.querySelector('[data-chat-id="a"]')?.hasAttribute("data-unread")).toBe(true)
    expect(sectionOf(screen.container, "b")).toBeUndefined()
    await screen.getByRole("button", { name: "Retry" }).click()
    expect(retry).toHaveBeenCalledOnce()
  })

  it("shows no Needs you section when nothing waits", async () => {
    await using screen = await render(() => <ChatSections {...quiet} bots={[bot("a", "Alpha")]} />)
    expect(screen.container.querySelector('[data-component="sidebar-needs"]')).toBeNull()
  })

  it("moves pinned chats into a Pinned section once the owner pins one besides the main chat", async () => {
    const [bots, setBots] = createSignal([bot("k", "Kiko", { pinned: true }), bot("a", "Alpha")])
    await using screen = await render(() => <ChatSections {...quiet} mainId="k" bots={bots()} />)
    expect(sectionOf(screen.container, "k")).toBeUndefined()
    setBots([bot("k", "Kiko", { pinned: true }), bot("a", "Alpha", { pinned: true })])
    expect(sectionOf(screen.container, "a")).toBe("pinned")
    expect(sectionOf(screen.container, "k")).toBe("pinned")
    await expect.element(screen.getByText("Pinned")).toBeVisible()
  })

  it("slides a chat to the top when it gets a new message and steps the others down", async () => {
    const [bots, setBots] = createSignal([bot("a", "Alpha"), bot("b", "Beta"), bot("c", "Gamma")])
    await using screen = await render(() => (
      <div class="sidebar-shell" style={{ height: "400px", display: "flex", "flex-direction": "column" }}>
        <ChatSections {...quiet} bots={bots()} />
      </div>
    ))
    await expect.element(screen.getByText("Gamma")).toBeVisible()
    const row = (id: string) => screen.container.querySelector(`[data-chat-id="${id}"]`) as HTMLElement
    const before = row("a").getAnimations().length
    setBots([bot("c", "Gamma", { unread: 1 }), bot("a", "Alpha"), bot("b", "Beta")])
    expect(names(screen.container)).toEqual(["Gamma", "Alpha", "Beta"])
    expect(row("c").getAnimations().length).toBeGreaterThan(0)
    expect(row("a").getAnimations().length).toBeGreaterThan(before)
    expect(row("c").hasAttribute("data-unread")).toBe(true)
  })

  it("hides read chats when the owner turns on the unread filter, and stays responsive", async () => {
    const [bots, setBots] = createSignal([bot("a", "Alpha"), bot("b", "Beta")])
    await using screen = await render(() => <ChatSections {...quiet} bots={bots()} />)
    await expect.element(screen.getByText("Beta")).toBeVisible()
    const filter = screen.container.querySelector('[data-component="sidebar-filter"]') as HTMLElement
    await screen.getByRole("button", { name: "Show unread only" }).click()
    await expect.element(screen.getByText("You're all caught up")).toBeVisible()
    expect(filter.getAttribute("aria-pressed")).toBe("true")
    expect(names(screen.container)).toEqual([])
    await screen.getByRole("button", { name: "Show all" }).click()
    expect(filter.getAttribute("aria-pressed")).toBe("false")
    expect(names(screen.container)).toEqual(["Alpha", "Beta"])
    setBots([bot("a", "Alpha"), bot("b", "Beta", { unread: 2 })])
    await screen.getByRole("button", { name: "Show unread only" }).click()
    expect(names(screen.container)).toEqual(["Beta"])
    await expect.element(screen.getByText("Unread", { exact: true }).first()).toBeVisible()
  })

  it("keeps working after a chat leaves its section", async () => {
    const [bots, setBots] = createSignal([bot("a", "Alpha"), bot("b", "Beta"), bot("c", "Gamma")])
    await using screen = await render(() => <ChatSections {...quiet} bots={bots()} />)
    await expect.element(screen.getByText("Gamma")).toBeVisible()
    setBots([bot("a", "Alpha"), bot("c", "Gamma")])
    expect(names(screen.container)).toEqual(["Alpha", "Gamma"])
    setBots([bot("a", "Alpha", { presence: "working" }), bot("c", "Gamma")])
    expect(sectionOf(screen.container, "a")).toBe("working")
    expect(names(screen.container)).toEqual(["Alpha", "Gamma"])
  })

  it("offers Undo in a toast when a chat is closed", async () => {
    await using screen = await render(() => <ToastV2.Region />)
    closeChat("not-a-chat", null)
    await expect.element(screen.getByText("Closed chat")).toBeVisible()
    await expect.element(screen.getByRole("button", { name: "Undo" })).toBeVisible()
    dismissToastV2()
  })
})
