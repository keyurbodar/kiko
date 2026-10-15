import { describe, expect, test } from "bun:test"
import type { RecipeApp, RecipeCard, RecipeInstall, RoomId } from "@kiko/protocol"
import { filterRecipes, installedSlugs, recipeForRoutine, recipeTags, starterTiles, tagLabel } from "./model"

const card = (slug: string, over: Partial<RecipeCard> = {}): RecipeCard => ({
  slug,
  title: slug.replace(/-/g, " "),
  description: `${slug} does a thing`,
  when: "When you ask",
  apps: [],
  setup: [],
  agent: { name: "Ada", handle: "ada" },
  custom: false,
  tags: [],
  icon: "sun",
  glyph: "",
  tone: "amber",
  ...over,
})

const app = (name: string): RecipeApp => ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]/g, ""), connected: false })

const cards = [
  card("morning-briefing", { title: "Morning briefing", when: "Daily at 7:55", apps: [app("Gmail"), app("Google Calendar")], tags: ["mornings", "inbox"] }),
  card("daily-weather", { title: "Daily weather", tags: ["mornings"] }),
  card("expense-log", { title: "Expense log", apps: [app("Google Sheets")], tags: ["money"] }),
  card("day-trip", { title: "Day trip", tags: ["travel", "fun"] }),
]

describe("recipe tags", () => {
  test("chips follow the gallery's order, unknown tags come last, and only present tags are listed", () => {
    expect(recipeTags(cards)).toEqual(["mornings", "inbox", "money", "fun", "travel"])
    expect(recipeTags([card("x", { tags: ["zeta", "mornings", "alpha"] })])).toEqual(["mornings", "zeta", "alpha"])
  })

  test("a chip label capitalizes the first letter only", () => {
    expect(tagLabel("mornings")).toBe("Mornings")
    expect(tagLabel("inbox")).toBe("Inbox")
  })
})

describe("filtering the gallery", () => {
  test("the all filter keeps every recipe, a tag keeps the ones that carry it", () => {
    expect(filterRecipes(cards, "", "all").map((c) => c.slug)).toEqual(cards.map((c) => c.slug))
    expect(filterRecipes(cards, "", "mornings").map((c) => c.slug)).toEqual(["morning-briefing", "daily-weather"])
    expect(filterRecipes(cards, "", "money").map((c) => c.slug)).toEqual(["expense-log"])
  })

  test("a query keeps a recipe only when every word is in its title, description, apps, or tags", () => {
    expect(filterRecipes(cards, "calendar", "all").map((c) => c.slug)).toEqual(["morning-briefing"])
    expect(filterRecipes(cards, "BRIEFING weather", "all")).toEqual([])
    expect(filterRecipes(cards, "daily weather", "all").map((c) => c.slug)).toEqual(["daily-weather"])
    expect(filterRecipes(cards, "sheets money", "money").map((c) => c.slug)).toEqual(["expense-log"])
    expect(filterRecipes(cards, "sheets", "mornings")).toEqual([])
  })
})

describe("installed recipes", () => {
  test("the marks come from the slugs of the installs", () => {
    const install = (slug: string): RecipeInstall => ({ installId: slug, slug, roomId: "r" as RoomId, agent: "yuki", at: 1, routines: [] })
    expect([...installedSlugs([install("day-trip")], { roomId: "r", agent: "yuki" })]).toEqual(["day-trip"])
    expect(installedSlugs([], { roomId: "r", agent: "yuki" }).has("day-trip")).toBe(false)
    expect(installedSlugs([install("day-trip")], { roomId: "r", agent: "ada" }).has("day-trip")).toBe(false)
    expect(installedSlugs([install("day-trip")], { roomId: "other-chat", agent: "yuki" }).has("day-trip")).toBe(false)
  })
})

describe("the empty chat's tiles", () => {
  test("the preferred five come first, in order, and the catalog's first recipes fill any gap", () => {
    const many = ["meme-machine", "daily-weather", "x1", "morning-briefing", "follow-up-nudges", "x2", "decision-council"].map((s) => card(s))
    expect(starterTiles(many).map((c) => c.slug)).toEqual(["morning-briefing", "decision-council", "follow-up-nudges", "daily-weather", "meme-machine"])
    expect(starterTiles(cards).map((c) => c.slug)).toEqual(["morning-briefing", "daily-weather", "expense-log", "day-trip"])
    expect(starterTiles(many.slice(0, 2)).map((c) => c.slug)).toEqual(["daily-weather", "meme-machine"])
  })
})

describe("the sheet and the routine icon", () => {
  test("a routine matches its recipe by the lowercased title", () => {
    expect(recipeForRoutine(cards, "morning briefing")?.slug).toBe("morning-briefing")
    expect(recipeForRoutine(cards, "Morning briefing")).toBeUndefined()
    expect(recipeForRoutine(cards, "water the plants")).toBeUndefined()
  })
})
