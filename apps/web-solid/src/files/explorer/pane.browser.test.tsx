import "../../index.css"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../../test/render"
import { FileExplorerPane } from "./pane"
import { EXPLORER_WIDTH_KEY } from "./resize"

function host(width: number) {
  const el = document.createElement("div")
  el.style.display = "flex"
  el.style.width = `${width}px`
  el.style.height = "300px"
  return el
}

const paneOf = (container: HTMLElement) =>
  container.querySelector('[data-component="file-explorer-pane"]') as HTMLElement
const handleOf = (container: HTMLElement) =>
  container.querySelector('[data-component="file-explorer-resize"]') as HTMLElement

describe("file explorer pane", () => {
  it("resizes with the keyboard and remembers the width", async () => {
    localStorage.removeItem(EXPLORER_WIDTH_KEY)
    await using screen = await render(
      () => (
        <FileExplorerPane rowWidth={900}>
          <div />
        </FileExplorerPane>
      ),
      { container: host(900) },
    )
    const pane = paneOf(screen.container)
    expect(pane.style.width).toBe("256px")
    const handle = handleOf(screen.container)
    handle.focus()
    await userEvent.keyboard("{ArrowLeft}")
    expect(pane.style.width).toBe("272px")
    await userEvent.keyboard("{ArrowRight}{ArrowRight}")
    expect(pane.style.width).toBe("240px")
    await userEvent.keyboard("{Home}")
    expect(pane.style.width).toBe("160px")
    await userEvent.keyboard("{End}")
    expect(pane.style.width).toBe("560px")
    expect(localStorage.getItem(EXPLORER_WIDTH_KEY)).toBe("560")
  })

  it("never takes space the file needs", async () => {
    localStorage.setItem(EXPLORER_WIDTH_KEY, "500")
    await using screen = await render(
      () => (
        <FileExplorerPane rowWidth={500}>
          <div />
        </FileExplorerPane>
      ),
      { container: host(500) },
    )
    const pane = paneOf(screen.container)
    expect(pane.style.width).toBe("244px")
    handleOf(screen.container).focus()
    await userEvent.keyboard("{End}")
    expect(pane.style.width).toBe("244px")
    await userEvent.keyboard("{ArrowLeft}")
    expect(pane.style.width).toBe("244px")
    localStorage.removeItem(EXPLORER_WIDTH_KEY)
  })

  it("reads a saved width back on mount", async () => {
    localStorage.setItem(EXPLORER_WIDTH_KEY, "320")
    await using screen = await render(
      () => (
        <FileExplorerPane rowWidth={900}>
          <div />
        </FileExplorerPane>
      ),
      { container: host(900) },
    )
    expect(paneOf(screen.container).style.width).toBe("320px")
    localStorage.removeItem(EXPLORER_WIDTH_KEY)
  })
})
