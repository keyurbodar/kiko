import "../index.css"
import type { ThinkingLevel } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { ReasoningChoices, ReasoningMenu } from "./reasoning-menu"

const LEVELS: readonly ThinkingLevel[] = ["off", "low", "medium", "high"]

function Harness(props: { levels?: readonly ThinkingLevel[]; initial?: ThinkingLevel; pills?: boolean }) {
  const [value, setValue] = createSignal<ThinkingLevel | undefined>(props.initial)
  const [saves, setSaves] = createSignal(0)
  const save = (level: ThinkingLevel) => {
    setSaves((n) => n + 1)
    setValue(level)
  }
  return (
    <>
      {props.pills ? (
        <ReasoningChoices levels={props.levels ?? []} value={value() ?? "off"} onChange={save} />
      ) : (
        <ReasoningMenu levels={props.levels} value={value()} onChange={save} />
      )}
      <output data-testid="level">{value() ?? "none"}</output>
      <output data-testid="saves">{saves()}</output>
    </>
  )
}

describe("ReasoningMenu", () => {
  it("lists every level with the current one checked and Medium marked as the default", async () => {
    await using screen = await render(() => <Harness levels={LEVELS} initial="low" />)
    await expect.element(screen.getByRole("button", { name: "Reasoning" })).toHaveTextContent("Low")
    await screen.getByRole("button", { name: "Reasoning" }).click()
    const items = page.getByRole("menuitemradio")
    await expect.element(items.nth(0)).toBeVisible()
    expect(items.elements().map((item) => item.textContent)).toEqual(["Off", "Low", "MediumDefault", "High"])
    await expect.element(page.getByRole("menuitemradio", { name: "Low" })).toHaveAttribute("aria-checked", "true")
  })

  it("saves the picked level once and closes", async () => {
    await using screen = await render(() => <Harness levels={LEVELS} initial="low" />)
    await screen.getByRole("button", { name: "Reasoning" }).click()
    await page.getByRole("menuitemradio", { name: "High" }).click()
    await expect.element(screen.getByTestId("level")).toHaveTextContent("high")
    await expect.element(screen.getByTestId("saves")).toHaveTextContent("1")
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument()
  })

  it("shows the default level when none is stored", async () => {
    await using screen = await render(() => <Harness levels={["minimal", "low", "medium", "high"]} />)
    await expect.element(screen.getByRole("button", { name: "Reasoning" })).toHaveTextContent("Medium")
  })

  it("closes with Escape without saving", async () => {
    await using screen = await render(() => <Harness levels={LEVELS} initial="low" />)
    await screen.getByRole("button", { name: "Reasoning" }).click()
    await userEvent.keyboard("{Escape}")
    await expect.element(page.getByRole("menu")).not.toBeInTheDocument()
    await expect.element(screen.getByTestId("saves")).toHaveTextContent("0")
  })

  it("is absent for a model that cannot reason", async () => {
    await using screen = await render(() => <Harness levels={["off"]} initial="off" />)
    await expect.element(screen.getByRole("button", { name: "Reasoning" })).not.toBeInTheDocument()
  })

  it("is absent until a model is chosen", async () => {
    await using screen = await render(() => <Harness />)
    await expect.element(screen.getByRole("button", { name: "Reasoning" })).not.toBeInTheDocument()
  })
})

describe("ReasoningChoices", () => {
  it("saves a tapped level once", async () => {
    await using screen = await render(() => <Harness pills levels={LEVELS} initial="low" />)
    await expect.element(screen.getByRole("radio", { name: "Low" })).toHaveAttribute("aria-checked", "true")
    await screen.getByRole("radio", { name: /Medium/ }).click()
    await expect.element(screen.getByTestId("level")).toHaveTextContent("medium")
    await expect.element(screen.getByTestId("saves")).toHaveTextContent("1")
  })
})
