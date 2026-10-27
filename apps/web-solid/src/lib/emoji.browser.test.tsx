import "../index.css"
import { describe, expect, it } from "vitest"
import { render } from "../../test/render"
import { EmojiText, needsEmojiScan } from "./emoji"

describe("emoji text", () => {
  it("skips the emoji scan for plain ASCII so the regex is never built", () => {
    expect(needsEmojiScan("Question 42?\n\n- one\n- two\n\n2 * 3 = 6, #tag, ~ok~")).toBe(false)
    expect(needsEmojiScan("")).toBe(false)
  })

  it("scans text that carries anything above ASCII, emoji or not", () => {
    expect(needsEmojiScan("see you 🎉")).toBe(true)
    expect(needsEmojiScan("café")).toBe(true)
    expect(needsEmojiScan("漢字")).toBe(true)
  })

  it("paints plain text exactly as before, and still splits out an emoji", async () => {
    await using screen = await render(() => (
      <>
        <p data-testid="plain">
          <EmojiText text="Line one 2 * 3 = 6" />
        </p>
        <p data-testid="emoji">
          <EmojiText text="ship it 🚀 now" />
        </p>
      </>
    ))
    const at = (id: string) => screen.container.querySelector<HTMLElement>(`[data-testid="${id}"]`)!
    await expect.element(screen.getByTestId("plain")).toHaveTextContent("Line one 2 * 3 = 6")
    expect(at("plain").querySelector(".font-emoji")).toBeNull()
    await expect.element(screen.getByTestId("emoji")).toHaveTextContent("ship it 🚀 now")
    expect(at("emoji").querySelector(".font-emoji")?.textContent).toBe("🚀")
  })
})
