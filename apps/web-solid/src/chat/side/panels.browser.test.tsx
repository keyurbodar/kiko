import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/solid-router"
import type { JSX } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import Desk from "./Desk"
import { PANELS, panelLabel } from "./panels"
import { agentSurface, closeAll, deskView, fixedSurface, openFile, openFiles, openSurface } from "./surfaces"

const CHAT = "01900000-0000-7000-8000-0000000000aa"

function routed(ui: () => JSX.Element) {
  const router = createRouter({
    routeTree: createRootRoute({ component: ui }),
    history: createMemoryHistory({ initialEntries: [`/chat/${CHAT}`] }),
  })
  return () => <RouterProvider router={router} />
}

const railButtons = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLButtonElement>('[data-component="desk-rail"] button'),
]

const railLabels = (container: HTMLElement) => railButtons(container).map((button) => button.getAttribute("aria-label"))

describe("chat details panel", () => {
  it("shows the rail and moves between the overview and the rail views, with Close always there", async () => {
    closeAll(CHAT)
    const onClose = vi.fn()
    await using screen = await render(routed(() => <Desk chatId={CHAT} onClose={onClose} />))
    await expect.element(screen.getByRole("button", { name: "Close chat details" })).toBeVisible()
    await expect.element(screen.getByRole("heading", { name: "This chat" })).toBeVisible()
    expect(railLabels(screen.container)).toEqual(["This chat", "Files", "Memory", "Routines"])
    await expect.element(screen.getByRole("button", { name: "This chat" })).toHaveAttribute("aria-pressed", "true")
    await screen.getByRole("button", { name: "Routines" }).click()
    await expect.element(screen.getByRole("heading", { name: "Routines" })).toBeVisible()
    await expect.element(screen.getByRole("button", { name: "Back" })).not.toBeInTheDocument()
    await expect.element(screen.getByRole("button", { name: "Routines" })).toHaveAttribute("aria-pressed", "true")
    await expect.element(screen.getByRole("button", { name: "This chat" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.container.querySelector('[data-component="sidecar-body"]')?.getAttribute("data-kind")).toBe(
      "routines",
    )
    await screen.getByRole("button", { name: "This chat" }).click()
    expect(deskView(CHAT)).toBeNull()
    await expect.element(screen.getByRole("heading", { name: "This chat" })).toBeVisible()
    await screen.getByRole("button", { name: "Close chat details" }).click()
    expect(onClose).toHaveBeenCalledOnce()
    closeAll(CHAT)
  })

  it("goes back from a member page to the overview", async () => {
    closeAll(CHAT)
    await using screen = await render(routed(() => <Desk chatId={CHAT} onClose={() => {}} />))
    openSurface(CHAT, agentSurface("scout"))
    await screen.getByRole("button", { name: "Back" }).click()
    expect(deskView(CHAT)).toBeNull()
    closeAll(CHAT)
  })

  it("renders the file tree on the Files view without a second header or a tree toggle", async () => {
    closeAll(CHAT)
    await using screen = await render(routed(() => <Desk chatId={CHAT} onClose={() => {}} />))
    openSurface(CHAT, fixedSurface("files"))
    await expect.element(screen.getByRole("heading", { name: "Files" })).toBeVisible()
    expect(screen.container.querySelector('[data-component="desk-head"]')).not.toBeNull()
    expect(screen.container.querySelector('[data-component="desk-rail"]')).not.toBeNull()
    expect(screen.container.querySelector('[data-component="files-panel-header"]')).toBeNull()
    expect(screen.container.querySelector('[data-action="toggle-file-tree"]')).toBeNull()
    await expect.element(screen.getByRole("searchbox", { name: "Search files" })).toBeVisible()
    expect(screen.container.querySelector('[data-component="file-tree"]')).not.toBeNull()
    closeAll(CHAT)
  })

  it("shows file tabs only once two files are open, and Back returns to the Files list", async () => {
    closeAll(CHAT)
    await using screen = await render(routed(() => <Desk chatId={CHAT} onClose={() => {}} />))
    openFile(CHAT, "attachments/mvmm766u-notes.md")
    await expect.element(screen.getByRole("heading", { name: "notes.md" })).toBeVisible()
    await expect.element(screen.getByRole("tablist")).not.toBeInTheDocument()
    openFile(CHAT, "plan.md")
    await expect.element(screen.getByRole("tab", { name: /notes\.md/ })).toBeVisible()
    await expect.element(screen.getByRole("tab", { name: /plan\.md/ })).toHaveAttribute("aria-selected", "true")
    await expect.element(screen.getByRole("button", { name: "Close notes.md" })).toBeVisible()
    await screen.getByRole("button", { name: "Back" }).click()
    expect(deskView(CHAT)?.id).toBe("files")
    await expect.element(screen.getByRole("button", { name: "Files" })).toHaveAttribute("aria-pressed", "true")
    expect(openFiles(CHAT)).toHaveLength(2)
    await screen.getByRole("button", { name: "This chat" }).click()
    expect(deskView(CHAT)).toBeNull()
    await screen.getByRole("button", { name: "Files" }).click()
    expect(deskView(CHAT)?.id).toBe("files")
    closeAll(CHAT)
  })

  it("labels panels from their own fields, with file names free of storage prefixes", () => {
    expect(panelLabel(fixedSurface("memory"))).toBe(PANELS.memory.label)
    openFile(CHAT, "attachments/mvmm766u-budget.csv")
    expect(openFiles(CHAT)[0]?.id).toBe("file:attachments/mvmm766u-budget.csv")
    expect(panelLabel(openFiles(CHAT)[0]!)).toBe("budget.csv")
    expect(panelLabel(agentSurface("scout"))).toBe("scout")
    closeAll(CHAT)
  })
})
