import "../../index.css"
import { Suspense } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
import { render } from "../../../test/render"
import { EmojiPicker } from "./EmojiPicker"

const ENTRIES = vi.hoisted(() => [
  {
    emoji: "🍏",
    annotation: "green apple",
    shortcodes: [":green_apple:"],
    tags: [],
    group: 4,
    order: 1,
    version: 1,
  },
  {
    emoji: "🍎",
    annotation: "red apple",
    shortcodes: [":apple:"],
    tags: [],
    group: 4,
    order: 2,
    version: 1,
  },
  {
    emoji: "😀",
    annotation: "grinning face",
    shortcodes: [":grinning:"],
    tags: [],
    group: 0,
    order: 3,
    version: 1,
  },
])

vi.mock("../../lib/emoji-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/emoji-data")>()
  return { ...actual, loadEmoji: () => Promise.resolve(ENTRIES) }
})

describe("emoji picker a11y", () => {
  it("tells screen readers which emoji the arrows highlight", async () => {
    await using _screen = await render(() => (
      <Suspense>
        <EmojiPicker onSelect={() => {}} />
      </Suspense>
    ))
    const input = page.getByRole("searchbox", { name: "Search emoji" })
    await expect.element(input).toBeVisible()
    input.element().focus()
    await expect.element(input).toHaveFocus()
    expect(input.element().hasAttribute("aria-activedescendant")).toBe(false)
    await userEvent.keyboard("{ArrowDown}")
    const active = page.getByRole("option", { selected: true })
    await expect.element(active).toBeVisible()
    const search = document.querySelector<HTMLInputElement>('[data-component="emoji-search"]')!
    expect(search.getAttribute("aria-activedescendant")).toBe(active.element().id)
    const before = active.element()
    await userEvent.keyboard("{ArrowRight}")
    const next = page.getByRole("option", { selected: true })
    await expect.element(next).toBeVisible()
    expect(next.element()).not.toBe(before)
    expect(search.getAttribute("aria-activedescendant")).toBe(next.element().id)
  })
})
