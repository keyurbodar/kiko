import { describe, expect, test } from "bun:test"
import { groupTitle, roomFor, togglePick } from "./bot-picker-model"

describe("the room a pick opens", () => {
  test.each<[string, string[], string[]]>([
    ["nothing picked opens nothing", [], []],
    ["one agent is that agent's own chat", ["ada"], ["ada"]],
    ["kiko alone is its own chat", ["kiko"], ["kiko"]],
    ["two agents make a group kiko leads", ["ada", "bob"], ["kiko", "ada", "bob"]],
    ["kiko in the pick is not added twice", ["ada", "kiko"], ["kiko", "ada"]],
    ["a repeat counts once", ["ada", "ada"], ["ada"]],
  ])("%s", (_, picked, expected) => {
    expect(roomFor(picked)).toEqual(expected)
  })

  test("a pick toggles either way, kiko included", () => {
    expect(togglePick([], "ada")).toEqual(["ada"])
    expect(togglePick(["ada"], "ada")).toEqual([])
    expect(togglePick(["ada"], "kiko")).toEqual(["ada", "kiko"])
    expect(togglePick(["kiko"], "kiko")).toEqual([])
  })

  test("a group's title is its members' names", () => {
    expect(groupTitle(["Kiko", "Ada", "Bob"])).toBe("Kiko, Ada, Bob")
  })
})
