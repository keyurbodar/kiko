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

const rowOf = (container: HTMLElement, path: string) =>
  container.querySelector(`[data-path="${path}"]`) as HTMLElement | null

const scrollerOf = (container: HTMLElement) => container.querySelector(".kt-scroller") as HTMLElement

const nameInput = (container: HTMLElement) => container.querySelector(".ft-input") as HTMLInputElement

describe("file tree", () => {
  it("walks the rows with the arrow keys, jumps with type-ahead and opens with Enter", async () => {
    const onOpen = vi.fn()
    await using screen = await render(
      () => <FileTree roomId="keys" files={[ref("a.md"), ref("b.md"), ref("c.md")]} onOpen={onOpen} />,
      { container: boxed() },
    )
    await expect.element(screen.getByRole("treeitem", { name: "a.md" })).toBeVisible()
    const tree = screen.container.querySelector('[role="tree"]') as HTMLElement
    tree.focus()
    await userEvent.keyboard("{ArrowDown}")
    await expect.element(screen.getByRole("treeitem", { name: "b.md" })).toHaveAttribute("data-focused", "true")
    await userEvent.keyboard("{ArrowDown}{ArrowUp}")
    await expect.element(screen.getByRole("treeitem", { name: "b.md" })).toHaveAttribute("data-focused", "true")
    await userEvent.keyboard("c")
    await expect.element(screen.getByRole("treeitem", { name: "c.md" })).toHaveAttribute("data-focused", "true")
    await userEvent.keyboard("{Enter}")
    expect(onOpen).toHaveBeenCalledWith("c.md")
  })

  it("folds with the arrow keys and opens a whole subtree with Alt-click", async () => {
    await using screen = await render(
      () => (
        <FileTree
          roomId="fold"
          files={[ref("docs/one.md"), ref("docs/deep/plan.md")]}
          folders={["docs", "docs/deep"]}
        />
      ),
      { container: boxed() },
    )
    await expect.element(screen.getByRole("treeitem", { name: "docs" })).toBeVisible()
    await userEvent.click(rowOf(screen.container, "docs/")!, { modifiers: ["Alt"] })
    await expect.element(screen.getByRole("treeitem", { name: "deep" })).toBeVisible()
    await expect.element(screen.getByRole("treeitem", { name: "plan.md" })).toBeVisible()
    await userEvent.click(rowOf(screen.container, "docs/")!, { modifiers: ["Alt"] })
    await expect.element(screen.getByRole("treeitem", { name: "deep" })).not.toBeInTheDocument()
    await userEvent.click(rowOf(screen.container, "docs/")!)
    await expect.element(screen.getByRole("treeitem", { name: "deep" })).toBeVisible()
    await expect.element(screen.getByRole("treeitem", { name: "plan.md" })).not.toBeInTheDocument()
    const tree = screen.container.querySelector('[role="tree"]') as HTMLElement
    tree.focus()
    await userEvent.keyboard("{ArrowRight}")
    await expect.element(screen.getByRole("treeitem", { name: "deep" })).toHaveAttribute("data-focused", "true")
    await userEvent.keyboard("{ArrowRight}")
    await expect.element(screen.getByRole("treeitem", { name: "plan.md" })).toBeVisible()
    await userEvent.keyboard("{ArrowLeft}")
    await expect.element(screen.getByRole("treeitem", { name: "plan.md" })).not.toBeInTheDocument()
  })

  it("keeps the file at the top of the viewport when one arrives above it", async () => {
    const files = createSignal(Array.from({ length: 40 }, (_, index) => ref(`f${String(index).padStart(2, "0")}.md`)))
    await using screen = await render(() => <FileTree roomId="anchor" files={files[0]()} />, {
      container: boxed(),
    })
    await expect.element(screen.getByRole("treeitem", { name: "f10.md" })).toBeVisible()
    const scroller = scrollerOf(screen.container)
    scroller.scrollTop = 280
    scroller.dispatchEvent(new Event("scroll"))
    files[1]([ref("a-first.md"), ...files[0]()])
    await expect.poll(() => scroller.scrollTop).toBe(308)
    const top = [...screen.container.querySelectorAll(".ft-row")].find(
      (row) => row.getBoundingClientRect().top >= scroller.getBoundingClientRect().top - 1,
    )
    expect(top?.getAttribute("data-path")).toBe("f10.md")
    const dot = rowOf(screen.container, "a-first.md")!.querySelector(".ft-dot[data-on]")
    expect(dot).not.toBeNull()
    await userEvent.click(rowOf(screen.container, "a-first.md")!)
    expect(rowOf(screen.container, "a-first.md")!.querySelector(".ft-dot[data-on]")).toBeNull()
  })

  it("renames a file from the context menu", async () => {
    const onRename = vi.fn()
    await using screen = await render(() => <FileTree roomId="menu" files={[ref("a.md")]} onRename={onRename} />, {
      container: boxed(),
    })
    await userEvent.click(rowOf(screen.container, "a.md")!, { button: "right" })
    await page.getByRole("menuitem", { name: "Rename" }).click()
    const input = nameInput(screen.container)
    await expect.poll(() => document.activeElement === input).toBe(true)
    await userEvent.clear(input)
    await userEvent.type(input, "z.md{Enter}")
    expect(onRename).toHaveBeenCalledWith("a.md", "z.md", ["a.md"])
    await expect.element(screen.getByRole("treeitem", { name: "z.md" })).toBeVisible()
  })

  it("asks before deleting a file from the context menu", async () => {
    const onDelete = vi.fn()
    await using screen = await render(() => <FileTree roomId="delete" files={[ref("a.md")]} onDelete={onDelete} />, {
      container: boxed(),
    })
    await userEvent.click(rowOf(screen.container, "a.md")!, { button: "right" })
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await expect.element(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: "Delete" }).click()
    expect(onDelete).toHaveBeenCalledWith("a.md", ["a.md"])
  })

  it("starts a reference drag from a folder row as well as a file row", async () => {
    await using screen = await render(
      () => <FileTree roomId="drag" files={[ref("docs/a.md"), ref("root.md")]} folders={["docs"]} />,
      { container: boxed() },
    )
    await expect.element(screen.getByRole("treeitem", { name: "docs" })).toBeVisible()
    const dragOf = (path: string) => {
      const data = new DataTransfer()
      rowOf(screen.container, path)!.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }),
      )
      return droppedFilePath(data)
    }
    expect(dragOf("docs/")).toBe("docs/")
    expect(dragOf("root.md")).toBe("root.md")
  })

  it("starts a new file inside a folder from the context menu", async () => {
    const onNewFile = vi.fn()
    await using screen = await render(
      () => <FileTree roomId="new" files={[ref("docs/a.md")]} folders={["docs"]} onNewFile={onNewFile} />,
      { container: boxed() },
    )
    await userEvent.click(rowOf(screen.container, "docs/")!, { button: "right" })
    await page.getByRole("menuitem", { name: "New file" }).click()
    const input = nameInput(screen.container)
    await expect.poll(() => input.value).toBe("untitled")
    await userEvent.clear(input)
    await userEvent.type(input, "plan.md{Enter}")
    expect(onNewFile).toHaveBeenCalledWith("docs/plan.md")
  })

  it("expands every folder from the toolbar and turns the toggle off when one is collapsed by hand", async () => {
    const [files, setFiles] = createSignal([ref("docs/one.md")])
    const [folders, setFolders] = createSignal(["docs"])
    await using screen = await render(() => <FileTree roomId="all" files={files()} folders={folders()} />, {
      container: boxed(),
    })
    await expect.element(screen.getByRole("treeitem", { name: "docs" })).toBeVisible()
    await screen.getByRole("button", { name: "Expand all folders" }).click()
    await expect.element(screen.getByRole("treeitem", { name: "one.md" })).toBeVisible()
    setFolders(["docs", "docs/deep"])
    setFiles([ref("docs/one.md"), ref("docs/deep/two.md")])
    await expect.element(screen.getByRole("treeitem", { name: "two.md" })).toBeVisible()
    await expect
      .element(screen.getByRole("button", { name: "Collapse all folders" }))
      .toHaveAttribute("aria-pressed", "true")
    await userEvent.click(rowOf(screen.container, "docs/")!)
    await expect.element(screen.getByRole("button", { name: "Expand all folders" })).toBeInTheDocument()
  })

  it("filters the tree and clears the search with Escape", async () => {
    await using screen = await render(() => <FileTree roomId="search" files={[ref("a.md"), ref("b.md")]} />, {
      container: boxed(),
    })
    const search = screen.getByRole("searchbox")
    await userEvent.type(search, "zz")
    await expect.element(search).toHaveValue("zz")
    await expect.element(screen.getByText("No files match")).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await expect.element(search).toHaveValue("")
    await expect.element(screen.getByRole("treeitem", { name: "a.md" })).toBeVisible()
  })

  it("opens the row menu from the more button with the file actions in order", async () => {
    const onOpenInNewTab = vi.fn()
    await using screen = await render(
      () => <FileTree roomId="more" files={[ref("a.md")]} onOpenInNewTab={onOpenInNewTab} />,
      { container: boxed() },
    )
    const more = rowOf(screen.container, "a.md")!.querySelector('[data-action="file-more"]') as HTMLElement
    await userEvent.click(more)
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
      await userEvent.click(rowOf(screen.container, "a.md")!, { button: "right" })
      await page.getByRole("menuitem", { name: "Add to chat" }).click()
      expect(received).toEqual([["a.md"]])
      dock.remove()
      await userEvent.click(rowOf(screen.container, "a.md")!, { button: "right" })
      await page.getByRole("menuitem", { name: "Add to chat" }).click()
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
      await userEvent.click(rowOf(screen.container, "docs/")!)
      await userEvent.click(rowOf(screen.container, "docs/a.md")!, { button: "right" })
      await page.getByRole("menuitem", { name: "Copy mention" }).click()
      expect(write).toHaveBeenCalledWith("[a.md](/docs/a.md)")
      await expect.element(page.getByText("Mention copied")).toBeVisible()
    } finally {
      write.mockRestore()
    }
  })

  it("reveals a file opened from elsewhere and leaves a tree click where it is", async () => {
    const files = Array.from({ length: 60 }, (_, index) => ref(`f${String(index).padStart(2, "0")}.md`))
    const [active, setActive] = createSignal<string | null>(null)
    const [revealId, setRevealId] = createSignal(0)
    const container = boxed()
    container.style.height = "280px"
    await using screen = await render(
      () => (
        <FileTree
          roomId="reveal"
          files={files}
          active={active()}
          revealId={revealId()}
          onOpen={(path) => {
            setActive(path)
            setRevealId(0)
          }}
        />
      ),
      { container },
    )
    setActive("f40.md")
    setRevealId(1)
    await expect.element(screen.getByRole("treeitem", { name: "f40.md" })).toHaveAttribute("aria-selected", "true")
    const scroller = scrollerOf(container)
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
    scroller.scrollTop = 0
    scroller.dispatchEvent(new Event("scroll"))
    await userEvent.click(rowOf(container, "f05.md")!)
    expect(scroller.scrollTop).toBe(0)
  })

  it("renames with F2 and asks before Backspace deletes", async () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()
    await using screen = await render(
      () => <FileTree roomId="keys" files={[ref("a.md")]} onRename={onRename} onDelete={onDelete} />,
      { container: boxed() },
    )
    const tree = screen.container.querySelector('[role="tree"]') as HTMLElement
    tree.focus()
    await userEvent.keyboard("{F2}")
    const input = nameInput(screen.container)
    await expect.poll(() => document.activeElement === input).toBe(true)
    await userEvent.clear(input)
    await userEvent.type(input, "b.md{Enter}")
    expect(onRename).toHaveBeenCalledWith("a.md", "b.md", ["a.md"])
    tree.focus()
    await userEvent.keyboard("{Backspace}")
    await expect.element(page.getByRole("dialog")).toBeVisible()
  })

  it("keeps folders open when a file inside them is renamed", async () => {
    const onRename = vi.fn()
    await using screen = await render(
      () => (
        <FileTree
          roomId="rename-deep"
          files={[ref("docs/one.md"), ref("docs/deep/two.md")]}
          folders={["docs", "docs/deep"]}
          onRename={onRename}
        />
      ),
      { container: boxed() },
    )
    await screen.getByRole("button", { name: "Expand all folders" }).click()
    await expect.element(screen.getByRole("treeitem", { name: "two.md" })).toBeVisible()
    await userEvent.click(rowOf(screen.container, "docs/one.md")!, { button: "right" })
    await page.getByRole("menuitem", { name: "Rename" }).click()
    const input = nameInput(screen.container)
    await userEvent.clear(input)
    await userEvent.type(input, "renamed.md{Enter}")
    expect(onRename).toHaveBeenCalledWith("docs/one.md", "docs/renamed.md", ["docs/one.md"])
    await expect.element(screen.getByRole("treeitem", { name: "renamed.md" })).toBeVisible()
    await expect.element(screen.getByRole("treeitem", { name: "two.md" })).toBeVisible()
  })
})
