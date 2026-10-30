import type { FileRef } from "@kiko/protocol"
import { ToastV2 } from "@kiko/ui/v2/toast-v2"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { receiveFileRefs } from "../composer/file-refs"
import { droppedFilePath } from "../lib/file-drag"
import { FileTree } from "./tree"

const ref = (name: string): FileRef => ({ id: name, name, size: 10, type: "text/markdown" })

function boxed() {
  const container = document.createElement("div")
  container.style.display = "flex"
  container.style.height = "420px"
  container.style.width = "320px"
  return container
}

const shadowOf = (container: HTMLElement) => container.querySelector("file-tree-container")?.shadowRoot ?? null

const rowOf = (container: HTMLElement, path: string) =>
  shadowOf(container)?.querySelector<HTMLElement>(`[data-item-path="${path}"]`) ?? null

const paths = (container: HTMLElement) =>
  [...(shadowOf(container)?.querySelectorAll("[data-item-path]") ?? [])].map((row) =>
    row.getAttribute("data-item-path"),
  )

const renameInput = (container: HTMLElement) =>
  shadowOf(container)?.querySelector<HTMLInputElement>("[data-item-rename-input]") ?? null

async function row(container: HTMLElement, path: string) {
  await expect.poll(() => rowOf(container, path)).not.toBeNull()
  return rowOf(container, path)!
}

const nameOf = (path: string) => path.replace(/\/$/, "").split("/").at(-1)!

const item = (name: string) => page.getByRole("treeitem", { name, exact: true })

async function menu(container: HTMLElement, path: string, label: string) {
  await row(container, path)
  await item(nameOf(path)).click({ button: "right" })
  await page.getByRole("menuitem", { name: label }).click()
}

async function rename(container: HTMLElement, name: string) {
  await expect
    .poll(() => renameInput(container) !== null && shadowOf(container)?.activeElement === renameInput(container))
    .toBe(true)
  await userEvent.keyboard(`{ControlOrMeta>}a{/ControlOrMeta}{Backspace}${name}{Enter}`)
}

describe("file tree", () => {
  it("opens a file when its row is clicked", async () => {
    const onOpen = vi.fn()
    await using screen = await render(
      () => <FileTree roomId="open" files={[ref("a.md"), ref("b.md")]} onOpen={onOpen} />,
      { container: boxed() },
    )
    await row(screen.container, "b.md")
    await item("b.md").click()
    expect(onOpen).toHaveBeenCalledWith("b.md")
  })

  it("renames a file from the context menu", async () => {
    const onRename = vi.fn()
    await using screen = await render(() => <FileTree roomId="menu" files={[ref("a.md")]} onRename={onRename} />, {
      container: boxed(),
    })
    await menu(screen.container, "a.md", "Rename")
    await rename(screen.container, "z.md")
    expect(onRename).toHaveBeenCalledWith("a.md", "z.md", ["a.md"])
    await expect.poll(() => paths(screen.container)).toContain("z.md")
  })

  it("renames a folder next to itself, not inside itself", async () => {
    const onRename = vi.fn()
    await using screen = await render(
      () => <FileTree roomId="rename-folder" files={[ref("docs/a.md")]} folders={["docs"]} onRename={onRename} />,
      { container: boxed() },
    )
    await menu(screen.container, "docs/", "Rename")
    await rename(screen.container, "guides")
    expect(onRename).toHaveBeenCalledWith("docs", "guides", ["docs/a.md"])
  })

  it("asks before deleting a file from the context menu", async () => {
    const onDelete = vi.fn()
    await using screen = await render(() => <FileTree roomId="delete" files={[ref("a.md")]} onDelete={onDelete} />, {
      container: boxed(),
    })
    await menu(screen.container, "a.md", "Delete")
    await expect.element(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: "Delete" }).click()
    expect(onDelete).toHaveBeenCalledWith("a.md", ["a.md"])
  })

  it("lists the file actions in order", async () => {
    const onOpenInNewTab = vi.fn()
    await using screen = await render(
      () => <FileTree roomId="more" files={[ref("a.md")]} onOpenInNewTab={onOpenInNewTab} />,
      { container: boxed() },
    )
    await row(screen.container, "a.md")
    await item("a.md").click({ button: "right" })
    await expect.element(page.getByRole("menuitem", { name: "Open in new tab" })).toBeVisible()
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())
    expect(items).toEqual([
      "Open",
      "Open in new tab",
      "Reveal in Files",
      "Add to chat",
      "Copy mention",
      "Copy path",
      "Download",
      "Rename",
      "Delete",
    ])
    await page.getByRole("menuitem", { name: "Open in new tab" }).click()
    expect(onOpenInNewTab).toHaveBeenCalledWith("a.md")
  })

  it("starts a new file inside a folder from the context menu", async () => {
    const onNewFile = vi.fn()
    await using screen = await render(
      () => <FileTree roomId="new" files={[ref("docs/a.md")]} folders={["docs"]} onNewFile={onNewFile} />,
      { container: boxed() },
    )
    await menu(screen.container, "docs/", "New file")
    await expect.poll(() => renameInput(screen.container)?.value).toBe("untitled")
    await rename(screen.container, "plan.md")
    expect(onNewFile).toHaveBeenCalledWith("docs/plan.md")
  })

  it("starts a reference drag from a folder row as well as a file row", async () => {
    await using screen = await render(
      () => <FileTree roomId="drag" files={[ref("docs/a.md"), ref("root.md")]} folders={["docs"]} />,
      { container: boxed() },
    )
    const dragOf = async (path: string) => {
      const data = new DataTransfer()
      ;(await row(screen.container, path)).dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, composed: true, cancelable: true, dataTransfer: data }),
      )
      return droppedFilePath(data)
    }
    expect(await dragOf("docs/")).toBe("docs/")
    expect(await dragOf("root.md")).toBe("root.md")
  })

  it("expands every folder from the toolbar and turns the toggle off when one is collapsed by hand", async () => {
    const [files, setFiles] = createSignal([ref("docs/one.md")])
    const [folders, setFolders] = createSignal(["docs"])
    await using screen = await render(() => <FileTree roomId="all" files={files()} folders={folders()} />, {
      container: boxed(),
    })
    await row(screen.container, "docs/")
    await screen.getByRole("button", { name: "Expand all folders" }).click()
    await row(screen.container, "docs/one.md")
    setFolders(["docs", "docs/deep"])
    setFiles([ref("docs/one.md"), ref("docs/deep/two.md")])
    await row(screen.container, "docs/deep/two.md")
    await expect
      .element(screen.getByRole("button", { name: "Collapse all folders" }))
      .toHaveAttribute("aria-pressed", "true")
    await item("docs").click()
    await expect.element(screen.getByRole("button", { name: "Expand all folders" })).toBeInTheDocument()
  })

  it("filters the tree and clears the search with Escape", async () => {
    await using screen = await render(() => <FileTree roomId="search" files={[ref("a.md"), ref("b.md")]} />, {
      container: boxed(),
    })
    await row(screen.container, "a.md")
    const search = screen.getByRole("searchbox")
    await userEvent.type(search, "zz")
    await expect.element(screen.getByText("No files match")).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await expect.element(search).toHaveValue("")
    await row(screen.container, "a.md")
  })

  it("adds a file to a mounted composer and toasts when there is none", async () => {
    const dock = document.createElement("div")
    dock.dataset.component = "composer-dock"
    document.body.append(dock)
    const received: string[][] = []
    const stop = receiveFileRefs((paths) => received.push([...paths]))
    try {
      await using screen = await render(
        () => (
          <>
            <ToastV2.Region />
            <FileTree roomId="chat" files={[ref("a.md")]} />
          </>
        ),
        { container: boxed() },
      )
      await menu(screen.container, "a.md", "Add to chat")
      expect(received).toEqual([["a.md"]])
      dock.remove()
      await menu(screen.container, "a.md", "Add to chat")
      await expect.element(page.getByText("Unable to add to chat")).toBeVisible()
    } finally {
      stop()
      dock.remove()
    }
  })

  it("copies a file mention with its path", async () => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
    try {
      await using screen = await render(
        () => (
          <>
            <ToastV2.Region />
            <FileTree roomId="mention" files={[ref("docs/a.md")]} folders={["docs"]} />
          </>
        ),
        { container: boxed() },
      )
      await row(screen.container, "docs/")
      await item("docs").click()
      await menu(screen.container, "docs/a.md", "Copy mention")
      expect(write).toHaveBeenCalledWith("[a.md](/docs/a.md)")
      await expect.element(page.getByText("Mention copied")).toBeVisible()
    } finally {
      write.mockRestore()
    }
  })

  it("selects a file opened from elsewhere", async () => {
    const files = Array.from({ length: 60 }, (_, index) => ref(`f${String(index).padStart(2, "0")}.md`))
    const [active, setActive] = createSignal<string | null>(null)
    const [revealId, setRevealId] = createSignal(0)
    await using screen = await render(
      () => <FileTree roomId="reveal" files={files} active={active()} revealId={revealId()} />,
      { container: boxed() },
    )
    await row(screen.container, "f00.md")
    setActive("f40.md")
    setRevealId(1)
    await expect.poll(() => rowOf(screen.container, "f40.md")?.getAttribute("aria-selected")).toBe("true")
  })

  it("asks before Backspace deletes the focused row", async () => {
    await using screen = await render(() => <FileTree roomId="keys" files={[ref("a.md")]} />, {
      container: boxed(),
    })
    await row(screen.container, "a.md")
    await item("a.md").click()
    await userEvent.keyboard("{Backspace}")
    await expect.element(page.getByRole("dialog")).toBeVisible()
  })
})
