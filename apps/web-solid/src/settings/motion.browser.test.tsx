import "../index.css"
import { glide } from "@kiko/ui/v2/glide"
import { TabsPill, TabsV2 as Tabs } from "@kiko/ui/v2/tabs-v2"
import { createSignal, For, onMount } from "solid-js"
import { describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { render } from "../../test/render"

const SECTIONS = ["Account", "Models", "Appearance"] as const

function Nav() {
  const [current, setCurrent] = createSignal<string>("Account")
  let host!: HTMLElement
  let mark!: HTMLSpanElement
  onMount(() =>
    glide(host, mark, {
      attributes: ["aria-current"],
      find: (nav) => nav.querySelector<HTMLElement>('[aria-current="page"]'),
    }),
  )
  return (
    <nav ref={host} style={{ position: "relative", display: "flex", "flex-direction": "column", gap: "4px" }}>
      <span ref={mark} data-testid="glide" data-slot="glide" data-hidden="" />
      <For each={SECTIONS}>
        {(name) => (
          <button
            type="button"
            style={{ height: "34px" }}
            aria-current={current() === name ? "page" : undefined}
            onClick={() => setCurrent(name)}
          >
            {name}
          </button>
        )}
      </For>
    </nav>
  )
}

describe("motion indicators", () => {
  it("moves the tab pill onto the selected tab", async () => {
    await using screen = await render(() => (
      <Tabs defaultValue="agents">
        <Tabs.List class="kit-tabs" aria-label="Models">
          <TabsPill data-testid="pill" />
          <Tabs.Trigger value="agents" class="kit-tab">
            Agents
          </Tabs.Trigger>
          <Tabs.Trigger value="providers" class="kit-tab">
            Providers
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs>
    ))
    const providers = screen.getByRole("tab", { name: "Providers" })
    await providers.click()
    await expect.element(providers).toHaveAttribute("aria-selected", "true")
    const tab = providers.element() as HTMLElement
    await expect
      .element(screen.getByTestId("pill"))
      .toHaveAttribute("style", `transform: translateX(${tab.offsetLeft}px); width: ${tab.offsetWidth}px;`)
  })

  it("keeps the nav highlight under the current row and hides it when no row is current", async () => {
    await using screen = await render(() => <Nav />)
    const highlight = screen.getByTestId("glide")
    const account = page.getByRole("button", { name: "Account" }).element() as HTMLElement
    await expect.element(highlight).not.toHaveAttribute("data-hidden")
    expect(highlight.element().getAttribute("style")).toContain(`translate(0px, ${account.offsetTop}px)`)

    await page.getByRole("button", { name: "Appearance" }).click()
    const appearance = page.getByRole("button", { name: "Appearance" }).element() as HTMLElement
    await expect
      .element(highlight)
      .toHaveAttribute("style", expect.stringContaining(`translate(0px, ${appearance.offsetTop}px)`))
    expect(highlight.element().getAttribute("style")).toContain(`height: ${appearance.offsetHeight}px`)

    appearance.removeAttribute("aria-current")
    await expect.element(highlight).toHaveAttribute("data-hidden", "")
  })
})
