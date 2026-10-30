import "../index.css"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import type { RosterBot } from "../lib/types"
import { Composer } from "./composer"
import { clearDraftFiles } from "./rich/draft-files"

const ROOM = "01900000-0000-7000-8000-000000000052"
const MB = 1024 * 1024

class FakeXhr {
  static sent: FakeXhr[] = []
  readonly upload = new EventTarget()
  private readonly events = new EventTarget()
  status = 0
  responseText = ""
  timeout = 0
  open() {}
  setRequestHeader() {}
  addEventListener(type: string, listener: EventListener) {
    this.events.addEventListener(type, listener)
  }
  send() {
    FakeXhr.sent.push(this)
  }
  abort() {}
  fail() {
    this.events.dispatchEvent(new Event("error"))
  }
  progress(loaded: number, total: number) {
    this.upload.dispatchEvent(new ProgressEvent("progress", { lengthComputable: true, loaded, total }))
  }
  finish() {
    this.status = 200
    this.responseText = "{}"
    this.events.dispatchEvent(new Event("load"))
  }
}

const BOTS: RosterBot[] = [
  { id: "kiko", name: "Kiko", preview: "", updatedAt: 0, presence: "idle", unread: 0, pinned: false },
]

function fakeXhr() {
  FakeXhr.sent = []
  vi.stubGlobal("XMLHttpRequest", FakeXhr)
  return { [Symbol.dispose]: () => void vi.unstubAllGlobals() }
}

async function mountComposer(onSend: (body: string) => void = () => {}) {
  await clearDraftFiles(ROOM)
  const screen = await render(() => (
    <Composer threadId={ROOM} bots={BOTS} onSend={(message) => void onSend(message.body)} />
  ))
  await expect.poll(() => screen.container.querySelector(".ProseMirror"), { timeout: 10_000 }).not.toBeNull()
  const editor = screen.container.querySelector<HTMLElement>(".ProseMirror")!
  await userEvent.click(editor)
  return Object.assign(screen, { editor })
}

function transfer(...files: File[]): DataTransfer {
  const data = new DataTransfer()
  for (const file of files) data.items.add(file)
  return data
}

function paste(editor: HTMLElement, file: File) {
  editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer(file), bubbles: true, cancelable: true }))
}

const tray = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-component="prompt-input-v2-attachments"] .tray-tile')).map(
    (tile) => tile.dataset.id,
  )

describe("composer attachments", () => {
  it("pastes a file mid-sentence as a chip at the caret and sends it in place", async () => {
    using _xhr = fakeXhr()
    let sent = ""
    await using screen = await mountComposer((body) => (sent = body))
    const editor = screen.editor
    await userEvent.keyboard("Read first")
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}")
    paste(editor, new File(["# Plan\n"], "notes.md", { type: "text/markdown" }))

    await expect.poll(() => editor.querySelector("[data-attachment]")?.textContent ?? "").toContain("notes.md")
    expect(editor.textContent?.replace(/\s+/g, " ")).toMatch(/^Read .*notes\.md.* first$/)
    expect(tray(screen.container)).toHaveLength(1)

    await expect.poll(() => FakeXhr.sent.length).toBe(1)
    FakeXhr.sent[0]!.finish()
    await expect
      .poll(() => editor.querySelector('[data-component="composer-chip"]')?.getAttribute("data-state"))
      .toBe("ready")
    await userEvent.keyboard("{Enter}")
    expect(sent).toMatch(/^Read \[notes\.md\]\(attachment:[\w-]+\) +first$/)
  })

  it("turns the file name red on a chip whose upload failed", async () => {
    using _xhr = fakeXhr()
    await using screen = await mountComposer()
    const editor = screen.editor
    await userEvent.keyboard("Read ")
    paste(editor, new File(["lost"], "lost.md", { type: "text/markdown" }))
    await expect.poll(() => FakeXhr.sent.length).toBe(1)

    FakeXhr.sent[0]!.fail()
    const failed = () =>
      editor.querySelector<HTMLElement>('.composer-attach-chip[data-state="failed"] .composer-attach-name')
    await expect.poll(failed).not.toBeNull()
    const probe = document.createElement("span")
    probe.style.color = "var(--danger)"
    document.body.append(probe)
    const danger = getComputedStyle(probe).color
    probe.remove()
    expect(getComputedStyle(failed()!).color).toBe(danger)
  })

  it("shows upload progress in bytes on the inline chip", async () => {
    using _xhr = fakeXhr()
    await using screen = await mountComposer()
    const editor = screen.editor
    await userEvent.keyboard("See ")
    const size = Math.round(1.2 * MB)
    paste(editor, new File([new Uint8Array(size)], "deck.zip", { type: "application/zip" }))

    await expect.poll(() => FakeXhr.sent.length).toBe(1)
    FakeXhr.sent[0]!.progress(340 * 1024, size)
    await expect
      .poll(() => editor.querySelector('[data-component="composer-chip"]')?.textContent ?? "")
      .toContain("340 KB of 1.2 MB")
  })

  it("pastes a file into an empty draft as a chip and a tray tile", async () => {
    using _xhr = fakeXhr()
    await using screen = await mountComposer()
    const editor = screen.editor
    paste(editor, new File(["a,b\n1,2\n"], "table.csv", { type: "text/csv" }))

    await expect.poll(() => tray(screen.container).length).toBe(1)
    await expect.poll(() => editor.querySelector("[data-attachment]")?.textContent ?? "").toContain("table.csv")
  })

  it("drops a file as an inline chip whether or not the draft has words", async () => {
    using _xhr = fakeXhr()
    await using screen = await mountComposer()
    const editor = screen.editor
    const drop = (file: File) =>
      editor.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer(file), bubbles: true, cancelable: true }))
    const chips = () => Array.from(editor.querySelectorAll("[data-attachment]")).map((chip) => chip.textContent)

    drop(new File(["x"], "first.md", { type: "text/markdown" }))
    await expect.poll(chips).toHaveLength(1)
    expect(tray(screen.container)).toHaveLength(1)

    await userEvent.click(editor)
    await userEvent.keyboard("Then ")
    drop(new File(["y"], "second.md", { type: "text/markdown" }))
    await expect.poll(chips).toHaveLength(2)
    expect(chips()[1]).toContain("second.md")
    expect(tray(screen.container)).toHaveLength(2)
  })

  it("drops a folder dragged out of the files tree as a folder reference", async () => {
    using _xhr = fakeXhr()
    await using screen = await mountComposer()
    const data = new DataTransfer()
    data.setData("application/x-kiko-file", "docs/")
    const box = screen.editor.getBoundingClientRect()
    const at = { clientX: box.left + 4, clientY: box.top + 4 }
    const overlay = () => document.querySelector('[data-component="composer-drop-overlay"]')

    document.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true, ...at }))
    await expect.poll(overlay).not.toBeNull()

    screen.editor.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true, ...at }))
    await expect
      .poll(() => screen.editor.querySelector("[data-file-ref]")?.getAttribute("data-file-ref") ?? "")
      .toBe("docs")
    expect(overlay()).toBeNull()
  })

  it("clears the drop overlay when another surface takes the drop", async () => {
    using _xhr = fakeXhr()
    await using screen = await mountComposer()
    const surface = document.createElement("div")
    surface.addEventListener("drop", (event) => event.stopPropagation())
    document.body.append(surface)
    const file = new File(["x"], "tree.md", { type: "text/markdown" })
    const box = screen.editor.getBoundingClientRect()
    const at = { clientX: box.left + 4, clientY: box.top + 4 }
    const overlay = () => document.querySelector('[data-component="composer-drop-overlay"]')

    document.dispatchEvent(
      new DragEvent("dragover", { dataTransfer: transfer(file), bubbles: true, cancelable: true, ...at }),
    )
    await expect.poll(overlay).not.toBeNull()

    surface.dispatchEvent(
      new DragEvent("drop", { dataTransfer: transfer(file), bubbles: true, cancelable: true, ...at }),
    )
    await expect.poll(overlay).toBeNull()
    surface.remove()
  })

  it("inserts files picked with + at the caret and shows them in the tray", async () => {
    using _xhr = fakeXhr()
    await using screen = await mountComposer()
    const editor = screen.editor
    await userEvent.keyboard("Look at this")
    const input = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!
    input.files = transfer(new File(["x"], "photo.txt", { type: "text/plain" })).files
    input.dispatchEvent(new Event("change", { bubbles: true }))

    await expect.poll(() => tray(screen.container).length).toBe(1)
    await expect.poll(() => editor.querySelector("[data-attachment]")?.textContent ?? "").toContain("photo.txt")
    expect(editor.textContent).toMatch(/^Look at this/)
  })

  it("drops the file when its inline chip is deleted", async () => {
    using _xhr = fakeXhr()
    let sent = ""
    await using screen = await mountComposer((body) => (sent = body))
    const editor = screen.editor
    await userEvent.keyboard("Read ")
    paste(editor, new File(["x"], "gone.md", { type: "text/markdown" }))
    await expect.poll(() => editor.querySelector("[data-attachment]")).not.toBeNull()

    await userEvent.keyboard("{Backspace}{Backspace}{Backspace}")
    expect(editor.querySelector("[data-attachment]")).toBeNull()
    expect(tray(screen.container)).toEqual([])
    await userEvent.keyboard("ok{Enter}")
    expect(sent).toBe("Read ok")
  })

  it("removes the chip when its tray tile is removed, and undo brings both back", async () => {
    using _xhr = fakeXhr()
    await using screen = await mountComposer()
    const editor = screen.editor
    await userEvent.keyboard("Read ")
    paste(editor, new File(["x"], "undo.md", { type: "text/markdown" }))
    await expect.poll(() => tray(screen.container)).toHaveLength(1)

    await userEvent.click(screen.container.querySelector<HTMLElement>('[data-action="remove-attachment"]')!)
    await expect.poll(() => editor.querySelector("[data-attachment]")).toBeNull()
    expect(tray(screen.container)).toEqual([])

    await userEvent.click(editor)
    await userEvent.keyboard("{Control>}z{/Control}")
    await expect.poll(() => editor.querySelector("[data-attachment]")).not.toBeNull()
    await expect.poll(() => tray(screen.container)).toHaveLength(1)
  })

  it("opens the file picker with Mod+U", async () => {
    using _xhr = fakeXhr()
    await using screen = await mountComposer()
    const input = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!
    const click = vi.spyOn(input, "click")
    await userEvent.keyboard("{Control>}u{/Control}")
    expect(click).toHaveBeenCalledTimes(1)
  })

  it("puts the chip back when the same file is picked again", async () => {
    using _xhr = fakeXhr()
    await using screen = await mountComposer()
    const editor = screen.editor
    const input = screen.container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(["x"], "again.md", { type: "text/markdown" })
    const pickAgain = () => {
      input.files = transfer(file).files
      input.dispatchEvent(new Event("change", { bubbles: true }))
    }

    pickAgain()
    await expect.poll(() => tray(screen.container)).toHaveLength(1)
    await userEvent.keyboard("{Backspace}{Backspace}")
    await expect.poll(() => editor.querySelector("[data-attachment]")).toBeNull()
    expect(tray(screen.container)).toEqual([])

    pickAgain()
    await expect.poll(() => editor.querySelector("[data-attachment]")).not.toBeNull()
    await expect.poll(() => tray(screen.container)).toHaveLength(1)
    expect(FakeXhr.sent).toHaveLength(1)
  })
})
