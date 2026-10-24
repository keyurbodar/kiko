import "../index.css"
import type { ThinkingLevel } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { ReasoningMenu } from "./reasoning-menu"

const LEVELS: readonly ThinkingLevel[] = ["off", "low", "medium", "high"]

function Harness(props: { levels?: readonly ThinkingLevel[]; initial?: ThinkingLevel; model?: string }) {
  const [value, setValue] = createSignal<ThinkingLevel | undefined>(props.initial)
  return (
    <>
      <ReasoningMenu levels={props.levels} value={value()} onChange={setValue} model={props.model} />
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

  it("greys out for a model that cannot think and says why when pressed", async () => {
    await using screen = await render(() => <Harness levels={["off"]} initial="off" model="Llama 4" />)
    const trigger = screen.getByRole("button", { name: "Reasoning" })
    await expect.element(trigger).toHaveAttribute("aria-disabled", "true")
    await trigger.click({ force: true })
    await expect.element(trigger).toHaveTextContent("Llama 4 doesn't think")
    await expect.element(page.getByRole("slider")).not.toBeInTheDocument()
  })

  it("is absent until a model is chosen", async () => {
    await using screen = await render(() => <Harness />)
    await expect.element(screen.getByRole("button", { name: "Reasoning" })).not.toBeInTheDocument()
  })
})
