import type { AgentSlug, RoomId } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { authorFacets, byAuthor, knownAuthor } from "./author"

const kiko = "kiko" as AgentSlug
const juno = "juno" as AgentSlug
const trip = "room-trip" as RoomId
const files = [
  { madeBy: null, roomId: null },
  { madeBy: kiko, roomId: trip },
  { madeBy: juno, roomId: trip },
  { madeBy: kiko, roomId: null },
  { madeBy: null, roomId: trip },
]

describe("author filter", () => {
  it("counts files by you, by each agent and by each chat, busiest first", () => {
    expect(authorFacets(files)).toEqual({
      you: 2,
      agents: [
        { slug: kiko, count: 2 },
        { slug: juno, count: 1 },
      ],
      chats: [{ roomId: trip, count: 3 }],
    })
  })

  it("keeps only the files from the chosen author or chat", () => {
    const pick = (author: Parameters<typeof byAuthor>[0]) => files.filter((f) => byAuthor(author, f)).length
    expect(pick("all")).toBe(5)
    expect(pick("you")).toBe(2)
    expect(pick("agent:juno")).toBe(1)
    expect(pick("chat:room-trip")).toBe(3)
  })

  it("falls back to everyone when the chosen author has no files left", () => {
    const facets = authorFacets(files)
    expect(knownAuthor("agent:kiko", facets)).toBe("agent:kiko")
    expect(knownAuthor("agent:stato", facets)).toBe("all")
    expect(knownAuthor("chat:gone", facets)).toBe("all")
    expect(knownAuthor("you", authorFacets([{ madeBy: kiko, roomId: null }]))).toBe("all")
  })
})
