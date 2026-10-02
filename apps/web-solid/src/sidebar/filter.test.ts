import { describe, expect, test } from "bun:test"
import type { RosterBot } from "../lib/types"
import { filterRows } from "./filter"

const row = (id: string, name: string, preview: string, unread = 0): RosterBot => ({
  id, name, preview, updatedAt: 0, presence: "idle", unread, pinned: false,
})
const rows = [row("1", "Trip plan", "flights booked", 2), row("2", "Taxes", "send the w2"), row("3", "Recipes", "TRIP to the market")]

describe("filterRows", () => {
  const cases: [string, { query: string; unreadOnly: boolean }, string[]][] = [
    ["empty query keeps every row", { query: "", unreadOnly: false }, ["1", "2", "3"]],
    ["matches the title", { query: "taxes", unreadOnly: false }, ["2"]],
    ["matches the preview, any case", { query: "trip", unreadOnly: false }, ["1", "3"]],
    ["trims the query", { query: "  w2 ", unreadOnly: false }, ["2"]],
    ["unread only", { query: "", unreadOnly: true }, ["1"]],
    ["query and unread together", { query: "trip", unreadOnly: true }, ["1"]],
    ["no match", { query: "zzz", unreadOnly: false }, []],
  ]
  for (const [name, filter, ids] of cases) {
    test(name, () => expect(filterRows(rows, filter).map((r) => r.id)).toEqual(ids))
  }
  test("a chat marked unread by hand counts", () => {
    expect(filterRows(rows, { query: "", unreadOnly: true }, (r) => r.id === "2").map((r) => r.id)).toEqual(["2"])
  })
})
