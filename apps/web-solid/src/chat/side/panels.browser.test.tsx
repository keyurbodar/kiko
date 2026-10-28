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

describe("chat details panel", () => {
  it("puts the file tree under a full-width header, with no rail or toggle", async () => {
    closeAll(CHAT)
    const onClose = vi.fn()
    await using screen = await render(routed(() => <Desk chatId={CHAT} onClose={onClose} />))
    openSurface(CHAT, fixedSurface("files"))
    await expect.element(screen.getByRole("heading", { name: "Files" })).toBeVisible()
    await expect.element(screen.getByRole("button", { name: "Filter files" })).toBeVisible()
    await expect.element(screen.getByRole("button", { name: "File options" })).toBeVisible()
    expect(screen.container.querySelector('[data-component="desk-rail"]')).toBeNull()
    expect(screen.container.querySelector('[data-component="desk-head"]')).toBeNull()
    expect(screen.container.querySelector('[data-component="files-panel-header"]')).not.toBeNull()
    expect(screen.container.querySelector('[data-component="files-split"]')).toBeNull()
    expect(screen.container.querySelector('[data-component="files-tree-rail"]')).toBeNull()
    expect(screen.container.querySelector('[data-component="file-tree"]')).not.toBeNull()
    expect(screen.container.querySelector('[data-action="toggle-file-tree"]')).toBeNull()
    await expect.element(screen.getByRole("searchbox", { name: "Search files" })).toBeVisible()
    await screen.getByRole("button", { name: "Close chat details" }).click()
    await expect.poll(() => onClose.mock.calls.length).toBe(1)
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

  it("shows file tabs only once two files are open", async () => {
    closeAll(CHAT)
    await using screen = await render(routed(() => <Desk chatId={CHAT} onClose={() => {}} />))
    openFile(CHAT, "attachments/mvmm766u-notes.md")
    await expect.element(screen.getByRole("heading", { name: "Files" })).toBeVisible()
    expect(deskView(CHAT)?.id).toBe("file:attachments/mvmm766u-notes.md")
    await expect.element(screen.getByRole("tablist")).not.toBeInTheDocument()
    openFile(CHAT, "plan.md")
    await expect.element(screen.getByRole("tab", { name: /notes\.md/ })).toBeVisible()
    await expect.element(screen.getByRole("tab", { name: /plan\.md/ })).toHaveAttribute("aria-selected", "true")
    await expect.element(screen.getByRole("button", { name: "Close notes.md" })).toBeVisible()
    expect(openFiles(CHAT)).toHaveLength(2)
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
