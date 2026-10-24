import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import type { RosterBot } from "../lib/types"
import { Composer } from "./composer"
import { attachFileRefs } from "./file-refs"

const ROOM = "01900000-0000-7000-8000-000000000041"

const bot = (id: string, name: string): RosterBot => ({
  id,
  name,
  preview: "",
  updatedAt: 0,
  presence: "idle",
  unread: 0,
  pinned: false,
})

const BOTS = [bot("kiko", "Kiko"), bot("alpha", "Alpha")]

async function mountComposer(onSend: (body: string) => void = () => {}) {
  const screen = await render(() => (
    <Composer threadId={ROOM} bots={BOTS} onSend={(message) => void onSend(message.body)} />
  ))
  await expect.poll(() => screen.container.querySelector(".ProseMirror"), { timeout: 10_000 }).not.toBeNull()
  const editor = screen.container.querySelector<HTMLElement>(".ProseMirror")!
  await userEvent.click(editor)
  return { screen, editor }
}

describe("composer tokens", () => {
  it("turns a picked @ agent into a chip and sends it as a mention", async () => {
    let sent = ""
    const { screen, editor } = await mountComposer((body) => (sent = body))
    await userEvent.keyboard("Ask @al")
    await expect.element(screen.getByRole("option", { name: /Alpha/ })).toBeVisible()
    await userEvent.keyboard("{Tab}")

    const chip = editor.querySelector('[data-mention="alpha"]')
    expect(chip?.textContent).toContain("Alpha")
    expect(screen.container.querySelector('[role="listbox"]')).toBeNull()
    await userEvent.keyboard("to check{Enter}")
    expect(sent).toBe("Ask @alpha to check")
    await screen[Symbol.asyncDispose]()
  })

  it("selects a chip on the first backspace and deletes it on the second", async () => {
    const { screen, editor } = await mountComposer()
    await userEvent.keyboard("Ask @alp{Enter}")
    expect(editor.querySelector('[data-mention="alpha"]')).not.toBeNull()

    await userEvent.keyboard("{Backspace}{Backspace}")
    expect(editor.querySelector('.ProseMirror-selectednode[data-mention="alpha"]')).not.toBeNull()

    await userEvent.keyboard("{Backspace}")
    expect(editor.querySelector('[data-mention="alpha"]')).toBeNull()
    expect(editor.textContent).toBe("Ask ")
    await screen[Symbol.asyncDispose]()
  })

  it("keeps the typed text when Esc closes the popover, and stays closed for that word", async () => {
    const { screen, editor } = await mountComposer()
    await userEvent.keyboard("Ping @al")
    await expect.element(screen.getByRole("listbox")).toBeVisible()

    await userEvent.keyboard("{Escape}")
    expect(screen.container.querySelector('[role="listbox"]')).toBeNull()
    await userEvent.keyboard("p")
    expect(screen.container.querySelector('[role="listbox"]')).toBeNull()
    expect(editor.querySelector("[data-mention]")).toBeNull()
    expect(editor.textContent).toBe("Ping @alp")
    await screen[Symbol.asyncDispose]()
  })

  it("adds workspace files to the draft as file chips from outside the composer", async () => {
    let sent = ""
    const { screen, editor } = await mountComposer((body) => (sent = body))
    await userEvent.keyboard("Read ")
    expect(attachFileRefs(["notes/plan.md"])).toBe(true)

    expect(editor.querySelector('[data-file-ref="notes/plan.md"]')?.textContent).toContain("plan.md")
    await userEvent.keyboard("first{Enter}")
    expect(sent).toBe("Read [plan.md](/notes/plan.md) first")
    await screen[Symbol.asyncDispose]()
    expect(attachFileRefs(["notes/plan.md"])).toBe(false)
  })
})
