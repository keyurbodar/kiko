import { describe, expect, test } from "bun:test"
import { partsOf } from "../src/agent/outbox"
import { escapeXml } from "@yuki/agent/text"
import { allowedReaction, MAX_REACTIONS_BYTES, reactionLines } from "../src/room/reactions"

describe("allowedReaction", () => {
  test("an emoji on the list comes back in its stored form", () => {
    expect(allowedReaction("👍")).toBe("👍")
    expect(allowedReaction("❤")).toBe("❤️")
    expect(allowedReaction("👍🏽")).toBe("👍")
  })

  test("anything else is dropped", () => {
    expect(allowedReaction("🦄")).toBeNull()
    expect(allowedReaction("ok")).toBeNull()
    expect(allowedReaction("")).toBeNull()
  })
})

describe("partsOf", () => {
  test("a reply of only a tag is a reaction and no block", () => {
    expect(partsOf("[react:👍]")).toEqual({ blocks: [], reactions: [{ emoji: "👍" }] })
  })

  test("a tag with an id beside a short bubble", () => {
    expect(partsOf("[react:🔥:01ABC]\n\nnice")).toEqual({ blocks: ["nice"], reactions: [{ emoji: "🔥", messageId: "01ABC" }] })
  })
})

describe("reactionLines", () => {
  test("nothing to say is no brief text", () => {
    expect(reactionLines([])).toBeNull()
  })

  test("the newest reactions fit the block's bytes, and the rest are counted", () => {
    // Forty reactions, each a 33-character actor and a 60-character quote of ampersands, five bytes each once escaped.
    const notes = Array.from({ length: 40 }, () => ({ by: `@${"a".repeat(32)}`, emoji: "❤️‍🔥", text: "&".repeat(60) }))
    const lines = reactionLines(notes)!.split("\n")
    const kept = lines.slice(2)
    expect(lines[1]).toMatch(/^- and \d+ more$/)
    expect(kept.length).toBeLessThanOrEqual(10)
    expect(Number(lines[1]!.match(/\d+/)![0]) + kept.length).toBe(40)
    expect(new TextEncoder().encode(escapeXml(lines.join("\n"))).length).toBeLessThanOrEqual(MAX_REACTIONS_BYTES + 128)
  })

  test("one line per reaction, long text cut", () => {
    const long = "x".repeat(80)
    expect(reactionLines([{ by: "the human", emoji: "❤️", text: "hi" }, { by: "@ada", emoji: "👍", text: long }])).toBe(
      `reactions since your last turn:\n- the human reacted ❤️ to your "hi"\n- @ada reacted 👍 to your "${"x".repeat(59)}…"`,
    )
  })
})
