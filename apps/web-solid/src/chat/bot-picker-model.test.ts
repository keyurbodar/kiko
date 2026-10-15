import { describe, expect, test } from "bun:test"
import { groupMembers, groupTitle, kikoLocked, togglePick } from "./bot-picker-model"

describe("the bot picker's selection", () => {
  test.each<[string, string[], string[]]>([
    ["one agent is no group", ["ada"], ["ada"]],
    ["kiko and one agent are a group of two", ["yuki", "ada"], ["yuki", "ada"]],
    ["two agents bring kiko in, first", ["ada", "bob"], ["yuki", "ada", "bob"]],
    ["kiko is not added twice", ["ada", "yuki", "bob"], ["yuki", "ada", "bob"]],
    ["a repeat counts once", ["ada", "ada"], ["ada"]],
  ])("%s", (_, picked, expected) => {
    expect(groupMembers(picked)).toEqual(expected)
  })

  test("kiko is locked on from two other agents, and stays picked", () => {
    expect(kikoLocked(["ada"])).toBe(false)
    expect(kikoLocked(["ada", "bob"])).toBe(true)
    expect(togglePick(["ada", "bob"], "yuki")).toEqual(["ada", "bob"])
    expect(groupMembers(togglePick(["ada", "bob"], "yuki"))).toEqual(["yuki", "ada", "bob"])
  })

  test("a pick toggles, and kiko can be picked and dropped while it is not locked", () => {
    expect(togglePick([], "ada")).toEqual(["ada"])
    expect(togglePick(["ada"], "ada")).toEqual([])
    expect(togglePick(["ada"], "yuki")).toEqual(["ada", "yuki"])
    expect(togglePick(["yuki", "ada"], "yuki")).toEqual(["ada"])
  })

  test("a group's title is its members' names", () => {
    expect(groupTitle(["Kiko", "Ada", "Bob"])).toBe("Kiko, Ada, Bob")
  })
})
