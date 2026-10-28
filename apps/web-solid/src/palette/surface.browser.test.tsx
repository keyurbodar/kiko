import "../index.css"
import { describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import type { Choice } from "../commands/registry"
import type { Item } from "./model"
import type { FileEntry } from "./sources"
import { closePalette, filesFolder, openFolder, openPalette, paletteTab } from "./state"
import { PaletteSurface } from "./surface"
import type { TabData } from "./tabs"

const NOW = Date.UTC(2026, 9, 24, 12)

const ran: string[] = []

const chat = (id: string, title: string, from: string, detail: string, ago: number): Choice => ({
  id,
  title,
  chatId: id,
  from,
  detail,
  at: NOW - ago,
  actions: () => [
    { id: "open", title: "Open", icon: "chevron", run: () => ran.push(`open ${id}`) },
    { id: "pin", title: "Pin", icon: "pin", run: () => ran.push(`pin ${id}`) },
    { id: "delete", title: "Delete", icon: "trash", danger: true, run: () => ran.push(`delete ${id}`) },
  ],
  run: () => ran.push(`go ${id}`),
})

const command = (key: string, title: string): Item => ({ key, title, icon: "plus", run: () => ran.push(key) })

const file = (path: string, size: number): FileEntry => ({
  path,
  name: path,
  size,
  fileId: path,
  space: "room",
  home: false,
})

const source = (over: Partial<TabData> = {}): TabData => ({
  chats: [
    chat("tokyo", "Tokyo trip", "Kiko", "Asakusa View is the quietest", 1000),
    chat("march", "March invoices", "Beta", "All 6 invoices are paid", 3 * 24 * 60 * 60 * 1000),
  ],
  unread: [chat("needs.refund", "Alpha: approve refund", "Alpha", "Waiting for you", 0)],
  agents: [{ id: "kiko", title: "Kiko", seed: "kiko", detail: "Idle", meta: "Opus 5.5", run: () => ran.push("agent") }],
  recipes: [{ id: "r", title: "Morning briefing", group: "Yours", detail: "Daily", run: () => ran.push("recipe") }],
  settings: [{ id: "models", title: "Models", detail: "Connect providers", run: () => ran.push("settings") }],
  messages: [],
  files: [
    file("budget.xlsx", 2048),
    file("tokyo/receipts/hotel_receipt.jpg", 1_200_000),
    file("tokyo/receipts/jr_pass.pdf", 340_000),
    file("tokyo/notes.md", 2048),
  ],
  recent: ["budget.xlsx"],
  get folder() {
    return filesFolder()
  },
  commands: [command("chat.new", "New chat"), command("chat.model", "Choose model")],
  doCommands: [command("chat.new", "New chat"), command("chat.model", "Choose model")],
  agentDo: [],
  settingsDo: [],
  now: NOW,
  open: (entry) => ran.push(`file ${entry.path}`),
  enter: (path) => openFolder(path.split("/")),
  ...over,
})

let panelEl: HTMLElement | undefined
const panel = () => page.getByTestId("palette-panel")
const panelGone = () => {
  if (document.querySelector('[data-testid="palette-panel"]')) throw new Error("the panel is still in the document")
}
const tab = (name: string) => page.getByRole("tab", { name })

async function open(over?: Partial<TabData>) {
  openPalette()
  const screen = await render(() => <PaletteSurface source={source(over)} />)
  const field = page.getByRole("combobox")
  await expect.element(field).toBeVisible()
  panelEl = field
    .element()
    .closest<HTMLElement>('[data-component="palette"]')!
    .querySelector<HTMLElement>(".palette-panel")!
  return {
    async [Symbol.asyncDispose]() {
      closePalette()
      ran.length = 0
      await screen[Symbol.asyncDispose]()
    },
  }
}

describe("command palette", () => {
  it("opens on All with what needs you, recent chats and things to do", async () => {
    await using _screen = await open()
    await expect.element(page.getByText("Needs you")).toBeVisible()
    await expect.element(page.getByText("Recent", { exact: true })).toBeVisible()
    await expect.element(page.getByText("Tokyo trip")).toBeVisible()
    await expect.element(page.getByText("New chat")).toBeVisible()
    await expect.element(tab("All")).toHaveAttribute("aria-selected", "true")
  })

  it("changes tab with Tab and Shift+Tab without leaving the field", async () => {
    await using _screen = await open()
    await userEvent.keyboard("{Tab}")
    await expect.element(tab("Chats")).toHaveAttribute("aria-selected", "true")
    expect(paletteTab()).toBe("chats")
    await userEvent.keyboard("{Tab}{Tab}")
    await expect.element(tab("Files")).toHaveAttribute("aria-selected", "true")
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}")
    await expect.element(tab("Agents")).toHaveAttribute("aria-selected", "true")
    await expect.element(page.getByRole("combobox")).toHaveFocus()
  })

  it("slides one pill under the selected tab", async () => {
    await using _screen = await open()
    const tabs = page.getByRole("tablist")
    await expect.element(tabs).toContainHTML("translateX(12px)")
    await tab("Files").click()
    await expect.element(tabs).not.toContainHTML("translateX(12px)")
    expect(document.querySelectorAll(".palette-pill")).toHaveLength(1)
  })

  it("puts an Ask Kiko row first while typing and keeps the best result highlighted", async () => {
    await using _screen = await open()
    await userEvent.keyboard("tokyo")
    await expect.element(page.getByRole("button", { name: /^Ask Kiko:/ })).toBeVisible()
    await expect.element(page.getByRole("option", { name: /Tokyo trip/ })).toHaveAttribute("data-selected", "true")
  })

  it("keeps one active row: a pointer that has not moved never takes over from the keyboard", async () => {
    await using _screen = await open()
    const tokyo = page.getByRole("option", { name: /Tokyo trip/ })
    let last = { clientX: 0, clientY: 0 }
    const track = (e: PointerEvent) => (last = { clientX: e.clientX, clientY: e.clientY })
    document.addEventListener("pointermove", track, true)
    await tokyo.hover()
    document.removeEventListener("pointermove", track, true)
    await expect.element(tokyo).toHaveAttribute("data-selected", "true")
    await userEvent.keyboard("{ArrowDown}")
    await expect.element(tokyo).not.toHaveAttribute("data-selected", "true")
    const still = { bubbles: true, ...last }
    tokyo.element().dispatchEvent(new PointerEvent("pointermove", still))
    await expect.element(tokyo).not.toHaveAttribute("data-selected", "true")
    expect(document.querySelectorAll('[cmdk-item][data-selected="true"]')).toHaveLength(1)
    tokyo.element().dispatchEvent(new PointerEvent("pointermove", { ...still, clientX: still.clientX + 4 }))
    await expect.element(tokyo).toHaveAttribute("data-selected", "true")
    await userEvent.keyboard("{Enter}")
    expect(ran).toEqual(["go tokyo"])
  })

  it("shows the Enter hint only on the active row", async () => {
    await using _screen = await open()
    await page.getByRole("option", { name: /Tokyo trip/ }).hover()
    const shown = [...document.querySelectorAll<HTMLElement>(".palette-enter")].filter(
      (el) => getComputedStyle(el).display !== "none",
    )
    expect(shown).toHaveLength(1)
    expect(shown[0]!.closest("[cmdk-item]")).toHaveAttribute("data-selected", "true")
  })

  it("never ends in a dead end: no match offers to ask Kiko with the same words", async () => {
    await using _screen = await open()
    await userEvent.keyboard("sushi rokkon")
    await expect.element(page.getByText("No match for “sushi rokkon”")).toBeVisible()
    await expect.element(page.getByRole("button", { name: /Ask Kiko/ })).toBeVisible()
  })

  it("opens the actions of a chat beside the row with Alt+Enter and runs one", async () => {
    await using _screen = await open()
    await userEvent.keyboard("{Tab}")
    await userEvent.keyboard("{Alt>}{Enter}{/Alt}")
    const menu = page.getByRole("menu")
    await expect.element(menu).toBeVisible()
    await userEvent.keyboard("{ArrowDown}{Enter}")
    expect(ran).toEqual(["pin tokyo"])
    await vi.waitFor(panelGone)
  })

  it("closes only the actions on the first Escape and the palette on the second", async () => {
    await using _screen = await open()
    await userEvent.keyboard("{Tab}{Alt>}{Enter}{/Alt}")
    await expect.element(page.getByRole("menu")).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument()
    await expect.element(panel()).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await vi.waitFor(panelGone)
  })

  it("walks folders on the Files tab with the arrow keys and shows the path", async () => {
    await using _screen = await open()
    await tab("Files").click()
    await expect.element(page.getByText("Folders")).toBeVisible()
    await userEvent.keyboard("{ArrowDown}")
    await userEvent.keyboard("{ArrowRight}")
    await expect.element(page.getByRole("navigation", { name: "Folder path" })).toHaveTextContent("Filestokyo")
    await expect.element(page.getByText("notes.md")).toBeVisible()
    await userEvent.keyboard("{ArrowLeft}")
    await expect.element(page.getByText("Folders")).toBeVisible()
  })

  it("selects files with Space, shows the selection bar, and clears it before it closes", async () => {
    await using _screen = await open()
    await tab("Files").click()
    await userEvent.keyboard(" ")
    await expect.element(page.getByText("1 selected")).toBeVisible()
    await expect.element(page.getByRole("button", { name: "Download" })).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await expect.element(page.getByText("1 selected")).not.toBeInTheDocument()
    await expect.element(panel()).toBeVisible()
  })

  it("shows the panel at full opacity at once and eases only the backdrop in over 120 ms", async () => {
    await using _screen = await open()
    const scrim = document.querySelector<HTMLElement>(".palette-scrim")!
    const backdrop = getComputedStyle(scrim, "::before")
    expect(backdrop.animationDuration).toBe("0.12s")
    expect(getComputedStyle(panel().element()).animationName).toBe("none")
    expect(getComputedStyle(panel().element()).opacity).toBe("1")
  })

  it("hides the panel instantly on Escape while the backdrop fades out over 80 ms", async () => {
    await using _screen = await open()
    await userEvent.keyboard("{Escape}")
    const scrim = document.querySelector<HTMLElement>(".palette-scrim")
    if (scrim) {
      expect(scrim).toHaveAttribute("data-closing")
      expect(getComputedStyle(panelEl!).visibility).toBe("hidden")
      expect(getComputedStyle(scrim, "::before").animationDuration).toBe("0.08s")
    }
    await vi.waitFor(panelGone)
  })
})
