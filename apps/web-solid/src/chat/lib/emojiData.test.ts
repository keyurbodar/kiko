import { describe, expect, test } from "bun:test"
import { groupedEmojis, resolveShortcode, searchEmojis } from "./emojiData"

describe("emoji data", () => {
  test("groups are the menu's nine, in order, and none is a component", () => {
    const groups = groupedEmojis()
    expect(groups.map((group) => group.key)).toEqual([
      "smileys-emotion",
      "people-body",
      "animals-nature",
      "food-drink",
      "travel-places",
      "activities",
      "objects",
      "symbols",
      "flags",
    ])
    for (const group of groups) {
      expect(group.label).toBe(group.label.toLowerCase())
      expect(group.emojis.length).toBeGreaterThan(0)
    }
  })

  test("every entry carries the fields the picker reads", () => {
    for (const group of groupedEmojis()) {
      for (const entry of group.emojis) {
        expect(entry.emoji.length).toBeGreaterThan(0)
        expect(entry.label.length).toBeGreaterThan(0)
        expect(entry.shortcodes.length).toBeGreaterThan(0)
      }
    }
  })

  test("an empty query returns nothing, so the caller keeps the grouped menu", () => {
    expect(searchEmojis("")).toEqual([])
    expect(searchEmojis("   ")).toEqual([])
  })

  test("search matches the label", () => {
    const hits = searchEmojis("thumbs up")
    expect(hits[0]?.label).toBe("thumbs up")
  })

  test("search matches a tag the label does not contain", () => {
    // "waving hand" has no "greetings" in its label, but tags carry it.
    const hits = searchEmojis("greetings")
    expect(hits.map((entry) => entry.label)).toContain("waving hand")
  })

  test("search matches a shortcode", () => {
    const hits = searchEmojis("tears_of_joy")
    expect(hits.map((entry) => entry.label)).toContain("face with tears of joy")
  })

  test("search is case- and whitespace-insensitive", () => {
    const shouty = searchEmojis("  THUMBS  ")
    expect(shouty[0]?.label).toBe("thumbs up")
  })

  test("a query nobody matches comes back empty rather than everything", () => {
    expect(searchEmojis("qqzzxx-not-an-emoji")).toEqual([])
  })

  test("a one-letter query is capped so the grid stays usable", () => {
    const hits = searchEmojis("a")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.length).toBeLessThanOrEqual(240)
  })

  test("a shortcode resolves bare, coloned, and shouty", () => {
    const fire = resolveShortcode("fire")
    expect(fire?.label).toBe("fire")
    expect(resolveShortcode(":fire:")?.label).toBe("fire")
    expect(resolveShortcode("  FIRE  ")?.label).toBe("fire")
  })

  test("a shortcode nobody owns resolves to nothing", () => {
    expect(resolveShortcode("qqzzxx-not-an-emoji")).toBeUndefined()
  })

  test("every quick-reaction shortcode the menu uses resolves", () => {
    for (const shortcode of ["+1", "heart", "joy", "open_mouth", "folded_hands"]) {
      expect(resolveShortcode(shortcode)).toBeDefined()
    }
  })
})
