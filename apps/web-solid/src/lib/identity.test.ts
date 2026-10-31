import { describe, expect, it } from "vitest"
import { chatFaces, chatSlugs } from "./identity"

const agents = [
  { id: "a1", slug: "aria" },
  { id: "a2", slug: "milo" },
  { id: "a3", slug: "juno" },
  { id: "a4", slug: "pax" },
]

describe("chatSlugs", () => {
  it("leads a group with Kiko and keeps every member", () => {
    expect(chatSlugs({ roomId: "r", agents: ["a1", "a2", "a3", "a4"] }, agents)).toEqual([
      "kiko",
      "aria",
      "milo",
      "juno",
      "pax",
    ])
  })

  it("keeps a one-agent chat to that agent", () => {
    expect(chatSlugs({ roomId: "r", agents: ["a1"] }, agents)).toEqual(["aria"])
  })

  it("falls back to Kiko when the chat has no agents", () => {
    expect(chatSlugs({ roomId: "r" }, agents)).toEqual(["kiko"])
  })
})

describe("chatFaces", () => {
  it("shows at most three faces of a larger group", () => {
    expect(chatFaces({ roomId: "r", agents: ["a1", "a2", "a3", "a4"] }, agents)).toEqual(["kiko", "aria", "milo"])
  })
})
