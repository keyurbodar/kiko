import "../index.css"
import { describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "../../test/render"
import { FileBreadcrumbs } from "./breadcrumbs"
import { buildIndex } from "./model"

const PATH = "attachments/mvmm766u-notes.md"

describe("file breadcrumbs", () => {
  it("names an attachment by its real name and calls its folder From this chat", async () => {
    const onOpen = vi.fn()
    await using screen = await render(() => (
      <FileBreadcrumbs
        path={PATH}
        index={buildIndex([PATH, "attachments/k2j9x1aa-budget.csv"])}
        unsaved={false}
        onOpen={onOpen}
      />
    ))
    const nav = screen.getByRole("navigation", { name: "File path" })
    await expect.element(nav).not.toHaveTextContent("mvmm766u")
    await expect.element(nav.getByText("notes.md")).toBeVisible()
    await expect.element(nav).not.toHaveTextContent("attachments")

    await screen.getByRole("button", { name: "Browse From this chat" }).click()
    const menu = page.getByRole("menu")
    await expect.element(menu.getByText("budget.csv")).toBeVisible()
    await expect.element(menu).not.toHaveTextContent("k2j9x1aa")
    await menu.getByText("budget.csv").click()
    expect(onOpen).toHaveBeenCalledWith("attachments/k2j9x1aa-budget.csv")
  })
})
