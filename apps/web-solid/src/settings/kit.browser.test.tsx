import "../index.css"
import { For } from "solid-js"
import { describe, expect, it } from "vitest"
import { render } from "../../test/render"
import { Button } from "./kit"

const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const
const transparent = "rgba(0, 0, 0, 0)"

describe("kit buttons", () => {
  it("gives primary, secondary and danger a visible fill and leaves ghost clear until hover", async () => {
    await using screen = await render(() => (
      <For each={VARIANTS}>{(variant) => <Button variant={variant}>{variant}</Button>}</For>
    ))
    const fill = (name: string) => getComputedStyle(screen.getByRole("button", { name }).element()).backgroundColor
    expect(fill("primary")).not.toBe(transparent)
    expect(fill("secondary")).not.toBe(transparent)
    expect(fill("danger")).not.toBe(transparent)
    expect(fill("primary")).not.toBe(fill("secondary"))
    expect(fill("ghost")).toBe(transparent)
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
