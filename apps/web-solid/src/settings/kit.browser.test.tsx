import "../index.css"
import { SearchField } from "@kiko/ui/v2/search-field"
import { Segmented } from "@kiko/ui/v2/segmented"
import { createSignal, For } from "solid-js"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { Button } from "./kit"

const VARIANTS = ["primary", "secondary", "accent", "danger", "ghost", "outline"] as const
const SIZES = { sm: 20, md: 24, lg: 28, xl: 32 } as const
const transparent = "rgba(0, 0, 0, 0)"

describe("kit buttons", () => {
  it("fills primary, secondary, accent and danger and leaves ghost and outline clear until hover", async () => {
    await using screen = await render(() => (
      <For each={VARIANTS}>{(variant) => <Button variant={variant}>{variant}</Button>}</For>
    ))
    const style = (name: string) => getComputedStyle(screen.getByRole("button", { name }).element())
    const fills = ["primary", "secondary", "accent", "danger"].map((name) => style(name).backgroundColor)
    expect(fills).not.toContain(transparent)
    expect(new Set(fills).size).toBe(fills.length)
    expect(style("ghost").backgroundColor).toBe(transparent)
    expect(style("outline").backgroundColor).toBe(transparent)
    expect(style("outline").borderTopColor).not.toBe(transparent)
  })

  it("sizes buttons on the 20, 24, 28 and 32 control grid", async () => {
    await using screen = await render(() => (
      <For each={Object.keys(SIZES) as (keyof typeof SIZES)[]}>{(size) => <Button size={size}>{size}</Button>}</For>
    ))
    for (const [size, height] of Object.entries(SIZES)) {
      expect(screen.getByRole("button", { name: size }).element().getBoundingClientRect().height).toBe(height)
    }
  })

  it("tints a toned secondary button instead of filling it solid", async () => {
    await using screen = await render(() => (
      <>
        <Button variant="danger">Solid</Button>
        <Button tone="danger">Soft</Button>
      </>
    ))
    const style = (name: string) => getComputedStyle(screen.getByRole("button", { name }).element())
    expect(style("Soft").backgroundColor).not.toBe(style("Solid").backgroundColor)
    expect(style("Soft").color).toBe(style("Solid").backgroundColor)
  })

  it("styles a button with no variant as secondary", async () => {
    await using screen = await render(() => (
      <>
        <Button>Plain</Button>
        <Button variant="secondary">Secondary</Button>
      </>
    ))
    const fill = (name: string) => getComputedStyle(screen.getByRole("button", { name }).element()).backgroundColor
    expect(fill("Plain")).toBe(fill("Secondary"))
    expect(fill("Plain")).not.toBe(transparent)
  })
})

describe("search field", () => {
  it("clears on the first Escape and lets the second one reach the dialog", async () => {
    const escapes: string[] = []
    await using screen = await render(() => {
      const [query, setQuery] = createSignal("")
      return (
        <div onKeyDown={(event) => event.key === "Escape" && escapes.push(query())}>
          <SearchField aria-label="Search things" value={query()} onValue={setQuery} />
        </div>
      )
    })
    const field = screen.getByRole("searchbox", { name: "Search things" })
    await field.click()
    await userEvent.keyboard("kiko")
    await expect.element(screen.getByRole("button", { name: "Clear search" })).toBeVisible()

    await userEvent.keyboard("{Escape}")
    await expect.element(field).toHaveValue("")
    expect(escapes).toEqual([])
    await expect.element(screen.getByRole("button", { name: "Clear search" })).not.toBeInTheDocument()

    await userEvent.keyboard("{Escape}")
    expect(escapes).toEqual([""])
  })

  it("empties the field from the clear button and keeps focus in it", async () => {
    await using screen = await render(() => {
      const [query, setQuery] = createSignal("tools")
      return <SearchField aria-label="Search tools" value={query()} onValue={setQuery} />
    })
    await screen.getByRole("button", { name: "Clear search" }).click()
    const field = screen.getByRole("searchbox", { name: "Search tools" })
    await expect.element(field).toHaveValue("")
    await expect.element(field).toHaveFocus()
  })
})

describe("segmented control", () => {
  const OPTIONS = [
    { value: "off", label: "Off" },
    { value: "digest", label: "Daily digest" },
    { value: "chat", label: "In chat only" },
  ] as const

  it("sizes cells to their labels and slides the pill onto the checked one", async () => {
    await using screen = await render(() => {
      const [value, setValue] = createSignal<(typeof OPTIONS)[number]["value"]>("off")
      return <Segmented label="Initiative" value={value()} options={OPTIONS} onChange={setValue} />
    })
    const off = screen.getByRole("radio", { name: "Off" }).element() as HTMLElement
    const digest = screen.getByRole("radio", { name: "Daily digest" })
    expect(off.offsetWidth).toBeLessThan((digest.element() as HTMLElement).offsetWidth)

    await digest.click()
    await expect.element(digest).toHaveAttribute("aria-checked", "true")
    const cell = digest.element() as HTMLElement
    const pill = screen.container.querySelector<HTMLElement>("[data-slot=segmented-pill]")!
    await expect
      .poll(() => pill.getAttribute("style"))
      .toBe(`width: ${cell.offsetWidth}px; transform: translateX(${cell.offsetLeft}px);`)
  })

  it("moves the choice with arrow keys", async () => {
    await using screen = await render(() => {
      const [value, setValue] = createSignal<(typeof OPTIONS)[number]["value"]>("off")
      return <Segmented label="Initiative" value={value()} options={OPTIONS} onChange={setValue} />
    })
    await screen.getByRole("radio", { name: "Off" }).click()
    await userEvent.keyboard("{ArrowRight}")
    await expect.element(screen.getByRole("radio", { name: "Daily digest" })).toHaveAttribute("aria-checked", "true")
    await expect.element(screen.getByRole("radio", { name: "Daily digest" })).toHaveFocus()
  })
})
