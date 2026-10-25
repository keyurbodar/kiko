import type { AgentSlug, FileRef } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "../../test/render"
import { fakeTimers } from "../../test/timers"
import { type CardFile, FileCard } from "./card"

const NOW = Date.UTC(2026, 9, 25, 12)

const file = (name: string): FileRef => ({ id: `id-${name}`, name, size: 10, type: "" })

const card = (name: string, extra: Partial<CardFile> = {}): CardFile => ({
  space: "home",
  file: file(name),
  name,
  type: "archive",
  madeBy: null,
  maker: null,
  at: NOW - 12 * 60_000,
  where: "your files",
  ...extra,
})

describe("FileCard", () => {
  it("shows the maker as a mascot and the relative time, with where it was made in the tooltip", async () => {
    using _timers = fakeTimers()
    vi.setSystemTime(NOW)
    const entry = card("plan.zip", { madeBy: "kiko" as AgentSlug, maker: "Kiko", where: "Trip" })
    await using screen = await render(() => <FileCard entry={entry} onOpen={() => {}} />)
    const open = screen.getByRole("button", { name: "plan.zip" })
    expect(open.element().getAttribute("title")).toBe("Kiko made it in Trip")
    expect(open.element().textContent).toContain("12m ago")
    expect(open.element().textContent).not.toContain("made it")
    expect(screen.container.querySelector('[data-component="identity-avatar"][data-seed="kiko"]')).not.toBeNull()
  })

  it("shows no avatar for the owner's own files", async () => {
    await using screen = await render(() => <FileCard entry={card("notes.zip")} onOpen={() => {}} />)
    await expect.element(screen.getByRole("button", { name: "notes.zip" })).toHaveAttribute("title", "your files")
    expect(screen.container.querySelector('[data-component="identity-avatar"]')).toBeNull()
  })

  it("opens on click and offers the file for saving", async () => {
    const onOpen = vi.fn()
    await using screen = await render(() => <FileCard entry={card("backup.zip")} onOpen={onOpen} />)
    await screen.getByRole("button", { name: "backup.zip" }).click()
    expect(onOpen).toHaveBeenCalledOnce()
    await expect
      .element(screen.getByRole("link", { name: "Save backup.zip" }))
      .toHaveAttribute("download", "backup.zip")
  })

  it("falls back to the type icon for files it cannot preview", async () => {
    await using screen = await render(() => <FileCard entry={card("backup.zip")} onOpen={() => {}} />)
    const sheet = screen.container.querySelector(".file-card-sheet")!
    await expect.element(page.elementLocator(sheet)).not.toHaveAttribute("data-drawn")
    expect(sheet.querySelector('[data-component="file-icon"]')).not.toBeNull()
  })
})
