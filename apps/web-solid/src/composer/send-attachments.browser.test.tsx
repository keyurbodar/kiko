import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import type { OutgoingMessage, RosterBot } from "../lib/types"
import { Composer } from "./composer"

const ROOM = "01900000-0000-7000-8000-000000000053"

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
}

const BOTS: RosterBot[] = [
  { id: "kiko", name: "Kiko", preview: "", updatedAt: 0, presence: "idle", unread: 0, pinned: false },
]

function fakeXhr() {
  FakeXhr.sent = []
  vi.stubGlobal("XMLHttpRequest", FakeXhr)
  return { [Symbol.dispose]: () => void vi.unstubAllGlobals() }
}

async function mountComposer(onSend: (message: OutgoingMessage) => boolean | void) {
  const screen = await render(() => <Composer threadId={ROOM} bots={BOTS} onSend={onSend} />)
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

describe("sending attachments", () => {
  it("sends the attachment once it finishes uploading and empties the tray", async () => {
    using _xhr = fakeXhr()
    const sent: OutgoingMessage[] = []
    await using screen = await mountComposer((message) => {
      sent.push(message)
      return true
    })
    pick(screen.container, new File(["hello"], "note.txt", { type: "text/plain" }))
    await expect.poll(() => tiles(screen.container)).toBe(1)
    await expect.poll(() => FakeXhr.sent.length).toBe(1)

    await userEvent.keyboard("look{Enter}")
    expect(sent).toEqual([])

    FakeXhr.sent[0]!.finish()
    await expect.poll(() => sent.length).toBe(1)
    expect(sent[0]!.attachments).toHaveLength(1)
    expect(sent[0]!.files?.map((file) => file.name)).toEqual(["note.txt"])
    await expect.poll(() => tiles(screen.container)).toBe(0)
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
    expect(tiles(screen.container)).toBe(1)

    refuse = false
    await userEvent.keyboard("{Enter}")
    await expect.poll(() => sent.length).toBe(1)
    expect(sent[0]!.attachments).toHaveLength(1)
    await expect.poll(() => tiles(screen.container)).toBe(0)
  })
})
