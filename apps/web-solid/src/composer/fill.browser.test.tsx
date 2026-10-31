import "../index.css"
import type { HumanAsk, RoomId } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import type { ActiveRoom } from "../state/room"
import { Composer } from "./composer"
import { fillComposer } from "./fill"

const ROOM = "01900000-0000-7000-8000-000000000071"

const ASK = { id: "ask-1", from: "kiko", text: "Which one?", messageId: "m-1" } as unknown as HumanAsk

const askingRoom = (asks: readonly HumanAsk[]): ActiveRoom => ({
  roomId: ROOM as RoomId,
  asks: () => asks,
  answer: () => {},
  skip: () => {},
  members: () => [],
  tasks: () => [],
})

async function editorOf(container: HTMLElement): Promise<HTMLElement> {
  await expect.poll(() => container.querySelector(".ProseMirror"), { timeout: 10_000 }).not.toBeNull()
  const editor = container.querySelector<HTMLElement>(".ProseMirror")!
  await userEvent.click(editor)
  return editor
}

describe("restoring a draft after a failed send", () => {
  it("keeps text typed since the send instead of replacing it", async () => {
    let sent = ""
    await using screen = await render(() => (
      <Composer threadId={ROOM} draftKey={ROOM} bots={[]} onSend={(message) => void (sent = message.body)} />
    ))
    const editor = await editorOf(screen.container)
    await userEvent.keyboard("first try")
    await userEvent.keyboard("{Enter}")
    await userEvent.click(editor)
    await userEvent.keyboard("second try")
    fillComposer(ROOM, "first try")
    await expect.poll(() => editor.innerText).toContain("first try")
    expect(editor.innerText).toContain("second try")
    await userEvent.click(screen.container.querySelector<HTMLElement>('[data-action="prompt-submit"]')!)
    expect(sent).toContain("second try")
    expect(sent).toContain("first try")
  })

  it("merges into the answer field while a question is open", async () => {
    await using screen = await render(() => (
      <Composer room={askingRoom([ASK])} threadId={ROOM} draftKey={ROOM} bots={[]} onSend={() => {}} />
    ))
    const editor = await editorOf(screen.container)
    await userEvent.keyboard("my answer")
    fillComposer(ROOM, "failed message")
    await expect.poll(() => editor.innerText).toContain("failed message")
    expect(editor.innerText).toContain("my answer")
  })
})
