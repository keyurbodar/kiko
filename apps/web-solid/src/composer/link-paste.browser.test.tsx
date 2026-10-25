import "../index.css"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { room } from "../state/room"
import { Composer } from "./composer"

const ROOM = "01900000-0000-7000-8000-000000000005"

function paste(target: HTMLElement, text: string) {
  const data = new DataTransfer()
  data.setData("text/plain", text)
  target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
}

async function composer() {
  room.followRoute(() => ROOM)
  const screen = await render(() => (
    <div class="composer-dock" data-component="composer-dock">
      <Composer threadId={ROOM} bots={[]} onSend={() => {}} />
    </div>
  ))
  await expect.poll(() => screen.container.querySelector('[contenteditable="true"]')).not.toBeNull()
  const editor = screen.container.querySelector<HTMLElement>('[contenteditable="true"]')!
  await userEvent.click(editor)
  return { screen, editor }
}

describe("pasting a link", () => {
  it("puts the caret on a fresh, unlinked line after a link pasted into an empty composer", async () => {
    const { screen, editor } = await composer()
    await using _ = screen
    paste(editor, "https://solscan.io/account")
    await userEvent.keyboard("what is this")

    const lines = [...editor.querySelectorAll("p")].map((p) => p.textContent)
    expect(lines).toEqual(["solscan.io/account", "what is this"])
    expect(editor.querySelector("a")?.textContent).toBe("solscan.io/account")
  })

  it("keeps a link pasted into the middle of a sentence on the same line", async () => {
    const { screen, editor } = await composer()
    await using _ = screen
    await userEvent.keyboard("see ")
    paste(editor, "https://solscan.io/account")

    expect([...editor.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["see solscan.io/account"])
  })
})
