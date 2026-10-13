import { describe, expect, test } from "bun:test"
import type { Chat, RoomId } from "@kiko/protocol"
import { agentList, BUILTIN_AGENT, chatAfter, resumeChat, rosterChats } from "./chats"

const chat = (roomId: string, over: Partial<Chat> = {}): Chat => ({
  roomId: roomId as RoomId,
  title: roomId,
  pinned: false,
  muted: false,
  lastSeq: 0,
  lastPreview: "",
  unread: 0,
  updatedAt: 0,
  ...over,
})

describe("the sidebar's chats", () => {
  const kiko = chat("yuki", { agents: ["yuki"], kiko: true, pinned: true })
  test.each<[string, Chat[], string[]]>([
    ["the kiko chat is listed", [kiko], ["yuki"]],
    ["a temporary chat is not", [kiko, chat("t", { agents: ["yuki"], temp: true })], ["yuki"]],
    ["a kept group from a temporary chat is", [kiko, chat("g", { agents: ["yuki", "ada"] })], ["yuki", "g"]],
    ["an old kiko room that is not the kiko chat is not", [kiko, chat("old", { agents: ["yuki"], updatedAt: 9 })], ["yuki"]],
    ["a room made with no agents has kiko alone and is not", [kiko, chat("bare")], ["yuki"]],
    ["one row per agent: the most recently active direct chat", [kiko, chat("a1", { agents: ["ada"], updatedAt: 1 }), chat("a2", { agents: ["ada"], updatedAt: 2 }), chat("b", { agents: ["bob"] })], ["yuki", "a2", "b"]],
    ["the kiko chat comes first even when another pinned chat is newer", [chat("p", { agents: ["ada"], pinned: true, updatedAt: 9 }), kiko], ["yuki", "p"]],
  ])("%s", (_, chats, expected) => {
    expect(rosterChats(chats).map((c) => c.roomId as string)).toEqual(expected)
  })
})

describe("the chat to resume", () => {
  const chats = [chat("yuki", { kiko: true }), chat("a", { agents: ["ada"] }), chat("t", { temp: true })]
  test.each<[string, Chat[], boolean, (string | null)[], string | null]>([
    ["this device's last chat", chats, true, ["a", null], "a"],
    ["the server's when this device has none", chats, true, [null, "a"], "a"],
    ["this device's wins over the server's", chats, true, ["yuki", "a"], "yuki"],
    ["a deleted chat falls through to the kiko chat", chats, true, ["gone", "gone"], "yuki"],
    ["a temporary chat is never resumed", chats, true, ["t", null], "yuki"],
    ["before the list loads, this device's last chat is trusted", [], false, ["a", null], "a"],
    ["before the list loads with nothing remembered, wait", [], false, [null, null], null],
    ["a loaded list without a kiko chat yet: wait", [], true, [null, null], null],
  ])("%s", (_, list, loaded, wanted, expected) => {
    expect(resumeChat(list, loaded, wanted)).toBe(expected as RoomId | null)
  })
})

test("kiko is always among the agents, first", () => {
  expect(agentList([{ ...BUILTIN_AGENT }, { id: "a", name: "ada", slug: "ada" as never, prompt: "", model: "" }]).map((a) => a.id)).toEqual(["yuki", "a"])
})


describe("chatAfter", () => {
  const list = ["a", "b", "c"]
  test("the chat below takes the place, else the one above", () => {
    expect(chatAfter(list, "a")).toBe("b")
    expect(chatAfter(list, "b")).toBe("c")
    expect(chatAfter(list, "c")).toBe("b")
  })
  test("the only chat leaves nothing, and a chat not in the list leaves nothing", () => {
    expect(chatAfter(["a"], "a")).toBeNull()
    expect(chatAfter(list, "z")).toBeNull()
  })
})
