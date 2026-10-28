import { dismissToastV2, showToastV2, ToastV2 } from "@kiko/ui/v2/toast-v2"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../test/render"

describe("toasts", () => {
  it("stacks the newest in front, runs an action once, and leaves when dismissed", async () => {
    await using _screen = await render(() => <ToastV2.Region />)
    const undo = vi.fn()
    showToastV2({ title: "Saved budget.xlsx", variant: "success", persistent: true })
    showToastV2({
      title: "Removed Apartment hunter",
      persistent: true,
      action: { label: "Undo", variant: "secondary", onClick: undo },
    })
    const toasts = () => [...document.querySelectorAll<HTMLElement>("[data-toast-v2-id]:not([data-ending])")]
    await expect.poll(() => toasts().length).toBe(2)
    expect(toasts()[0]?.textContent).toContain("Removed Apartment hunter")
    expect(toasts()[0]?.hasAttribute("data-behind")).toBe(false)
    expect(toasts()[1]?.hasAttribute("data-behind")).toBe(true)

    document.querySelector<HTMLButtonElement>(".toast-v2-action")?.click()
    expect(undo).toHaveBeenCalledTimes(1)
    await expect.poll(() => toasts().length).toBe(1)
    expect(toasts()[0]?.textContent).toContain("Saved budget.xlsx")

    dismissToastV2()
    await expect.poll(() => document.querySelectorAll("[data-toast-v2-id]").length).toBe(0)
  })

  it("replaces an identical toast instead of piling up copies", async () => {
    await using _screen = await render(() => <ToastV2.Region />)
    for (let i = 0; i < 3; i += 1) showToastV2({ title: "Could not save that setting", variant: "error" })
    await expect.poll(() => document.querySelectorAll("[data-toast-v2-id]:not([data-ending])").length).toBe(1)
    dismissToastV2()
    await expect.poll(() => document.querySelectorAll("[data-toast-v2-id]").length).toBe(0)
  })

  it("lands every toast in one stack at the bottom centre", async () => {
    await using _screen = await render(() => <ToastV2.Region />)
    showToastV2({ title: "Saved", variant: "success", persistent: true })
    showToastV2({ title: "Could not save", variant: "error", persistent: true })
    await expect.poll(() => document.querySelectorAll("[data-toast-v2-id]:not([data-ending])").length).toBe(2)
    const region = document.querySelector<HTMLElement>(".toast-v2-region")!.getBoundingClientRect()
    expect(document.querySelectorAll(".toast-v2-region").length).toBe(1)
    expect(Math.abs(region.left + region.width / 2 - window.innerWidth / 2)).toBeLessThan(2)
    expect(region.bottom).toBeGreaterThanOrEqual(window.innerHeight - 40)
    expect(region.width).toBeLessThanOrEqual(360)
    const [front, behind] = [...document.querySelectorAll<HTMLElement>("[data-toast-v2-id]")]
    expect(behind!.getBoundingClientRect().bottom).toBeLessThanOrEqual(front!.getBoundingClientRect().bottom)
    dismissToastV2()
    await expect.poll(() => document.querySelectorAll("[data-toast-v2-id]").length).toBe(0)
  })
})
