import "../../index.css"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import { MessageAttachments } from "./Attachments"

vi.mock("../side/surfaces", () => ({ openFile: () => {} }))

const file = (name: string) => ({ name, size: 340 * 1024, type: "application/octet-stream", src: "data:,x" })

describe("MessageAttachments", () => {
  it("shows the file size and three files until asked for the rest", async () => {
    const names = ["flight_tickets.pdf", "visa_letter.docx", "expenses.csv", "hotel.xlsx", "notes.md"]
    await using screen = await render(() => <MessageAttachments files={names.map(file)} roomId="room" />)
    const rows = () => screen.container.querySelectorAll('[data-component="chat-attachment-file"]')

    expect(rows().length).toBe(3)
    expect(rows()[0]!.textContent).toContain("flight_tickets.pdf340 KB")
    expect(screen.getByRole("button", { name: "Download all" }).element()).toBeTruthy()

    await screen.getByRole("button", { name: "Show 2 more" }).click()

    await vi.waitFor(() => expect(rows().length).toBe(5))
  })
})
