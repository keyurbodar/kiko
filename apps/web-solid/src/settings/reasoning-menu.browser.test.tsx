import "../index.css"
import type { ThinkingLevel } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { ReasoningMenu } from "./reasoning-menu"

const LEVELS: readonly ThinkingLevel[] = ["off", "low", "medium", "high"]

function Harness(props: { levels?: readonly ThinkingLevel[]; initial?: ThinkingLevel }) {
  const [value, setValue] = createSignal<ThinkingLevel | undefined>(props.initial)
  return (
    <>
      <ReasoningMenu levels={props.levels} value={value()} onChange={setValue} />
      <output data-testid="level">{value() ?? "none"}</output>
    </>
  )
}

describe("ReasoningMenu", () => {
  it("shows the level on the trigger and opens a slider on it", async () => {
    await using screen = await render(() => <Harness levels={LEVELS} initial="low" />)
    await expect.element(screen.getByRole("button", { name: "Reasoning" })).toHaveTextContent("Low")
    await screen.getByRole("button", { name: "Reasoning" }).click()
    const slider = page.getByRole("slider", { name: "Reasoning" })
    await expect.element(slider).toHaveFocus()
    await expect.element(slider).toHaveAttribute("aria-valuetext", "Low")
    await expect.element(slider).toHaveAttribute("aria-valuemax", "3")
  })

  it("snaps to each level with the arrow keys and Home and End", async () => {
    await using screen = await render(() => <Harness levels={LEVELS} initial="low" />)
    await screen.getByRole("button", { name: "Reasoning" }).click()
    await userEvent.keyboard("{ArrowRight}")
    await expect.element(screen.getByTestId("level")).toHaveTextContent("medium")
    await userEvent.keyboard("{End}")
    await expect.element(screen.getByTestId("level")).toHaveTextContent("high")
    await userEvent.keyboard("{Home}")
    await expect.element(screen.getByTestId("level")).toHaveTextContent("off")
    await expect.element(page.getByRole("slider")).toHaveAttribute("aria-valuetext", "Off")
  })

  it("closes with Escape and returns focus to the trigger", async () => {
    await using screen = await render(() => <Harness levels={LEVELS} initial="low" />)
    const trigger = screen.getByRole("button", { name: "Reasoning" })
    await trigger.click()
    await userEvent.keyboard("{Escape}")
    await expect.element(page.getByRole("slider")).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  })

  it("is absent for a model that cannot reason", async () => {
    await using screen = await render(() => <Harness levels={["off"]} initial="off" />)
    await expect.element(screen.getByRole("button", { name: "Reasoning" })).not.toBeInTheDocument()
  })

  it("opens above the trigger inside the composer", async () => {
    await using screen = await render(() => (
      <form
        class="composer-form"
        style={{ position: "fixed", left: "16px", top: "220px", width: "320px", padding: "40px 24px" }}
      >
        <Harness levels={LEVELS} initial="low" />
      </form>
    ))
    const trigger = screen.getByRole("button", { name: "Reasoning" })
    await trigger.click()
    await expect.element(page.getByRole("dialog", { name: "Reasoning" })).toBeVisible()
    const panel = page.getByRole("dialog", { name: "Reasoning" }).element().getBoundingClientRect()
    const anchor = trigger.element().getBoundingClientRect()
    const form = document.querySelector(".composer-form")!.getBoundingClientRect()
    expect(panel.left).toBe(anchor.left)
    expect(panel.bottom).toBeLessThanOrEqual(form.top)
  })

  it("is absent until a model is chosen", async () => {
    await using screen = await render(() => <Harness />)
    await expect.element(screen.getByRole("button", { name: "Reasoning" })).not.toBeInTheDocument()
  })
})
