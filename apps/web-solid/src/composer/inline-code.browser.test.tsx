import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import type { RosterBot } from "../lib/types"
import { Composer } from "./composer"

const ROOM = "01900000-0000-7000-8000-000000000061"

const BOT: RosterBot = {
  id: "kiko",
  name: "Kiko",
  preview: "",
  updatedAt: 0,
  presence: "idle",
  unread: 0,
  pinned: false,
}

async function mountComposer() {
  const screen = await render(() => <Composer threadId={ROOM} bots={[BOT]} onSend={() => {}} />)
  await expect.poll(() => screen.container.querySelector(".ProseMirror"), { timeout: 10_000 }).not.toBeNull()
  const editor = screen.container.querySelector<HTMLElement>(".ProseMirror")!
  await userEvent.click(editor)
  return Object.assign(screen, { editor })
}

const code = (editor: HTMLElement) => editor.querySelector("code")?.textContent ?? null

function text(editor: HTMLElement): string {
  const copy = editor.cloneNode(true) as HTMLElement
  for (const marker of copy.querySelectorAll(".composer-rich-marker")) marker.remove()
  return copy.textContent ?? ""
}

describe("inline code caret stops", () => {
  it("leaves the code mark after the closing backtick is typed", async () => {
    await using screen = await mountComposer()
    await userEvent.keyboard("use `npm i` then")
    expect(code(screen.editor)).toBe("npm i")
    expect(text(screen.editor)).toBe("use npm i then")
  })

  it("types plain text after ArrowRight at the end of code", async () => {
    await using screen = await mountComposer()
    await userEvent.keyboard("`a`{ArrowRight}b")
    expect(code(screen.editor)).toBe("a")
    expect(text(screen.editor)).toBe("ab")
  })

  it("re-enters the code mark on ArrowLeft from after the code", async () => {
    await using screen = await mountComposer()
    await userEvent.keyboard("`a`{ArrowLeft}b")
    expect(code(screen.editor)).toBe("ab")
    expect(text(screen.editor)).toBe("ab")
  })

  it("deletes the last code character on Backspace at the edge", async () => {
    await using screen = await mountComposer()
    await userEvent.keyboard("`abc`{Backspace}")
    expect(code(screen.editor)).toBe("ab")
    expect(text(screen.editor)).toBe("ab")
  })
})
