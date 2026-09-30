import { describe, expect, test } from "bun:test"
import { useApp } from "./store"

/**
 * The one invariant this model exists for: a message carries a chip PER EMOJI,
 * and each chip is toggled on its own. The behaviour it replaced kept a single
 * slot, so reacting with a second emoji silently threw the first away — which is
 * exactly what happens when two people react to the same message with different
 * emoji, the case this model was written for.
 *
 * `a-19` ships as the two-chip fixture: the viewer on ❤️, someone else on ✅.
 */
const TWO_CHIP = "a-19"

const chips = (id: string) =>
  (useApp.messageById(id)?.reactions ?? []).map((r) => `${r.emoji}:${r.count}:${r.viewerReacted}`)

describe("toggleReaction", () => {
  test("removing the viewer's chip leaves every other chip alone", () => {
    expect(chips(TWO_CHIP)).toEqual(["❤️:1:true", "✅:2:false"])

    useApp.toggleReaction(TWO_CHIP, "❤️")

    // The viewer's ❤️ is gone; ✅ keeps its count and its unpressed state.
    expect(chips(TWO_CHIP)).toEqual(["✅:2:false"])
  })

  test("adding an emoji appends rather than replacing", () => {
    useApp.toggleReaction(TWO_CHIP, "❤️")
    expect(chips(TWO_CHIP)).toEqual(["✅:2:false", "❤️:1:true"])

    // The regression this guards: a second emoji used to overwrite the first.
    useApp.toggleReaction(TWO_CHIP, "🎉")
    expect(chips(TWO_CHIP)).toEqual(["✅:2:false", "❤️:1:true", "🎉:1:true"])
  })

  test("joining someone else's chip counts without disturbing the viewer's own", () => {
    useApp.toggleReaction(TWO_CHIP, "✅")

    // Joining presses the viewer on and raises the count, and ❤️ is untouched.
    expect(chips(TWO_CHIP)).toEqual(["✅:3:true", "❤️:1:true", "🎉:1:true"])
  })

  test("leaving a shared chip decrements without deleting it", () => {
    useApp.toggleReaction(TWO_CHIP, "✅")

    // Back to two other people on ✅, the viewer no longer among them, and the
    // chip still stands because the count never reached zero.
    expect(chips(TWO_CHIP)).toEqual(["✅:2:false", "❤️:1:true", "🎉:1:true"])
  })
})
