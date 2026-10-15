import { describe, expect, test } from "bun:test"
import { groupMembers, groupTitle, togglePick } from "./bot-picker-model"

describe("the bot picker's group", () => {
  test.each<[string, string[], string[]]>([
    ["nothing picked is no group", [], []],
    ["one agent makes a group with kiko", ["ada"], ["yuki", "ada"]],
    ["kiko leads, first", ["ada", "bob"], ["yuki", "ada", "bob"]],
    ["kiko in the pick is not added twice", ["ada", "yuki"], ["yuki", "ada"]],
    ["a repeat counts once", ["ada", "ada"], ["yuki", "ada"]],
  ])("%s", (_, picked, expected) => {
    expect(groupMembers(picked)).toEqual(expected)
  })

  test("a pick toggles, and kiko cannot be picked or dropped", () => {
    expect(togglePick([], "ada")).toEqual(["ada"])
    expect(togglePick(["ada"], "ada")).toEqual([])
    expect(togglePick(["ada"], "yuki")).toEqual(["ada"])
  })

  test("a group's title is its members' names", () => {
    expect(groupTitle(["Kiko", "Ada", "Bob"])).toBe("Kiko, Ada, Bob")
  })
})
