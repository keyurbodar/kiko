import "../index.css"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "../../test/render"
import { FileBreadcrumbs } from "./breadcrumbs"
import { buildIndex } from "./model"

const PATH = "attachments/mvmm766u-notes.md"
const INDEX = buildIndex(
  [PATH, "attachments/k2j9x1aa-budget.csv", "docs/guides/setup.md"],
  ["docs", "docs/guides", "blank"],
)

function boxed(width = 520) {
  const container = document.createElement("div")
  container.style.width = `${width}px`
  container.style.display = "flex"
  return container
}

const currentCrumb = (container: HTMLElement) =>
  container.querySelector('[data-current-file-crumb="true"]') as HTMLElement | null

describe("file breadcrumbs", () => {
  it("keeps the scope crumb for a file at the root and marks the file current", async () => {
    await using screen = await render(() => (
      <FileBreadcrumbs
        current="plan.md"
        trail="plan.md"
        index={buildIndex(["plan.md"])}
        unsaved={false}
        onNavigateFolder={() => {}}
        onOpenFile={() => {}}
      />
    ))
    const nav = screen.getByRole("navigation", { name: "File path" })
    await expect.element(nav.getByText("Files", { exact: true })).toBeVisible()
    await expect.element(nav.getByText("plan.md")).toBeVisible()
    expect(currentCrumb(screen.container)?.textContent).toContain("plan.md")
  })

  it("navigates to a folder when its name is pressed, not when the chevron is", async () => {
    const onNavigateFolder = vi.fn()
    await using screen = await render(() => (
      <FileBreadcrumbs
        current={PATH}
        trail={PATH}
        index={INDEX}
        unsaved={false}
        onNavigateFolder={onNavigateFolder}
        onOpenFile={() => {}}
      />
    ))
    const nav = screen.getByRole("navigation", { name: "File path" })
    await expect.element(nav).not.toHaveTextContent("mvmm766u")
    await screen.getByRole("button", { name: "From this chat" }).click()
    expect(onNavigateFolder).toHaveBeenCalledWith("attachments")
  })

  it("opens the folder menu from the chevron and checks the current file", async () => {
    const onOpenFile = vi.fn()
    await using screen = await render(() => (
      <FileBreadcrumbs
        current={PATH}
        trail={PATH}
        index={INDEX}
        unsaved={false}
        onNavigateFolder={() => {}}
        onOpenFile={onOpenFile}
      />
    ))
    await screen.getByRole("button", { name: "Browse From this chat" }).click()
    const menu = page.getByRole("menu")
    await expect.element(menu).toBeVisible()
    await expect.element(menu.getByText("budget.csv")).toBeVisible()
    expect(menu.getByRole("menuitemradio", { name: /notes\.md/ })).toHaveAttribute("aria-checked", "true")
    await menu.getByText("budget.csv").click()
    expect(onOpenFile).toHaveBeenCalledWith("attachments/k2j9x1aa-budget.csv")
  })

  it("drills into a folder without closing and ArrowLeft walks back to the crumb", async () => {
    await using screen = await render(() => (
      <FileBreadcrumbs
        current="docs/guides/setup.md"
        trail="docs/guides/setup.md"
        index={INDEX}
        unsaved={false}
        onNavigateFolder={() => {}}
        onOpenFile={() => {}}
      />
    ))
    await screen.getByRole("button", { name: "Browse docs" }).click()
    const menu = page.getByRole("menu")
    await menu.getByRole("menuitem", { name: "guides" }).click()
    await expect.element(menu.getByRole("menuitem", { name: "Back to docs" })).toBeVisible()
    await expect.element(menu.getByText("setup.md")).toBeVisible()
    const content = screen.container.ownerDocument.querySelector('[role="menu"]')!
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    await expect.element(menu.getByRole("menuitem", { name: "guides" })).toBeVisible()
    await expect.element(menu.getByRole("menuitem", { name: /Back to/ })).not.toBeInTheDocument()
  })

  it("says the folder is empty while browsing below the crumb", async () => {
    await using screen = await render(() => (
      <FileBreadcrumbs
        current="docs/guides/setup.md"
        trail="docs/guides/setup.md"
        index={INDEX}
        unsaved={false}
        onNavigateFolder={() => {}}
        onOpenFile={() => {}}
      />
    ))
    await screen.getByRole("button", { name: "Browse Files" }).click()
    const menu = page.getByRole("menu")
    await menu.getByRole("menuitem", { name: "blank" }).click()
    await expect.element(menu.getByText("This folder is empty.")).toBeVisible()
  })

  it("closes and resets the menu when the path changes", async () => {
    const [current, setCurrent] = createSignal(PATH)
    await using screen = await render(() => (
      <FileBreadcrumbs
        current={current()}
        trail={current()}
        index={INDEX}
        unsaved={false}
        onNavigateFolder={() => {}}
        onOpenFile={() => {}}
      />
    ))
    await screen.getByRole("button", { name: "Browse From this chat" }).click()
    await expect.element(page.getByRole("menu")).toBeVisible()
    setCurrent("docs/guides/setup.md")
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument()
    expect(currentCrumb(screen.container)?.textContent).toContain("setup.md")
  })

  it("shows the folder as current with the trail below it", async () => {
    const onOpenFile = vi.fn()
    await using screen = await render(() => (
      <FileBreadcrumbs
        current="docs"
        trail="docs/guides/setup.md"
        index={INDEX}
        unsaved={false}
        onNavigateFolder={() => {}}
        onOpenFile={onOpenFile}
      />
    ))
    expect(currentCrumb(screen.container)?.textContent).toContain("docs")
    const setup = screen.getByRole("button", { name: "setup.md" })
    await expect.element(setup).toBeVisible()
    expect(setup).toHaveAttribute("data-descendant")
    await setup.click()
    expect(onOpenFile).toHaveBeenCalledWith("docs/guides/setup.md")
  })

  it("scrolls a deep path instead of clipping it, keeping the current crumb in view", async () => {
    const path = "a/b/c/d/e/f/g/plan.md"
    const index = buildIndex([path], ["a", "a/b", "a/b/c", "a/b/c/d", "a/b/c/d/e", "a/b/c/d/e/f", "a/b/c/d/e/f/g"])
    await using screen = await render(
      () => (
        <FileBreadcrumbs
          current={path}
          trail={path}
          index={index}
          unsaved={false}
          onNavigateFolder={() => {}}
          onOpenFile={() => {}}
        />
      ),
      { container: boxed(220) },
    )
    const scroller = screen.container.querySelector(".fb-scroll") as HTMLElement
    await expect.poll(() => scroller.scrollWidth > scroller.clientWidth).toBe(true)
    await expect.poll(() => scroller.getAttribute("data-fade")?.includes("start") ?? false).toBe(true)
    const current = currentCrumb(screen.container)!
    const view = scroller.getBoundingClientRect()
    const crumb = current.getBoundingClientRect()
    expect(crumb.left).toBeGreaterThanOrEqual(view.left - 1)
    expect(crumb.right).toBeLessThanOrEqual(view.right + 1)
  })
})
