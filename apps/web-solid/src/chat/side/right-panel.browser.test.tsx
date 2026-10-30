import "../../index.css"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import RightPanel from "./right-panel"
import { activateSurface, closeAll, deskView, fixedSurface, openSurface, surfacesOf } from "./surfaces"

vi.mock("../../state/room", () => ({ room: { helpers: () => [], roomMembers: () => [] } }))

vi.mock("../info/sections", () => ({ roomMembers: () => [] }))

vi.mock("./panel-views", () => ({
  FilesView: () => <div>Files view</div>,
  MemoryView: () => <div>Memory view</div>,
  RoutinesView: () => <div>Routines view</div>,
  TasksPanelView: () => <div>Tasks view</div>,
  FileView: () => <div>File view</div>,
  HelperView: () => <div>Helper view</div>,
  AgentView: () => <div>Agent view</div>,
}))

const CHAT = "01900000-0000-7000-8000-0000000000bb"

const tabs = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-component="right-panel-tab"]')]

const press = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))

describe("right panel", () => {
  it("offers the launcher list when no surface is open", async () => {
    closeAll(CHAT)
    await using screen = await render(() => <RightPanel chatId={CHAT} onClose={() => {}} />)
    await expect.element(screen.getByRole("heading", { name: "Open a surface" })).toBeVisible()
    await expect.element(screen.getByRole("button", { name: "Files F" })).toBeVisible()
    await expect.element(screen.getByRole("button", { name: "Memory M" })).toBeVisible()
    expect(tabs(screen.container)).toHaveLength(0)
    closeAll(CHAT)
  })

  it("opens a tab from the launcher list and closes it from the tab", async () => {
    closeAll(CHAT)
    await using screen = await render(() => <RightPanel chatId={CHAT} onClose={() => {}} />)
    await screen.getByRole("button", { name: "Files F" }).click()
    await expect.element(screen.getByRole("tab", { name: /^Files/ })).toHaveAttribute("aria-selected", "true")
    await expect.element(screen.getByText("Files view")).toBeVisible()
    await screen.getByRole("button", { name: "Close Files" }).click()
    await expect.element(screen.getByRole("heading", { name: "Open a surface" })).toBeVisible()
    expect(surfacesOf(CHAT)).toHaveLength(0)
    closeAll(CHAT)
  })

  it("picks a surface with the letter hint in the launcher menu and focuses its tab", async () => {
    closeAll(CHAT)
    await using screen = await render(() => <RightPanel chatId={CHAT} onClose={() => {}} />)
    await screen.getByRole("button", { name: "Open a surface" }).click()
    await expect.element(screen.getByRole("menu", { name: "Open a surface" })).toBeVisible()
    press("m")
    await expect.element(screen.getByRole("tab", { name: /^Memory/ })).toHaveAttribute("aria-selected", "true")
    expect(deskView(CHAT)?.id).toBe("memory")
    await vi.waitFor(() => expect(document.activeElement?.getAttribute("data-surface")).toBe("memory"))
    closeAll(CHAT)
  })

  it("keeps the open surfaces as tabs and switches between them", async () => {
    closeAll(CHAT)
    openSurface(CHAT, fixedSurface("files"))
    openSurface(CHAT, fixedSurface("routines"))
    await using screen = await render(() => <RightPanel chatId={CHAT} onClose={() => {}} />)
    expect(tabs(screen.container).map((tab) => tab.dataset.surface)).toEqual(["files", "routines"])
    await screen.getByRole("tab", { name: /^Files/ }).click()
    expect(deskView(CHAT)?.id).toBe("files")
    await expect.element(screen.getByRole("tab", { name: /^Files/ })).toHaveAttribute("aria-selected", "true")
    activateSurface(CHAT, "routines")
    await expect.element(screen.getByRole("tab", { name: /^Routines/ })).toHaveAttribute("aria-selected", "true")
    closeAll(CHAT)
  })

  it("closes a tab on middle click", async () => {
    closeAll(CHAT)
    openSurface(CHAT, fixedSurface("files"))
    await using screen = await render(() => <RightPanel chatId={CHAT} onClose={() => {}} />)
    tabs(screen.container)[0]!.dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true }))
    await expect.element(screen.getByRole("heading", { name: "Open a surface" })).toBeVisible()
    expect(surfacesOf(CHAT)).toHaveLength(0)
    closeAll(CHAT)
  })
})
