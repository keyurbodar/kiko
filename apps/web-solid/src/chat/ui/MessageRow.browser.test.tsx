import "../../index.css"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import type { ChatMessage } from "../../lib/types"
import { MessageRow } from "./MessageRow"

const message = {
  id: "1.room",
  threadId: "room",
  sender: "bot",
  botId: "kiko",
  body: "Hello",
  sentAt: 0,
  seq: 1,
} as ChatMessage

const row = (group: boolean) => (
  <MessageRow
    message={message}
    bot={undefined}
    quote={null}
    isRunStart
    isRunEnd
    hasRunGapBefore={false}
    group={group}
    onOpenReplyTarget={() => {}}
  />
)

describe("MessageRow avatars", () => {
  it("shows the agent avatar and gutter in a one-to-one chat", async () => {
    await using screen = await render(() => row(false))

    expect(screen.container.querySelector('[data-component="chat-run-avatar"]')).toBeTruthy()
    expect(screen.container.querySelector('[data-component="chat-row"]')!.className).toContain("pl-[calc")
    expect(screen.container.querySelector('[data-component="chat-sender"]')).toBeNull()
  })

  it("names the sender inside the first bubble in a group chat", async () => {
    await using screen = await render(() => row(true))

    expect(screen.container.querySelector('[data-component="chat-run-avatar"]')).toBeTruthy()
    expect(
      screen.container.querySelector('[data-slot="bubble-content"] [data-component="chat-sender"]')?.textContent,
    ).toBe("kiko")
  })

  it("keeps your own messages free of an avatar", async () => {
    await using screen = await render(() => (
      <MessageRow
        message={{ ...message, sender: "user", botId: undefined }}
        bot={undefined}
        quote={null}
        isRunStart
        isRunEnd
        hasRunGapBefore={false}
        onOpenReplyTarget={() => {}}
      />
    ))

    expect(screen.container.querySelector('[data-component="chat-run-avatar"]')).toBeNull()
  })
})

describe("MessageRow time", () => {
  it("puts the send time inside the bubble", async () => {
    await using screen = await render(() => row(false))

    expect(screen.container.querySelector('[data-slot="bubble-content"] [data-component="bubble-time"]')).toBeTruthy()
  })
})

describe("MessageRow attachments", () => {
  it("keeps an image-only message in its bubble and opens only that message's images", async () => {
    const open = vi.fn()
    const files = [
      { name: "a.png", size: 1, type: "image/png", src: "data:,a" },
      { name: "b.png", size: 1, type: "image/png", src: "data:,b" },
    ]
    await using screen = await render(() => (
      <MessageRow
        message={{ ...message, body: "", files }}
        bot={undefined}
        quote={null}
        isRunStart
        isRunEnd
        hasRunGapBefore={false}
        onOpenReplyTarget={() => {}}
        onOpenImages={open}
      />
    ))

    expect(
      screen.container.querySelector('[data-slot="bubble-content"] [data-component="chat-attachments"]'),
    ).toBeTruthy()
    await screen.getByRole("button", { name: "Preview b.png" }).click()

    expect(open).toHaveBeenCalledWith(
      [expect.objectContaining({ name: "a.png" }), expect.objectContaining({ name: "b.png" })],
      1,
    )
  })
})
