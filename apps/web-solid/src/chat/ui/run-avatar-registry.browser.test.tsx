import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import { RunAvatar } from "./RunAvatar"

const avatars = () => (
  <>
    <div data-run-key="run-1">
      <RunAvatar seed="kiko" runKey="run-1" isRunEnd />
    </div>
    <div data-run-key="run-2">
      <RunAvatar seed="kiko" runKey="run-2" isRunEnd />
    </div>
  </>
)

describe("run avatar registry", () => {
  it("shares one scroll listener across every avatar in a scroller", async () => {
    const scroller = document.createElement("div")
    scroller.setAttribute("data-virtual-scroll", "")
    const add = vi.spyOn(scroller, "addEventListener")

    await using screen = await render(avatars, { container: scroller })

    expect(screen.container.querySelectorAll('[data-component="chat-run-avatar"]')).toHaveLength(2)
    expect(add.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(1)
  })

  it("removes the listener once the last avatar leaves", async () => {
    const scroller = document.createElement("div")
    scroller.setAttribute("data-virtual-scroll", "")
    const remove = vi.spyOn(scroller, "removeEventListener")

    await using screen = await render(avatars, { container: scroller })
    screen.unmount()

    expect(remove.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(1)
  })
})
