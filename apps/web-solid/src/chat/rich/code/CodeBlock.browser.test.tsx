import "../../../index.css"
import { parseRichText } from "@kiko/protocol/markdown"
import { describe, expect, it, vi } from "vitest"
import type { JSX } from "solid-js"
import { render } from "../../../../test/render"
import { Collapsible } from "../../Collapsible"
import { RichText } from "../RichText"

const LONG = Array.from({ length: 40 }, (_, i) => `line ${i + 1} ${"x".repeat(180)}`).join("\n")

const fence = (text: string, lang = "py") => parseRichText(`\`\`\`${lang}\n${text}\n\`\`\``)

const block = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-component="chat-code-block"]')!

const pre = (host: HTMLElement) => block(host).querySelector<HTMLElement>(".chat-code-pre")!

const fade = (host: HTMLElement, edge: string) =>
  block(host).querySelector<HTMLElement>(`.chat-code-fade[data-edge="${edge}"]`)!

function Narrow(props: { children: JSX.Element }): JSX.Element {
  return <div style={{ width: "400px" }}>{props.children}</div>
}

describe("CodeBlock", () => {
  it("scrolls a long block in both directions inside its own frame", async () => {
    await using screen = await render(() => (
      <Narrow>
        <RichText tree={fence(LONG)} />
      </Narrow>
    ))
    const scroller = pre(screen.container)

    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    expect(scroller.clientHeight).toBeLessThanOrEqual(420)
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth)
    expect(getComputedStyle(scroller).maskImage).toBe("none")

    scroller.scrollLeft = 120

    expect(scroller.scrollLeft).toBe(120)
  })

  it("shows the right fade at the start and the left fade at the end", async () => {
    await using screen = await render(() => (
      <Narrow>
        <RichText tree={fence(LONG)} />
      </Narrow>
    ))
    const scroller = pre(screen.container)

    expect(fade(screen.container, "right").hasAttribute("data-on")).toBe(true)
    expect(fade(screen.container, "left").hasAttribute("data-on")).toBe(false)

    scroller.scrollLeft = scroller.scrollWidth

    await vi.waitFor(() => expect(fade(screen.container, "left").hasAttribute("data-on")).toBe(true))
    expect(fade(screen.container, "right").hasAttribute("data-on")).toBe(false)
  })

  it("wraps long lines when wrap is on and remembers the choice", async () => {
    await using screen = await render(() => (
      <Narrow>
        <RichText tree={fence(LONG)} />
      </Narrow>
    ))

    await screen.getByRole("button", { name: "Wrap lines" }).click()

    await vi.waitFor(() =>
      expect(pre(screen.container).scrollWidth).toBeLessThanOrEqual(pre(screen.container).clientWidth),
    )
    expect(block(screen.container).hasAttribute("data-wrap")).toBe(true)
    expect(localStorage.getItem("kiko:code-wrap")).toBe("on")
    screen.unmount()

    await using again = await render(() => (
      <Narrow>
        <RichText tree={fence(LONG)} />
      </Narrow>
    ))
    expect(block(again.container).hasAttribute("data-wrap")).toBe(true)

    await again.getByRole("button", { name: "Disable line wrap" }).click()

    await vi.waitFor(() => expect(pre(again.container).scrollWidth).toBeGreaterThan(pre(again.container).clientWidth))
    expect(localStorage.getItem("kiko:code-wrap")).toBe("off")
  })

  it("copies only the code and says so", async () => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
    await using screen = await render(() => <RichText tree={parseRichText("```py\na = 1\nb = 2\n```")} />)

    const selection = window.getSelection()!
    selection.selectAllChildren(pre(screen.container))
    expect(selection.toString().trim()).toBe("a = 1\nb = 2")

    await screen.getByRole("button", { name: "Copy code" }).click()

    await vi.waitFor(() => expect(write).toHaveBeenCalledWith("a = 1\nb = 2"))
    expect(screen.getByRole("button", { name: "Copied" }).element()).toBeTruthy()
  })

  it("keeps a code block whole when a collapsed message clamps through it", async () => {
    const intro = "Filler sentence that takes up room in a collapsed message. ".repeat(12)
    await using screen = await render(() => (
      <div style={{ width: "640px" }}>
        <Collapsible messageId="code-clamp">
          <p>{intro}</p>
          <RichText tree={fence(LONG)} />
        </Collapsible>
      </div>
    ))
    const collapsible = screen.container.querySelector<HTMLElement>('[data-component="chat-collapsible"]')!
    const clip = collapsible.firstElementChild as HTMLElement
    const scroller = pre(screen.container)

    expect(collapsible.hasAttribute("data-collapsed")).toBe(true)
    expect(screen.getByRole("button", { name: "Show more" }).element()).toBeTruthy()
    const blockBottom = block(screen.container).getBoundingClientRect().bottom
    expect(blockBottom).toBeLessThanOrEqual(clip.getBoundingClientRect().bottom + 0.5)
    const maskStop = /(\d+(?:\.\d+)?)px/.exec(getComputedStyle(clip).maskImage)
    expect(Number(maskStop?.[1])).toBeGreaterThanOrEqual(blockBottom - clip.getBoundingClientRect().top - 0.5)

    scroller.scrollLeft = 100

    expect(scroller.scrollLeft).toBe(100)
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

  it("scrolls a long fence sideways in the markdown file viewer", async () => {
    const text = ["# Notes", "", "A long fence:", "", "```ts", LONG, "```"].join("\n")
    await using screen = await render(() => (
      <div style={{ width: "720px" }}>
        <RichText tree={parseRichText(text)} class="fv-markdown mx-auto max-w-[68ch] p-6" />
      </div>
    ))
    const scroller = pre(screen.container)

    expect(block(screen.container)).toBeTruthy()
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth)
  })
})
