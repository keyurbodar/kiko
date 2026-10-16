import { describe, expect, test } from "bun:test"
import type { RecipeApp, RecipeCard, RecipeInstall, RoomId } from "@kiko/protocol"
import { triggerLabel } from "../chat/info/routines-model"
import { byChatOrder, filterRecipes, installStatus, installedSlugs, nextLabel, nextRunLabel, recipeForRoutine, recipeTags, tagLabel } from "./model"

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
    const install = (slug: string): RecipeInstall => ({ installId: slug, slug, roomId: "r" as RoomId, agent: "kiko", at: 1, routines: [] })
    expect([...installedSlugs([install("day-trip")], { roomId: "r", agent: "kiko" })]).toEqual(["day-trip"])
    expect(installedSlugs([], { roomId: "r", agent: "kiko" }).has("day-trip")).toBe(false)
    expect(installedSlugs([install("day-trip")], { roomId: "r", agent: "ada" }).has("day-trip")).toBe(false)
    expect(installedSlugs([install("day-trip")], { roomId: "other-chat", agent: "kiko" }).has("day-trip")).toBe(false)
  })
})

describe("the sheet and the routine icon", () => {
  test("a routine matches its recipe by the lowercased title", () => {
    expect(recipeForRoutine(cards, "morning briefing")?.slug).toBe("morning-briefing")
    expect(recipeForRoutine(cards, "Morning briefing")).toBeUndefined()
    expect(recipeForRoutine(cards, "water the plants")).toBeUndefined()
  })
})

const routine = (id: string, status: "active" | "paused", dueUtc: number) => ({
  id,
  name: "morning briefing",
  trigger: { on: "time" as const, at: "07:55" },
  tz: "UTC",
  status,
  dueUtc,
})

const install = (routines: RecipeInstall["routines"], roomId = "chat-a"): RecipeInstall => ({
  installId: `i-${roomId}`,
  slug: "morning-briefing",
  roomId: roomId as RoomId,
  agent: "ada",
  at: 1,
  routines,
})

describe("an install's status", () => {
  const briefing = card("morning-briefing", { when: "Daily at 7:55" })

  test("the soonest active routine's due time wins over paused ones", () => {
    const status = installStatus(install([routine("a", "active", 500), routine("b", "active", 300), routine("c", "paused", 100)]), briefing)
    expect(status).toEqual({ kind: "next", at: 300 })
  })

  test("all routines paused shows the first routine's schedule", () => {
    const paused = routine("a", "paused", 500)
    expect(installStatus(install([paused]), briefing)).toEqual({ kind: "paused", schedule: triggerLabel(paused.trigger, "UTC") })
  })

  test("no routines asks, with the recipe's when", () => {
    expect(installStatus(install([]), briefing)).toEqual({ kind: "ask", label: "Daily at 7:55" })
  })
})

describe("the next run's label", () => {
  // 2026-10-15 is a Thursday. 07:55 UTC on each day below.
  const now = Date.UTC(2026, 9, 15, 6, 0)
  const at = (day: number) => Date.UTC(2026, 9, day, 7, 55)

  test("today, tomorrow, a weekday within six days, then a date", () => {
    expect(nextLabel(at(15), now, "UTC")).toBe("Today at 7:55 AM")
    expect(nextLabel(at(16), now, "UTC")).toBe("Tomorrow at 7:55 AM")
    expect(nextLabel(at(17), now, "UTC")).toBe("Sat at 7:55 AM")
    expect(nextLabel(at(21), now, "UTC")).toBe("Wed at 7:55 AM")
    expect(nextLabel(at(22), now, "UTC")).toBe("Oct 22 at 7:55 AM")
  })

  test("as a sentence, today and tomorrow are lowercased and a weekday or date keeps its capital", () => {
    expect(nextRunLabel(at(16), now, "UTC")).toBe("Next run tomorrow at 7:55 AM")
    expect(nextRunLabel(at(15), now, "UTC")).toBe("Next run today at 7:55 AM")
    expect(nextRunLabel(at(17), now, "UTC")).toBe("Next run Sat at 7:55 AM")
    expect(nextRunLabel(at(22), now, "UTC")).toBe("Next run Oct 22 at 7:55 AM")
  })

  test("days are counted in the zone, not in UTC", () => {
    // 23:30 UTC on the 15th is already the 16th in Tokyo.
    const lateUtc = Date.UTC(2026, 9, 15, 23, 30)
    expect(nextLabel(lateUtc, Date.UTC(2026, 9, 15, 12, 0), "Asia/Tokyo")).toBe("Tomorrow at 8:30 AM")
  })
})

describe("ordering installs by chat", () => {
  test("installs follow the chat list's order, keep their order within a chat, and a chat the list lacks goes last", () => {
    const a1 = install([], "chat-a")
    const b1 = install([], "chat-b")
    const gone = install([], "chat-gone")
    const ordered = byChatOrder([gone, b1, a1, { ...a1, installId: "second" }], ["chat-a", "chat-b"])
    expect(ordered.map((i) => i.installId)).toEqual(["i-chat-a", "second", "i-chat-b", "i-chat-gone"])
  })
})
