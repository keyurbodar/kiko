import { describe, expect, test } from "bun:test"
import { twemojiCandidates } from "./emoji"

/**
 * Twemoji's naming rule, which is not obvious, which a plausible simplification
 * breaks, and which the asset set then contradicts in a few places. Verified
 * against the shipped files in `public/emoji/`: `2764-fe0f-200d-1f525.svg`
 * exists while `2764-200d-1f525.svg` does not, a lone `❤️` is `2764.svg` with no
 * selector, and `👁️‍🗨️` is the odd one at `1f441-200d-1f5e8.svg`.
 */
describe("twemoji filenames", () => {
  test("a lone emoji drops the variation selector", () => {
    // The dropped spelling is first because it is the one Twemoji actually
    // ships; the kept one is only ever requested if the first one misses.
    expect(twemojiCandidates("\u2764\ufe0f")).toEqual(["2764", "2764-fe0f"])
    expect(twemojiCandidates("\u{1f600}")).toEqual(["1f600"])
  })

  test("a ZWJ sequence keeps it, and can fall back to dropping it", () => {
    expect(twemojiCandidates("\u2764\ufe0f\u200d\u{1f525}")).toEqual([
      "2764-fe0f-200d-1f525",
      "2764-200d-1f525",
    ])
    expect(twemojiCandidates("\u{1f642}\u200d\u2195\ufe0f")).toEqual([
      "1f642-200d-2195-fe0f",
      "1f642-200d-2195",
    ])
  })

  test("a flag reaches for one file, not two letters", () => {
    expect(twemojiCandidates("\u{1f1ef}\u{1f1f5}")).toEqual(["1f1ef-1f1f5"])
  })

  test("nothing picture-shaped resolves to nothing", () => {
    expect(twemojiCandidates("")).toEqual([])
    expect(twemojiCandidates("\ufe0f")).toEqual([])
  })
})
