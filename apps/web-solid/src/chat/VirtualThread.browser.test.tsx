import "../index.css"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import type { ChatMessage, RosterBot } from "../lib/types"
import { DateChip } from "./ui/DateChip"
import { VirtualThread } from "./VirtualThread"

const ROOM = "01900000-0000-7000-8000-0000000000cc"

const bots: Record<string, RosterBot> = Object.fromEntries(
  ["kiko", "alpha", "beta", "gamma"].map((id) => [
    id,
    {
      id,
      name: id[0].toUpperCase() + id.slice(1),
      preview: "",
      updatedAt: 0,
      presence: "idle",
      unread: 0,
      pinned: false,
    },
  ]),
)

function groupChat(rounds: number): ChatMessage[] {
  const messages: ChatMessage[] = []
  let sentAt = Date.UTC(2026, 9, 20, 9)
  const push = (message: Pick<ChatMessage, "body"> & Partial<ChatMessage>) => {
    const seq = messages.length + 1
    sentAt += 7 * 60_000
    messages.push({ id: `${seq}.room`, threadId: ROOM, sender: "bot", sentAt, seq, ...message })
  }
  for (let round = 0; round < rounds; round += 1) {
    if (round % 6 === 0) sentAt += 26 * 3_600_000
    push({ sender: "user", body: `Round ${round}, can you all work together on the next line?` })
    push({ botId: "kiko", body: `Sure. I will ask Beta for line ${round}. ${"More words here. ".repeat(round % 4)}` })
    push({ botId: "kiko", to: "beta", body: `Beta, write line ${round}.` })
    push({ botId: "beta", to: "kiko", body: `Line ${round} is ready.` })
    push({ botId: "beta", body: `I posted line ${round}. ${"It stretched out a hand. ".repeat(1 + (round % 3))}` })
    push({ botId: "gamma", body: "Gamma here, waiting." })
  }
  return messages
}

async function mountThread() {
  await page.viewport(1200, 800)
  const [messages, setMessages] = createSignal(groupChat(30))
  const reply = (body: string) =>
    setMessages((list) => {
      const last = list[list.length - 1]
      const seq = (last.seq ?? 0) + 1
      return [
        ...list,
        { id: `${seq}.room`, threadId: ROOM, sender: "bot", botId: "kiko", body, sentAt: last.sentAt + 1_000, seq },
      ]
    })
  const host = document.createElement("div")
  host.style.cssText = "position:fixed;inset:0;width:1000px;height:700px;display:flex;flex-direction:column"
  const screen = await render(
    () => (
      <VirtualThread
        messages={messages()}
        botById={(id) => (id === undefined ? undefined : bots[id])}
        replyParent={() => undefined}
        firstUnreadMessageId={null}
        onJumpToMessage={() => {}}
        onReplyTarget={() => {}}
        scrollRef={() => {}}
        onStateChange={() => {}}
        waitingNames={[]}
        groupChat
        memberSlugs={Object.keys(bots)}
        onReact={() => {}}
        scrollKey={ROOM}
      />
    ),
    { container: host },
  )
  const scroller = host.querySelector<HTMLElement>('[data-component="chat-scroll"]')!
  const atEnd = () => scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
  await vi.waitFor(() => {
    expect(host.querySelectorAll('[data-component="chat-row"]').length).toBeGreaterThan(4)
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight * 2)
    expect(atEnd()).toBeLessThan(1)
  })
  return { screen, host, scroller, atEnd, reply }
}

const threadToggleBefore = (host: HTMLElement, text: string): HTMLElement | undefined => {
  const row = [...host.querySelectorAll('[data-component="chat-row"]')].find((r) => r.textContent?.includes(text))
  let item = row?.closest('[data-component="chat-vrow"]')?.parentElement?.previousElementSibling
  while (item && !item.querySelector('[data-component="chat-agent-thread"]')) item = item.previousElementSibling
  return item?.querySelector<HTMLElement>('[data-component="chat-agent-thread"] button') ?? undefined
}

describe("VirtualThread scrolling", () => {
  it("keeps an agent thread toggle under the pointer when it opens at the end of the chat", async () => {
    const { screen, host, scroller } = await mountThread()
    await using _ = screen
    const anchor = "I posted line 29."
    const toggle = threadToggleBefore(host, anchor)!
    const top = () => threadToggleBefore(host, anchor)!.getBoundingClientRect().top
    const before = { top: top(), scrollTop: scroller.scrollTop }

    toggle.click()

    await vi.waitFor(() => expect(threadToggleBefore(host, anchor)!.getAttribute("aria-expanded")).toBe("true"))
    expect(top()).toBe(before.top)
    expect(scroller.scrollTop).toBe(before.scrollTop)
  })

  it("keeps the date chip on screen while the pointer rests on it after scrolling stops", async () => {
    const [scrolling, setScrolling] = createSignal(true)
    await using screen = await render(() => (
      <div class="relative h-40 w-96">
        <DateChip
          dayStart={Date.UTC(2026, 9, 22)}
          now={Date.UTC(2026, 9, 24)}
          visible={scrolling()}
          onJumpToDay={() => {}}
        />
      </div>
    ))
    const chip = screen.container.querySelector<HTMLElement>('[data-component="chat-date-chip"]')!

    await userEvent.hover(screen.getByRole("button", { name: "Oct 22" }))
    setScrolling(false)

    expect(chip.hasAttribute("data-visible")).toBe(true)
  })

  it("does not cover the top rows with the date chip when the pointer only rests near the top", async () => {
    const { screen, host, scroller } = await mountThread()
    await using _ = screen
    const chip = host.querySelector<HTMLElement>('[data-component="chat-date-chip"]')!
    const view = scroller.getBoundingClientRect()

    await userEvent.hover(scroller, { position: { x: view.width / 2, y: 20 }, force: true })

    expect(chip.hasAttribute("data-visible")).toBe(false)
  })

  it("follows a reply that arrives while the chat is at its end", async () => {
    const { screen, host, atEnd, reply } = await mountThread()
    await using _ = screen

    reply("A fresh reply at the end.")

    await vi.waitFor(() => {
      expect(host.textContent).toContain("A fresh reply at the end.")
      expect(atEnd()).toBeLessThan(1)
    })
  })

  it("holds the reading position when a reply arrives while scrolled up", async () => {
    const { screen, host, scroller, atEnd, reply } = await mountThread()
    await using _ = screen
    await userEvent.wheel(scroller, { delta: { y: -600 } })
    await vi.waitFor(() => expect(atEnd()).toBeGreaterThan(300))
    const view = scroller.getBoundingClientRect()
    const reading = [...host.querySelectorAll<HTMLElement>('[data-component="chat-row"]')].find(
      (row) => row.getBoundingClientRect().top > view.top + 100,
    )!
    const before = {
      top: reading.getBoundingClientRect().top,
      scrollTop: scroller.scrollTop,
      height: scroller.scrollHeight,
    }

    reply("A reply that lands below the fold.")

    await vi.waitFor(() => expect(scroller.scrollHeight).toBeGreaterThan(before.height))
    expect(reading.getBoundingClientRect().top).toBe(before.top)
    expect(scroller.scrollTop).toBe(before.scrollTop)
  })
})
