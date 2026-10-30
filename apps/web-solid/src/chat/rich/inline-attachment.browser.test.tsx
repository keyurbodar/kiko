import "../../index.css"
import { describe, expect, it } from "vitest"
import { parseRichText } from "@kiko/protocol/markdown"
import { render } from "../../../test/render"
import { RichText } from "./RichText"

describe("an attachment link in a sent message", () => {
  it("renders one inline chip holding the original file name where the link sat", async () => {
    const tree = parseRichText("See [notes.md](/attachments/m5x2k9-notes.md) please")
    await using screen = await render(() => <RichText tree={tree} />)

    const chips = () => screen.container.querySelectorAll('[data-component="chat-file-chip"]')
    expect(chips()).toHaveLength(1)
    expect(chips()[0]!.querySelector(".lchip-label")?.textContent).toBe("notes.md")

    const body = screen.container.querySelector(".rich")!
    expect(body.textContent).toMatch(/^See\b[\s\S]*notes\.md[\s\S]*please$/)
  })
})
