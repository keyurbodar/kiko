import "../index.css"
import { createSignal } from "solid-js"
import { describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { render } from "../../test/render"
import ModelPickerPanel from "./model-picker-panel"

describe("model picker panel", () => {
  it("stays on top of the composer when the composer changes height", async () => {
    await page.viewport(1200, 800)
    const [tall, setTall] = createSignal(true)
    let trigger: HTMLButtonElement | undefined
    await using screen = await render(() => (
      <div
        class="composer-form"
        style={{ position: "fixed", left: "100px", width: "700px", bottom: "20px", height: tall() ? "200px" : "90px" }}
      >
        <button ref={trigger} type="button">
          Model
        </button>
        <ModelPickerPanel onPick={() => {}} onOpenChange={() => {}} trigger={() => trigger} />
      </div>
    ))
    const form = screen.container.querySelector<HTMLElement>(".composer-form")!
    const gap = () =>
      Math.round(
        form.getBoundingClientRect().top -
          document.querySelector<HTMLElement>('[data-component="model-picker"]')!.getBoundingClientRect().bottom,
      )

    await expect.poll(() => document.querySelector('[data-component="model-picker"]')).not.toBeNull()
    const settled = gap()
    setTall(false)
    await expect.poll(gap).toBe(settled)
  })

  it("lines its right edge up with the model button on the composer", async () => {
    await page.viewport(1200, 800)
    let trigger: HTMLButtonElement | undefined
    await using screen = await render(() => (
      <div
        class="composer-form"
        style={{ position: "fixed", left: "100px", width: "700px", bottom: "20px", height: "120px" }}
      >
        <button ref={trigger} type="button" style={{ position: "absolute", right: "60px", bottom: "12px" }}>
          Model
        </button>
        <ModelPickerPanel onPick={() => {}} onOpenChange={() => {}} trigger={() => trigger} />
      </div>
    ))
    const panel = () => document.querySelector<HTMLElement>('[data-component="model-picker"]')
    await expect.poll(panel).not.toBeNull()
    const form = screen.container.querySelector<HTMLElement>(".composer-form")!.getBoundingClientRect()
    const button = trigger!.getBoundingClientRect()
    const box = panel()!.getBoundingClientRect()
    expect(Math.round(box.right)).toBe(Math.round(button.right))
    expect(box.bottom).toBeLessThanOrEqual(form.top)
  })
})
