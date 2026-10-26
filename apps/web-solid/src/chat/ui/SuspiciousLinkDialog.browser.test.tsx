import "../../index.css"
import { createSignal, Show } from "solid-js"
import { describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { render } from "../../../test/render"
import { SuspiciousLinkDialog } from "./SuspiciousLinkDialog"

describe("suspicious link dialog", () => {
  it("shows what the link says next to where it goes and focuses going back", async () => {
    await using screen = await render(() => {
      const [href, setHref] = createSignal<string | null>(null)
      return (
        <>
          <button
            type="button"
            data-component="chat-masked-link"
            onClick={() => setHref("https://evil.example.com/login?next=shop")}
          >
            shop.example
          </button>
          <Show when={href()}>{(h) => <SuspiciousLinkDialog href={h()} onClose={() => setHref(null)} />}</Show>
        </>
      )
    })
    await screen.getByRole("button", { name: "shop.example" }).click()
    const dialog = page.getByRole("dialog", { name: "This link goes somewhere else" })
    await expect.element(dialog).toBeVisible()
    await expect.element(dialog.getByText("shop.example")).toBeVisible()
    await expect.element(dialog.getByRole("definition").last()).toHaveTextContent("evil.example.com/login?next=shop")
    await expect.element(dialog.getByRole("button", { name: "Go back" })).toHaveFocus()

    await dialog.getByRole("button", { name: "Go back" }).click()
    await expect.element(dialog).not.toBeInTheDocument()
  })
})
