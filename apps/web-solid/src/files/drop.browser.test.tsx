import { describe, expect, it, vi } from "vitest"
import { render } from "../../test/render"
import { dropLine, MAX_TEXT_BYTES, planDrop, uniqueName } from "./drop"
import { DropZone } from "./drop-zone"

const transfer = (...files: File[]) => {
  const data = new DataTransfer()
  for (const file of files) data.items.add(file)
  return data
}

const fire = (target: Element, type: string, dataTransfer: DataTransfer) =>
  target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))

describe("files drop", () => {
  it("shows the drop overlay while files are dragged over, hides it on leave, and hands dropped files over", async () => {
    const onFiles = vi.fn()
    await using screen = await render(() => (
      <DropZone folder="home" onFiles={onFiles}>
        <p>Files</p>
      </DropZone>
    ))
    const zone = screen.container.querySelector('[data-component="files-drop-zone"]') as HTMLElement
    const overlay = screen.container.querySelector('[data-component="files-drop-overlay"]') as HTMLElement
    const notes = new File(["hello"], "notes.md", { type: "text/markdown" })
    const data = transfer(notes, new File(["a,b"], "sheet.csv", { type: "text/csv" }))

    expect(overlay.hasAttribute("data-open")).toBe(false)
    fire(zone, "dragenter", data)
    expect(overlay.hasAttribute("data-open")).toBe(true)
    expect(overlay.textContent).toContain("Drop to save in home")
    expect(overlay.textContent).toContain("2 files")
    expect(overlay.querySelectorAll('[data-component="file-type-icon"]')).toHaveLength(2)

    fire(zone, "dragleave", data)
    expect(overlay.hasAttribute("data-open")).toBe(false)

    fire(zone, "dragenter", data)
    fire(zone, "drop", data)
    expect(overlay.hasAttribute("data-open")).toBe(false)
    expect(onFiles).toHaveBeenCalledOnce()
    expect(onFiles.mock.calls[0]?.[0].map((file: File) => file.name)).toEqual(["notes.md", "sheet.csv"])
  })

  it("ignores drags that carry no files", async () => {
    await using screen = await render(() => (
      <DropZone folder="home" onFiles={() => {}}>
        <p>Files</p>
      </DropZone>
    ))
    const zone = screen.container.querySelector('[data-component="files-drop-zone"]') as HTMLElement
    const text = new DataTransfer()
    text.setData("text/plain", "hi")
    fire(zone, "dragenter", text)
    expect(screen.container.querySelector("[data-open]")).toBeNull()
  })
})

describe("drop plan", () => {
  it("saves text files and says why other files are refused", () => {
    const big = new File([new Uint8Array(MAX_TEXT_BYTES + 1)], "huge.txt", { type: "text/plain" })
    const plan = planDrop([
      new File(["x"], "a.md", { type: "text/markdown" }),
      new File([new Uint8Array([0, 1])], "photo.png", { type: "image/png" }),
      big,
    ])
    expect(plan.save.map((file) => file.name)).toEqual(["a.md"])
    expect(plan.refused.map((file) => file.name)).toEqual(["photo.png", "huge.txt"])
  })

  it("renames a dropped file instead of overwriting one that exists", () => {
    expect(uniqueName("notes.md", new Set())).toBe("notes.md")
    expect(uniqueName("notes.md", new Set(["notes.md"]))).toBe("notes (2).md")
    expect(uniqueName("notes.md", new Set(["notes.md", "notes (2).md"]))).toBe("notes (3).md")
    expect(uniqueName("Makefile", new Set(["Makefile"]))).toBe("Makefile (2)")
  })

  it("counts files in the hint", () => {
    expect(dropLine(1)).toBe("1 file. Release to save it.")
    expect(dropLine(3)).toBe("3 files. Release to save them.")
  })
})
