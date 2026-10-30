import { FileIcon, fileIconMarkup } from "@kiko/ui/file-icon"
import { Pictogram } from "@kiko/ui/pictogram"
import { RemixIcon, type Glyph } from "@kiko/ui/remix-icon"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../test/render"

const SVG_NS = "http://www.w3.org/2000/svg"

function svgParses() {
  const spy = vi.spyOn(Element.prototype, "innerHTML", "set")
  return {
    get count() {
      return spy.mock.contexts.filter((context) => context instanceof SVGElement).length
    },
    [Symbol.dispose]() {
      spy.mockRestore()
    },
  }
}

const glyph = (d: string) => `<path d="${d}"/>` as Glyph

function reference(markup: Glyph): string {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.innerHTML = markup
  return svg.innerHTML
}

function fileIconReference(path: string): string {
  const host = document.createElement("div")
  host.innerHTML = fileIconMarkup(path)
  return host.querySelector("svg")!.innerHTML
}

describe("RemixIcon", () => {
  it("renders the same markup as the innerHTML reference without sharing nodes", async () => {
    const mark = glyph("M4 4h16v16H4z")
    await using screen = await render(() => (
      <div>
        <RemixIcon icon={mark} />
        <RemixIcon icon={mark} />
      </div>
    ))
    const [first, second] = screen.container.querySelectorAll("svg")
    expect(first.innerHTML).toBe(reference(mark))
    expect(second.innerHTML).toBe(reference(mark))
    expect(first.querySelector("path")).not.toBe(second.querySelector("path"))
  })

  it("parses each distinct glyph once for every instance", async () => {
    const mark = glyph("M5 5h14v14H5z")
    await using warm = await render(() => <RemixIcon icon={mark} />)
    expect(warm.container.querySelector("svg")!.innerHTML).toBe(reference(mark))

    using parses = svgParses()
    await using screen = await render(() => (
      <div>
        {Array.from({ length: 12 }, () => (
          <RemixIcon icon={mark} />
        ))}
      </div>
    ))
    expect(screen.container.querySelectorAll("svg")).toHaveLength(12)
    expect(parses.count).toBe(0)
  })

  it("replaces the glyph when icon changes", async () => {
    const first = glyph("M2 2h20v20H2z")
    const second = glyph("M6 6h12v12H6z")
    const [icon, setIcon] = createSignal<Glyph>(first)
    await using screen = await render(() => <RemixIcon icon={icon()} />)
    const svg = screen.container.querySelector("svg")!
    expect(svg.innerHTML).toBe(reference(first))
    setIcon(second)
    expect(svg.innerHTML).toBe(reference(second))
  })
})

describe("Pictogram", () => {
  it("parses each distinct glyph once and keeps instances separate", async () => {
    await using warm = await render(() => <Pictogram name="files" />)
    using parses = svgParses()
    await using screen = await render(() => (
      <div>
        <Pictogram name="files" />
        <Pictogram name="files" />
      </div>
    ))
    const [first, second] = screen.container.querySelectorAll("svg")
    expect(first.innerHTML).toBe(warm.container.querySelector("svg")!.innerHTML)
    expect(first.innerHTML).toBe(second.innerHTML)
    expect(first.firstChild).not.toBe(second.firstChild)
    expect(parses.count).toBe(0)
  })
})

describe("FileIcon", () => {
  it("matches the file icon markup and reparses when the path changes", async () => {
    const [path, setPath] = createSignal("notes.md")
    await using screen = await render(() => <FileIcon node={{ path: path(), type: "file" }} />)
    const svg = screen.container.querySelector("svg")!
    expect(svg.innerHTML).toBe(fileIconReference("notes.md"))
    setPath("data.json")
    expect(svg.innerHTML).toBe(fileIconReference("data.json"))
  })

  it("parses each distinct glyph once for every instance", async () => {
    await using warm = await render(() => <FileIcon node={{ path: "plan.zip", type: "file" }} />)
    using parses = svgParses()
    await using screen = await render(() => (
      <div>
        {Array.from({ length: 12 }, () => (
          <FileIcon node={{ path: "plan.zip", type: "file" }} />
        ))}
      </div>
    ))
    const [first] = screen.container.querySelectorAll("svg")
    expect(first.innerHTML).toBe(warm.container.querySelector("svg")!.innerHTML)
    expect(parses.count).toBe(0)
  })
})
