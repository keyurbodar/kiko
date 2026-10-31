import "../index.css"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../test/render"
import { Collapsible } from "./Collapsible"
import { foldLimitFor } from "./lib/fold"

const LONG = "Filler sentence that takes up room in a collapsed message. ".repeat(40)

function scroller(height: number): HTMLElement {
  const host = document.createElement("div")
  host.style.cssText = `width:400px;height:${height}px;overflow-y:auto`
  document.body.append(host)
  return host
}

const rootOf = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-component="chat-collapsible"]')!

const clipOf = (host: HTMLElement) => rootOf(host).firstElementChild as HTMLElement

const innerOf = (host: HTMLElement) => clipOf(host).firstElementChild as HTMLElement

describe("Collapsible measurement", () => {
  it("measures a row without a code block without reading its rect", async () => {
    const host = scroller(400)
    await using screen = await render(
      () => (
        <Collapsible messageId="plain">
          <p>{LONG}</p>
        </Collapsible>
      ),
      { container: host },
    )

    expect(clipOf(host).style.maxHeight).toBe("")

    const rect = vi.spyOn(innerOf(host), "getBoundingClientRect")

    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Show more" }).element()).toBeTruthy())

    expect(clipOf(host).style.maxHeight).toBe(`${foldLimitFor(400)}px`)
    expect(rect).not.toHaveBeenCalled()
  })

  it("reuses the cached scroll parent instead of walking the tree again", async () => {
    const host = scroller(400)
    await using _screen = await render(
      () => (
        <Collapsible messageId="cached">
          <p>{LONG}</p>
        </Collapsible>
      ),
      { container: host },
    )

    await vi.waitFor(() => expect(clipOf(host).style.maxHeight).toBe(`${foldLimitFor(400)}px`))

    const styles = vi.spyOn(window, "getComputedStyle")
    host.style.height = "600px"
    window.dispatchEvent(new Event("resize"))

    await vi.waitFor(() => expect(clipOf(host).style.maxHeight).toBe(`${foldLimitFor(600)}px`))

    expect(styles.mock.calls.filter(([node]) => node === host)).toHaveLength(0)
  })
})
