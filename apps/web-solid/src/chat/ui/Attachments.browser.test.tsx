import "../../index.css"
import { describe, expect, it, vi } from "vitest"
import type { JSX } from "solid-js"
import { render } from "../../../test/render"
import { MessageAttachments } from "./Attachments"
import { Bubble, BubbleContent } from "./bubble"

vi.mock("../side/surfaces", () => ({ openFile: () => {} }))

const file = (name: string) => ({ name, size: 340 * 1024, type: "application/octet-stream", src: "data:,x" })

describe("MessageAttachments", () => {
  it("names the file kind and shows three files until asked for the rest", async () => {
    const names = ["flight_tickets.pdf", "visa_letter.docx", "expenses.csv", "hotel.xlsx", "notes.md"]
    await using screen = await render(() => <MessageAttachments files={names.map(file)} roomId="room" />)
    const rows = () => screen.container.querySelectorAll('[data-component="chat-attachment-file"]')

    expect(rows().length).toBe(3)
    expect(rows()[0]!.textContent).toContain("PDF, 340 KB")
    expect(screen.getByRole("button", { name: "Download all" }).element()).toBeTruthy()

    await screen.getByRole("button", { name: "Show 2 more" }).click()

    await vi.waitFor(() => expect(rows().length).toBe(5))
  })
})

const attachments = ["flight_tickets.pdf", "notes.md", "booking.zip"].map(file)

const bubble = (children: JSX.Element) => (
  <div style={{ width: "390px" }}>
    <Bubble align="end">
      <BubbleContent>{children}</BubbleContent>
    </Bubble>
  </div>
)

const contentOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-slot="bubble-content"]')!

describe("attachments-only messages", () => {
  it("draws no bubble fill or padding around attachments with no text", async () => {
    await using screen = await render(() => bubble(<MessageAttachments files={attachments} roomId="room" />))
    const style = getComputedStyle(contentOf(screen.container))

    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)")
    expect(style.paddingLeft).toBe("0px")
    expect(style.paddingTop).toBe("0px")
  })

  it("keeps the card inside the bubble column at 390", async () => {
    await using screen = await render(() => bubble(<MessageAttachments files={attachments} roomId="room" />))
    const content = contentOf(screen.container)
    const card = screen.container.querySelector<HTMLElement>(".att-files")!

    expect(card.getBoundingClientRect().width).toBeLessThanOrEqual(content.getBoundingClientRect().width)
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
  })

  it("keeps the bubble fill and padding when the message has text", async () => {
    await using screen = await render(() =>
      bubble(
        <>
          <MessageAttachments files={attachments} roomId="room" />
          <p class="rich">Here are the tickets.</p>
        </>,
      ),
    )
    const style = getComputedStyle(contentOf(screen.container))

    expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)")
    expect(style.paddingLeft).not.toBe("0px")
  })
})
