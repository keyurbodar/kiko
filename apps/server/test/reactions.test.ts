import { describe, expect, test } from "bun:test"
import { partsOf } from "../src/agent/outbox"
import { allowedReaction, reactionLines } from "../src/room/reactions"

// P6-07, architecture section 6.5. The room-level behavior runs in `bun yuki verify reactions`.

describe("allowedReaction", () => {
  test("an emoji on the list comes back in its stored form", () => {
    expect(allowedReaction("👍")).toBe("👍")
    // A heart without its variation selector, and a skin tone, map to the listed form.
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

  test("one line per reaction, long text cut", () => {
    const long = "x".repeat(80)
    expect(reactionLines([{ by: "the human", emoji: "❤️", text: "hi" }, { by: "@ada", emoji: "👍", text: long }])).toBe(
      `reactions since your last turn:\n- the human reacted ❤️ to your "hi"\n- @ada reacted 👍 to your "${"x".repeat(59)}…"`,
    )
  })
})
