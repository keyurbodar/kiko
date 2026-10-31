import "../index.css"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { room } from "../state/room"
import { Composer } from "./composer"

const ROOM = "01900000-0000-7000-8000-000000000004"

describe("composer height", () => {
  it("grows with each new line instead of scrolling the first line away", async () => {
    room.followRoute(() => ROOM)
    await using screen = await render(() => (
      <div class="composer-dock" data-component="composer-dock">
        <Composer threadId={ROOM} bots={[]} onSend={() => {}} />
      </div>
    ))
    await expect.poll(() => screen.container.querySelector('[contenteditable="true"]')).not.toBeNull()
    const editor = screen.container.querySelector<HTMLElement>('[contenteditable="true"]')!
    await userEvent.click(editor)
    await userEvent.keyboard("So I have this Discord server")
    const oneLine = editor.offsetHeight
    const line = Number.parseFloat(getComputedStyle(editor).lineHeight)
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}second line{Shift>}{Enter}{/Shift}third line")

    await expect.poll(() => editor.offsetHeight).toBeGreaterThanOrEqual(line * 3)
    expect(editor.offsetHeight).toBeGreaterThan(oneLine)
    expect(editor.scrollHeight - editor.clientHeight).toBeLessThanOrEqual(1)
  })
})
