import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import type { OutgoingMessage, RosterBot } from "../lib/types"
import { room } from "../state/room"
import { Composer } from "./composer"
import { clearDraftFiles } from "./rich/draft-files"

const delivery = vi.hoisted(() => ({
  sent: [] as { roomId: string; text: string; attachments?: readonly { pendingId: string }[] }[],
  refusal: null as string | null,
}))

vi.mock("../state/connection", async (original) => {
  const real = await original<typeof import("../state/connection")>()
  return { ...real, connection: { ...real.connection, connected: () => true } }
})

vi.mock("../state/runtime", async (original) => {
  const real = await original<typeof import("../state/runtime")>()
  return {
    ...real,
    attempt: (command: unknown, input: never, onFailure: (reason: string) => void) => {
      if (command !== real.owner.commands.sendMessage) return real.attempt(command as never, input, onFailure)
      if (delivery.refusal) {
        onFailure(delivery.refusal)
        return Promise.resolve(undefined)
      }
      delivery.sent.push(input)
      return Promise.resolve({})
    },
  }
})

const ROOM = "01900000-0000-7000-8000-000000000053"
const ELSEWHERE = "01900000-0000-7000-8000-000000000054"

class FakeXhr {
  static sent: FakeXhr[] = []
  readonly upload = new EventTarget()
  private readonly events = new EventTarget()
  status = 0
  responseText = ""
  timeout = 0
  open() {}
  setRequestHeader() {}
  addEventListener(type: string, listener: EventListener) {
    this.events.addEventListener(type, listener)
  }
  send() {
    FakeXhr.sent.push(this)
  }
  abort() {}
  finish() {
    this.status = 200
    this.responseText = "{}"
    this.events.dispatchEvent(new Event("load"))
  }
  fail() {
    this.events.dispatchEvent(new Event("error"))
  }
}

const BOTS: RosterBot[] = [
  { id: "kiko", name: "Kiko", preview: "", updatedAt: 0, presence: "idle", unread: 0, pinned: false },
]

function fakeXhr() {
  FakeXhr.sent = []
  delivery.sent = []
  delivery.refusal = null
  vi.stubGlobal("XMLHttpRequest", FakeXhr)
  return { [Symbol.dispose]: () => void vi.unstubAllGlobals() }
}

async function mountComposer(onSend: (message: OutgoingMessage) => boolean | void) {
  await clearDraftFiles(ROOM)
  const screen = await render(() => <Composer threadId={ROOM} draftKey={ROOM} bots={BOTS} onSend={onSend} />)
  await expect.poll(() => screen.container.querySelector(".ProseMirror"), { timeout: 10_000 }).not.toBeNull()
  const editor = screen.container.querySelector<HTMLElement>(".ProseMirror")!
  await userEvent.click(editor)
  return Object.assign(screen, { editor })
}

function pick(container: HTMLElement, ...files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  const data = new DataTransfer()
  for (const file of files) data.items.add(file)
  input.files = data.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

const tiles = (root: HTMLElement) =>
  root.querySelectorAll('[data-component="prompt-input-v2-attachments"] .tray-tile').length

const shown = (body: string) => room.messages().find((message) => message.body.includes(body))
const linked = (name: string, body: string) => new RegExp(`^\\[${name}\\]\\(attachment:[\\w-]+\\) ${body}$`)

async function sendThroughRoom(body: string) {
  room.followRoute(() => ROOM)
  const screen = await mountComposer((message) => room.send(message) !== undefined)
  pick(screen.container, new File(["hello"], "note.txt", { type: "text/plain" }))
  await expect.poll(() => FakeXhr.sent.length).toBe(1)
  await userEvent.keyboard(`${body}{Enter}`)
  return screen
}

describe("sending attachments", () => {
  it("shows the message with its attachment and clears the composer before the upload finishes", async () => {
    using _xhr = fakeXhr()
    await using screen = await sendThroughRoom("look")

    expect(tiles(screen.container)).toBe(0)
    expect(screen.editor.textContent).toBe("")
    expect(shown("look")?.files?.map((file) => file.name)).toEqual(["note.txt"])
    expect(shown("look")?.files?.[0]?.src).toMatch(/^blob:/)
    expect(shown("look")?.status).toBe("sending")
    expect(delivery.sent).toEqual([])

    FakeXhr.sent[0]!.finish()
    await expect.poll(() => delivery.sent.length).toBe(1)
    expect(delivery.sent[0]!.text).toMatch(linked("note.txt", "look"))
    expect(delivery.sent[0]!.attachments).toHaveLength(1)
  })

  it("delivers to the room it was sent in after navigating away", async () => {
    using _xhr = fakeXhr()
    await using _screen = await sendThroughRoom("away")
    room.followRoute(() => ELSEWHERE)

    FakeXhr.sent[0]!.finish()
    await expect.poll(() => delivery.sent.length).toBe(1)
    expect(delivery.sent[0]!.roomId).toBe(ROOM)
    expect(delivery.sent[0]!.text).toMatch(linked("note.txt", "away"))
  })

  it("marks the sent message failed when its upload fails, and retries it", async () => {
    using _xhr = fakeXhr()
    await using _screen = await sendThroughRoom("retry me")

    FakeXhr.sent[0]!.fail()
    await expect.poll(() => shown("retry me")?.status).toBe("failed")
    room.retryRun(shown("retry me")!.id)
    await expect.poll(() => FakeXhr.sent.length).toBe(2)
    expect(shown("retry me")?.status).toBe("sending")

    FakeXhr.sent[1]!.finish()
    await expect.poll(() => delivery.sent.length).toBe(1)
    expect(delivery.sent[0]!.attachments).toHaveLength(1)
  })

  it("removes a sent message whose upload failed", async () => {
    using _xhr = fakeXhr()
    await using _screen = await sendThroughRoom("drop me")

    FakeXhr.sent[0]!.fail()
    await expect.poll(() => shown("drop me")?.status).toBe("failed")
    room.deleteMessage(shown("drop me")!.id)
    expect(shown("drop me")).toBeUndefined()
  })

  it("puts the text and attachment back in the composer when the server refuses the send", async () => {
    using _xhr = fakeXhr()
    delivery.refusal = "Not allowed"
    await using screen = await sendThroughRoom("refused")
    expect(tiles(screen.container)).toBe(0)

    FakeXhr.sent[0]!.finish()
    await expect.poll(() => tiles(screen.container)).toBe(1)
    await expect.poll(() => screen.editor.querySelector("[data-attachment]")).not.toBeNull()
    await expect.poll(() => screen.editor.textContent ?? "").toContain("refused")
    expect(shown("refused")).toBeUndefined()
  })

  it("keeps the attachment when the send is refused", async () => {
    using _xhr = fakeXhr()
    let refuse = true
    const sent: OutgoingMessage[] = []
    await using screen = await mountComposer((message) => {
      if (refuse) return false
      sent.push(message)
      return true
    })
    pick(screen.container, new File(["hello"], "note.txt", { type: "text/plain" }))
    await expect.poll(() => FakeXhr.sent.length).toBe(1)
    FakeXhr.sent[0]!.finish()
    await userEvent.keyboard("look{Enter}")
    await expect.poll(() => tiles(screen.container)).toBe(1)

    refuse = false
    await userEvent.keyboard("{Enter}")
    await expect.poll(() => sent.length).toBe(1)
    expect(sent[0]!.attachments).toHaveLength(1)
    await expect.poll(() => tiles(screen.container)).toBe(0)
  })

  it("posts a lone file as its link with no text", async () => {
    using _xhr = fakeXhr()
    room.followRoute(() => ROOM)
    await using screen = await mountComposer((message) => room.send(message) !== undefined)
    pick(screen.container, new File(["hello"], "note.txt", { type: "text/plain" }))
    await expect.poll(() => FakeXhr.sent.length).toBe(1)
    FakeXhr.sent[0]!.finish()
    await userEvent.keyboard("{Enter}")

    await expect.poll(() => delivery.sent.length).toBe(1)
    expect(delivery.sent[0]!.text).toMatch(/^\[note\.txt\]\(attachment:[\w-]+\)$/)
  })

  it("posts four mixed files as their links with no text", async () => {
    using _xhr = fakeXhr()
    room.followRoute(() => ROOM)
    await using screen = await mountComposer((message) => room.send(message) !== undefined)
    pick(
      screen.container,
      new File(["a"], "a.txt", { type: "text/plain" }),
      new File(["b,b"], "b.csv", { type: "text/csv" }),
      new File(["c"], "c.md", { type: "text/markdown" }),
      new File(["d"], "d.json", { type: "application/json" }),
    )
    await expect
      .poll(
        () => {
          for (const xhr of FakeXhr.sent) if (xhr.status === 0) xhr.finish()
          return FakeXhr.sent.length
        },
        { timeout: 10_000 },
      )
      .toBe(4)
    await userEvent.keyboard("{Enter}")

    await expect.poll(() => delivery.sent.length).toBe(1)
    const text = delivery.sent[0]!.text
    const named = Array.from(text.matchAll(/\[([^\]]+)\]\(attachment:[\w-]+\)/g), (match) => match[1])
    expect(named).toEqual(expect.arrayContaining(["a.txt", "b.csv", "c.md", "d.json"]))
    expect(text.replace(/\[[^\]]+\]\(attachment:[\w-]+\)\s*/g, "")).toBe("")
  })
})
