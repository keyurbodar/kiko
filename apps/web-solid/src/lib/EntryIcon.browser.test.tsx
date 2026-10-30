import { fileIconMarkup } from "@kiko/ui/file-icon"
import { describe, expect, it } from "vitest"
import { render } from "../../test/render"
import { EntryIcon } from "./EntryIcon"

function reference(path: string): SVGSVGElement {
  const host = document.createElement("div")
  host.innerHTML = fileIconMarkup(path).replace("<svg ", '<svg class="entry-icon" ')
  return host.querySelector("svg")!
}

describe("EntryIcon", () => {
  it("renders the file icon markup inside its contents wrapper", async () => {
    await using screen = await render(() => (
      <div>
        <EntryIcon path="notes.md" />
        <EntryIcon path="trips/" />
      </div>
    ))
    const [file, directory] = screen.container.querySelectorAll("svg")
    expect(file.innerHTML).toBe(reference("notes.md").innerHTML)
    expect(directory.innerHTML).toBe(reference("trips/").innerHTML)
    expect(file.getAttribute("data-kind")).toBe("file")
    expect(directory.getAttribute("data-kind")).toBe("directory")
    expect(file.classList.contains("entry-icon")).toBe(true)
    expect(file.parentElement?.style.display).toBe("contents")
  })
})
