import { describe, expect, test } from "bun:test"
import type { Chat, RoomId } from "@kiko/protocol"
import { agentList, BUILTIN_AGENT, chatTitle, resumeChat, rosterChats } from "./chats"

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
  const kiko = chat("kiko", { agents: ["kiko"], kiko: true, pinned: true })
  test.each<[string, Chat[], string[]]>([
    ["the kiko chat is listed", [kiko], ["kiko"]],
    ["a temporary chat is not", [kiko, chat("t", { agents: ["kiko"], temp: true })], ["kiko"]],
    ["a kept group from a temporary chat is", [kiko, chat("g", { agents: ["kiko", "ada"] })], ["kiko", "g"]],
    ["an old kiko room that is not the kiko chat is not", [kiko, chat("old", { agents: ["kiko"], updatedAt: 9 })], ["kiko"]],
    ["a room made with no agents has kiko alone and is not", [kiko, chat("bare")], ["kiko"]],
    ["one row per agent: the most recently active direct chat", [kiko, chat("a1", { agents: ["ada"], updatedAt: 1 }), chat("a2", { agents: ["ada"], updatedAt: 2 }), chat("b", { agents: ["bob"] })], ["kiko", "a2", "b"]],
    ["the kiko chat comes first even when another pinned chat is newer", [chat("p", { agents: ["ada"], pinned: true, updatedAt: 9 }), kiko], ["kiko", "p"]],
  ])("%s", (_, chats, expected) => {
    expect(rosterChats(chats).map((c) => c.roomId as string)).toEqual(expected)
  })
})

describe("the chat to resume", () => {
  const chats = [chat("kiko", { kiko: true }), chat("a", { agents: ["ada"] }), chat("t", { temp: true })]
  test.each<[string, Chat[], boolean, (string | null)[], string | null]>([
    ["this device's last chat", chats, true, ["a", null], "a"],
    ["the server's when this device has none", chats, true, [null, "a"], "a"],
    ["this device's wins over the server's", chats, true, ["kiko", "a"], "kiko"],
    ["a deleted chat falls through to the kiko chat", chats, true, ["gone", "gone"], "kiko"],
    ["a temporary chat is never resumed", chats, true, ["t", null], "kiko"],
    ["before the list loads, this device's last chat is trusted", [], false, ["a", null], "a"],
    ["before the list loads with nothing remembered, wait", [], false, [null, null], null],
    ["a loaded list without a kiko chat yet: wait", [], true, [null, null], null],
  ])("%s", (_, list, loaded, wanted, expected) => {
    expect(resumeChat(list, loaded, wanted)).toBe(expected as RoomId | null)
  })
})

test("kiko is always among the agents, first", () => {
  expect(agentList([{ ...BUILTIN_AGENT }, { id: "a", name: "ada", slug: "ada" as never, prompt: "", model: "" }]).map((a) => a.id)).toEqual(["kiko", "a"])
})

describe("a chat's name", () => {
  test.each([
    ["the kiko chat from before the rename reads as Yuki", { kiko: true, title: "kiko" }, "Yuki"],
    ["a kiko chat the person renamed keeps its name", { kiko: true, title: "Home base" }, "Home base"],
    ["another chat called kiko keeps its name", { title: "kiko" }, "kiko"],
  ] as const)("%s", (_name, over, want) => expect(chatTitle(chat("r1", over))).toBe(want))
})
