import "../index.css"
import type { RecipeCard } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import { page } from "vitest/browser"
import { render } from "../../test/render"

const calls = vi.hoisted(() => ({ added: [] as string[], own: [] as string[] }))

vi.mock("./state", () => ({
  addOwnChat: (_card: unknown, navigate: (roomId: string) => void) => {
    calls.own.push("own")
    navigate("own-room")
  },
  addToTarget: (_card: unknown, target: { roomId: string; agent: string }) => {
    calls.added.push(`${target.roomId}:${target.agent}`)
  },
  isAdded: () => false,
  isOwning: () => false,
  isWaiting: () => false,
  targetsForChat: (roomId: string) => [{ roomId, agent: "juno", name: "Juno" }],
}))
vi.mock("../state/room", () => ({
  room: { bots: () => [{ id: "room-1", name: "Juno" }], chatFaces: () => [] },
}))

const { AddPicker } = await import("./add")

const card: RecipeCard = {
  slug: "sunset",
  title: "Sunset",
  description: "",
  when: "",
  apps: [],
  setup: [],
  agent: { name: "Juno", handle: "juno" },
  custom: false,
  tags: [],
  icon: "",
  glyph: "",
  tone: "amber",
}

describe("AddPicker", () => {
  it("ignores Enter that commits an IME composition, then adds on a plain Enter", async () => {
    calls.added.length = 0
    calls.own.length = 0
    await using _screen = await render(() => <AddPicker card={card} navigate={() => {}} />)
    const input = page.getByRole("textbox", { name: "Choose a chat for Sunset" })
    await expect.element(input).toBeVisible()
    input.element().focus()
    input.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }))
    expect(calls.added).toEqual([])
    expect(calls.own).toEqual([])
    input.element().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(calls.added).toEqual(["room-1:juno"])
    expect(calls.own).toEqual([])
  })
})
