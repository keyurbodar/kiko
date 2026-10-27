import "../index.css"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { fakeTimers } from "../../test/timers"
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

async function mountThread(options: { firstUnread?: (messages: ChatMessage[]) => string } = {}) {
  await page.viewport(1200, 800)
  const [messages, setMessages] = createSignal(groupChat(30))
  const [working, setWorking] = createSignal<string[]>([])
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
        firstUnreadMessageId={options.firstUnread?.(messages()) ?? null}
        onJumpToMessage={() => {}}
        onReplyTarget={() => {}}
        scrollRef={() => {}}
        onStateChange={() => {}}
        waitingNames={working()}
        waitingSlugs={working()}
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
  return { screen, host, scroller, atEnd, reply, setWorking, setMessages }
}

const scrollDown = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-component="chat-scroll-down"]')!

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

  it("keeps a sent bubble rising when the server's copy replaces the local one", async () => {
    const { screen, host, setMessages } = await mountThread()
    await using _ = screen
    const neverStale = Date.UTC(2999, 0, 1)
    const sent = {
      threadId: ROOM,
      sender: "user" as const,
      body: "On my way now.",
      sentAt: neverStale,
      clientId: "c-1",
    }

    setMessages((list) => [...list, { ...sent, id: "local:c-1" }])
    const bubble = await vi.waitFor(() => {
      const rising = host.querySelector<HTMLElement>(".motion-bubble-in")
      expect(rising?.textContent).toContain("On my way now.")
      return rising!
    })
    setMessages((list) => list.map((m) => (m.id === "local:c-1" ? { ...sent, id: "181.room", seq: 181 } : m)))

    expect(bubble.isConnected).toBe(true)
    expect(bubble.classList.contains("motion-bubble-in")).toBe(true)
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

  it("shows the faces of the agents working below once the reader is a screen away, then a plain arrow", async () => {
    const { screen, host, scroller, atEnd, setWorking } = await mountThread()
    await using _ = screen
    expect(scrollDown(host).hasAttribute("data-hidden")).toBe(true)

    setWorking(["alpha", "beta"])
    await userEvent.wheel(scroller, { delta: { y: -2400 } })

    await vi.waitFor(() => expect(atEnd()).toBeGreaterThan(scroller.clientHeight))
    await vi.waitFor(() => expect(scrollDown(host).hasAttribute("data-hidden")).toBe(false))
    const faces = [...scrollDown(host).querySelectorAll('[data-component="identity-avatar"]')]
    expect(faces.map((face) => face.getAttribute("data-seed"))).toEqual(["alpha", "beta"])

    setWorking([])

    await vi.waitFor(() => expect(scrollDown(host).hasAttribute("data-working")).toBe(false))
    expect(scrollDown(host).querySelector('[data-component="identity-avatar"]')).toBeNull()
  })

  it("dots the scroll button when a reply lands below, and clears it at the end", async () => {
    const { screen, host, scroller, atEnd, reply } = await mountThread()
    await using _ = screen
    await userEvent.wheel(scroller, { delta: { y: -2400 } })
    await vi.waitFor(() => expect(scrollDown(host).hasAttribute("data-hidden")).toBe(false))

    reply("Landed while you were reading above.")

    await vi.waitFor(() => expect(host.querySelector('[data-component="chat-scroll-down-new"]')).not.toBeNull())

    scrollDown(host).click()

    await vi.waitFor(() => expect(atEnd()).toBeLessThan(1))
    expect(host.querySelector('[data-component="chat-scroll-down-new"]')).toBeNull()
  })

  it("lands at the end from the top of a long chat within a quarter second", async () => {
    const { screen, host, scroller, atEnd } = await mountThread()
    await using _ = screen
    await userEvent.wheel(scroller, { delta: { y: -100_000 } })
    await vi.waitFor(() => expect(scroller.scrollTop).toBe(0))
    expect(atEnd()).toBeGreaterThan(scroller.clientHeight * 10)

    using _timers = fakeTimers()
    scrollDown(host).click()
    vi.advanceTimersByTime(250)

    expect(atEnd()).toBeLessThan(1)
  })

  it("draws the rows again where the reader was after the thread is moved in the page", async () => {
    const { screen, host, scroller } = await mountThread()
    await using _ = screen
    const shown = () => {
      const view = scroller.getBoundingClientRect()
      return [...host.querySelectorAll('[data-component="chat-vrow"]')].filter((row) => {
        const box = row.getBoundingClientRect()
        return box.bottom > view.top && box.top < view.bottom
      }).length
    }
    await userEvent.wheel(scroller, { delta: { y: -2400 } })
    await vi.waitFor(() => expect(scrollDown(host).hasAttribute("data-hidden")).toBe(false))
    await vi.waitFor(() => expect(shown()).toBeGreaterThan(0))
    const reading = scroller.scrollTop

    scroller.parentElement!.insertBefore(scroller, scroller.nextSibling)
    expect(scroller.scrollTop).toBe(0)
    scroller.dispatchEvent(new PointerEvent("pointerenter"))

    await vi.waitFor(() => expect(Math.abs(scroller.scrollTop - reading)).toBeLessThan(scroller.clientHeight))
    expect(shown()).toBeGreaterThan(0)
  })

  it("leaves the reader inside a tall live run below the last message", async () => {
    const { screen, host, scroller, atEnd, setWorking } = await mountThread()
    await using _ = screen
    setWorking(["kiko"])
    const typing = await vi.waitFor(() => host.querySelector<HTMLElement>('[data-component="chat-typing-row"]')!)
    const steps = document.createElement("div")
    steps.style.height = "3000px"
    typing.append(steps)
    await vi.waitFor(() => expect(atEnd()).toBeLessThan(1))
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -1500 }))
    scroller.scrollTop -= 1500
    await vi.waitFor(() => expect(atEnd()).toBeGreaterThan(1000))
    const reading = scroller.scrollTop

    using _timers = fakeTimers()
    for (let check = 0; check < 4; check += 1) {
      vi.advanceTimersByTime(200)
      scroller.dispatchEvent(new Event("scroll"))
    }

    expect(scroller.scrollTop).toBe(reading)
  })

  it("shows who wrote above the view and jumps to the first unread message", async () => {
    const { screen, host, scroller } = await mountThread({ firstUnread: (messages) => messages[100]!.id })
    const first = () => host.querySelector('[data-message-id="101.room"]')?.getBoundingClientRect()
    await using _ = screen
    const pill = () => host.querySelector<HTMLButtonElement>('[data-component="chat-new-above"]')

    await vi.waitFor(() => expect(pill()?.textContent).toContain("new above"))
    expect(pill()!.querySelectorAll('[data-component="identity-avatar"]').length).toBeGreaterThan(0)

    pill()!.click()

    await vi.waitFor(() => {
      const row = first()
      const view = scroller.getBoundingClientRect()
      expect(row && row.bottom > view.top && row.top < view.bottom).toBe(true)
    })
    await vi.waitFor(() => expect(pill()).toBeNull())
  })
})
