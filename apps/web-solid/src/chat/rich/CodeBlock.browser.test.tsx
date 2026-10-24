import "../../index.css"
import { parseRichText } from "@kiko/protocol/markdown"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import { RichText } from "./RichText"

const lines = (count: number) => Array.from({ length: count }, (_, i) => `print(${i + 1})`).join("\n")

const block = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-component="chat-code-block"]')!

describe("CodeBlock", () => {
  it("numbers every line and keeps the numbers out of the copied selection", async () => {
    await using screen = await render(() => <RichText tree={parseRichText("```py\na = 1\nb = 2\n```")} />)
    const code = block(screen.container)

    expect([...code.querySelectorAll(".rich-code-ln")].map((n) => n.textContent)).toEqual(["1", "2"])
    const selection = window.getSelection()!
    selection.selectAllChildren(code.querySelector("pre")!)
    expect(selection.toString().trim()).toBe("a = 1\nb = 2")
  })

  it("folds long code after eight lines and opens it in place", async () => {
    await using screen = await render(() => <RichText tree={parseRichText(`\`\`\`py\n${lines(38)}\n\`\`\``)} />)
    const fold = screen.getByRole("button", { name: /Show 30 more lines/ })

    expect(block(screen.container).textContent).toContain("38 lines")
    await fold.click()

    await vi.waitFor(() => expect(screen.getByRole("button", { name: /Show less/ }).element()).toBeTruthy())
    expect(block(screen.container).querySelector("pre")!.hasAttribute("data-scrolls")).toBe(true)
  })

  it("puts adjacent named files under one block with a tab each", async () => {
    const tree = parseRichText("```split.py\nimport math\n```\n```README.md\n# Split\n```")
    await using screen = await render(() => <RichText tree={tree} />)

    expect(screen.container.querySelectorAll('[data-component="chat-code-block"]').length).toBe(1)
    expect(block(screen.container).textContent).toContain("import math")

    await screen.getByRole("tab", { name: "README.md" }).click()

    await vi.waitFor(() => expect(block(screen.container).textContent).toContain("# Split"))
    expect(block(screen.container).textContent).not.toContain("import math")
  })
})
