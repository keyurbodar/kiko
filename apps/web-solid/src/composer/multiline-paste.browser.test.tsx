import "../index.css"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import type { RosterBot } from "../lib/types"
import { Composer } from "./composer"
import { fillComposer } from "./fill"

const ROOM = "01900000-0000-7000-8000-000000000062"

const BOT: RosterBot = {
  id: "kiko",
  name: "Kiko",
  preview: "",
  updatedAt: 0,
  presence: "idle",
  unread: 0,
  pinned: false,
}

function paste(target: HTMLElement, text: string) {
  const data = new DataTransfer()
  data.setData("text/plain", text)
  target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
}

async function mountComposer(onSend: (body: string) => void) {
  const screen = await render(() => (
    <Composer threadId={ROOM} bots={[BOT]} onSend={(message) => onSend(message.body)} />
  ))
  await expect.poll(() => screen.container.querySelector(".ProseMirror"), { timeout: 10_000 }).not.toBeNull()
  const editor = screen.container.querySelector<HTMLElement>(".ProseMirror")!
  await userEvent.click(editor)
  return Object.assign(screen, { editor })
}

describe("pasting multiple lines", () => {
  it("sends a pasted block with the newlines it came with", async () => {
    let sent = ""
    await using screen = await mountComposer((body) => (sent = body))
    paste(screen.editor, "a\nb\nc")
    await userEvent.keyboard("{Enter}")
    expect(sent).toBe("a\nb\nc")
  })

  it("sends a pasted fenced code block with one newline between its lines", async () => {
    let sent = ""
    await using screen = await mountComposer((body) => (sent = body))
    const source = "```js\nconst a = 1\nconst b = 2\n```"
    paste(screen.editor, source)
    await userEvent.click(screen.container.querySelector<HTMLElement>('[data-action="prompt-submit"]')!)
    expect(sent).toBe(source)
  })

  it("sends a pasted block from a CRLF source with single newlines", async () => {
    let sent = ""
    await using screen = await mountComposer((body) => (sent = body))
    paste(screen.editor, "a\r\nb\r\nc")
    await userEvent.keyboard("{Enter}")
    expect(sent).toBe("a\nb\nc")
  })

  it("fills a multi-line draft with single newlines", async () => {
    let sent = ""
    const screen = await render(() => (
      <Composer threadId={ROOM} draftKey={ROOM} bots={[BOT]} onSend={(message) => void (sent = message.body)} />
    ))
    await using _ = screen
    await expect.poll(() => screen.container.querySelector(".ProseMirror"), { timeout: 10_000 }).not.toBeNull()
    const editor = screen.container.querySelector<HTMLElement>(".ProseMirror")!
    fillComposer(ROOM, "a\nb\nc")
    await expect.poll(() => editor.innerText).toBe("a\nb\nc")
    await userEvent.click(editor)
    await userEvent.click(screen.container.querySelector<HTMLElement>('[data-action="prompt-submit"]')!)
    expect(sent).toBe("a\nb\nc")
  })
})
