import { describe, expect, test } from "bun:test"
import {
  DEFAULT_RECENTS,
  gridMove,
  newestSupported,
  pushRecent,
  searchEmoji,
  shortcodeQuery,
  withDefaults,
  type EmojiEntry,
} from "./emoji-data"

const entry = (emoji: string, shortcodes: string[], annotation: string, tags: string[], order: number, version = 1): EmojiEntry => ({
  emoji,
  shortcodes,
  annotation,
  tags,
  group: 0,
  order,
  version,
})

const DATA: EmojiEntry[] = [
  entry("😂", ["joy", "lol"], "face with tears of joy", ["laugh", "tear"], 1),
  entry("🔥", ["fire"], "fire", ["flame", "lit"], 2),
  entry("😍", ["heart_eyes"], "smiling face with heart-eyes", ["love"], 3),
  entry("🔒", ["lock", "locked"], "locked", ["closed"], 4),
  entry("🎈", ["balloon"], "balloon", ["celebration"], 5),
  entry("❤️", ["heart", "red_heart"], "red heart", ["love"], 6),
  entry("🥰", ["smiling_face_with_hearts"], "smiling face with hearts", ["adore", "love"], 7),
]

const glyphs = (query: string) => searchEmoji(DATA, query).map((match) => match.entry.emoji)

describe("searchEmoji", () => {
  test("shortcode prefix matches come before substring matches, then name and tag matches", () => {
    // "lo": lol and lock/locked start with it; balloon holds it; love is only a tag.
    expect(glyphs("lo")).toEqual(["😂", "🔒", "🎈", "😍", "❤️", "🥰"])
  })

  test("an exact shortcode comes before the longer ones it starts", () => {
    expect(glyphs("heart")).toEqual(["❤️", "😍", "🥰"])
    expect(searchEmoji(DATA, "heart")[0]).toMatchObject({ shortcode: "heart", at: 0 })
  })

  test("each match names the shortcode that matched and where", () => {
    const [joy, lock, balloon, eyes] = searchEmoji(DATA, "lo")
    expect(joy).toMatchObject({ shortcode: "lol", at: 0 })
    expect(lock).toMatchObject({ shortcode: "lock", at: 0 })
    expect(balloon).toMatchObject({ shortcode: "balloon", at: 3 })
    expect(eyes).toMatchObject({ shortcode: "heart_eyes", at: -1 })
  })

  test("spaces in the query match underscores and the name", () => {
    expect(glyphs("red heart")).toEqual(["❤️"])
    expect(glyphs("heart eyes")).toEqual(["😍"])
  })

  test("an empty query matches nothing and the limit caps the list", () => {
    expect(glyphs("  ")).toEqual([])
    expect(searchEmoji(DATA, "o", 2)).toHaveLength(2)
  })
})

describe("shortcodeQuery", () => {
  test("a colon and two characters at the start or after a space open the list", () => {
    expect(shortcodeQuery(":lo", 3)).toEqual({ start: 0, query: "lo" })
    expect(shortcodeQuery("so funny :Joy", 13)).toEqual({ start: 9, query: "joy" })
    expect(shortcodeQuery("a\n:+1", 5)).toEqual({ start: 2, query: "+1" })
  })

  test("it reads only the text before the caret", () => {
    expect(shortcodeQuery(":fire later", 5)).toEqual({ start: 0, query: "fire" })
    expect(shortcodeQuery(":fire later", 11)).toBeUndefined()
  })

  test("one character, a colon inside a word, a time or a finished shortcode do not", () => {
    expect(shortcodeQuery(":l", 2)).toBeUndefined()
    expect(shortcodeQuery("at 10:30", 8)).toBeUndefined()
    expect(shortcodeQuery("see http://lo", 13)).toBeUndefined()
    expect(shortcodeQuery(":fire: ", 7)).toBeUndefined()
    expect(shortcodeQuery(":fire:", 6)).toBeUndefined()
  })
})

describe("recents", () => {
  test("a pick moves to the front once and the list is capped", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"])
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"])
  })

  test("defaults fill out the stored list without repeating it", () => {
    expect(withDefaults([])).toEqual([...DEFAULT_RECENTS])
    const filled = withDefaults(["🔥", "🎈"])
    expect(filled.slice(0, 3)).toEqual(["🔥", "🎈", "🙂"])
    expect(filled.filter((emoji) => emoji === "🔥")).toHaveLength(1)
  })
})

describe("newestSupported", () => {
  test("it returns the newest version whose probe draws", () => {
    const data = [entry("a", [], "", [], 1, 1), entry("b", [], "", [], 2, 15.1), entry("c", [], "", [], 3, 16)]
    expect(newestSupported(data, (emoji) => emoji !== "c")).toBe(15.1)
    expect(newestSupported(data, () => true)).toBe(16)
  })
})

describe("gridMove", () => {
  // Two sections: 10 cells (rows of 8 and 2), then 5 cells.
  const sizes = [10, 5]
  const move = (section: number, index: number, key: string) => gridMove(sizes, { section, index }, key, 8)

  test("left and right walk across sections", () => {
    expect(move(0, 9, "ArrowRight")).toEqual({ section: 1, index: 0 })
    expect(move(1, 0, "ArrowLeft")).toEqual({ section: 0, index: 9 })
    expect(move(1, 4, "ArrowRight")).toEqual({ section: 1, index: 4 })
  })

  test("down keeps the column, onto a short row or into the next section", () => {
    expect(move(0, 1, "ArrowDown")).toEqual({ section: 0, index: 9 })
    expect(move(0, 6, "ArrowDown")).toEqual({ section: 0, index: 9 })
    expect(move(0, 9, "ArrowDown")).toEqual({ section: 1, index: 1 })
    expect(move(1, 3, "ArrowDown")).toEqual({ section: 1, index: 3 })
  })

  test("up keeps the column into the previous section's last row", () => {
    expect(move(1, 1, "ArrowUp")).toEqual({ section: 0, index: 9 })
    expect(move(1, 0, "ArrowUp")).toEqual({ section: 0, index: 8 })
    expect(move(0, 9, "ArrowUp")).toEqual({ section: 0, index: 1 })
  })

  test("empty sections are skipped", () => {
    expect(gridMove([3, 0, 2], { section: 0, index: 2 }, "ArrowRight", 8)).toEqual({ section: 2, index: 0 })
    expect(gridMove([3, 0, 2], { section: 2, index: 0 }, "ArrowUp", 8)).toEqual({ section: 0, index: 0 })
  })
})
