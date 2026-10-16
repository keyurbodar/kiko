import { describe, expect, test } from "bun:test"
import { type Chat, KIKO_HOME_ROOM, type RoomId } from "@kiko/protocol"
import { agentList, BUILTIN_AGENT, chatAfter, distinctTitles, resumeChat, rosterChats } from "./chats"

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
    ["a group is listed", [kiko, chat("g", { agents: ["kiko", "ada"] })], ["kiko", "g"]],
    ["no chat is hidden by the agents it holds", [kiko, chat("old", { agents: ["kiko"] }), chat("bare"), chat("a1", { agents: ["ada"] }), chat("a2", { agents: ["ada"] })], ["kiko", "old", "bare", "a1", "a2"]],
    ["an unflagged Kiko-only chat is still listed", [chat("only", { agents: ["kiko"] })], ["only"]],
    ["the kiko chat comes first even when another pinned chat is newer", [chat("p", { agents: ["ada"], pinned: true, updatedAt: 9 }), kiko], ["kiko", "p"]],
  ])("%s", (_, chats, expected) => {
    expect(rosterChats(chats).map((c) => c.roomId as string)).toEqual(expected)
  })
})

describe("the chat to resume", () => {
  const chats = [chat("kiko", { kiko: true }), chat("a", { agents: ["ada"] })]
  test.each<[string, Chat[], boolean, (string | null)[], string | null]>([
    ["this device's last chat", chats, true, ["a", null], "a"],
    ["the server's when this device has none", chats, true, [null, "a"], "a"],
    ["this device's wins over the server's", chats, true, ["kiko", "a"], "kiko"],
    ["a deleted chat falls through to the kiko chat", chats, true, ["gone", "gone"], "kiko"],
    ["before the list loads, this device's last chat is trusted", [], false, ["a", null], "a"],
    ["before the list loads with nothing remembered, wait", [], false, [null, null], null],
    ["a synced list with no chats opens the Kiko home chat, never a blank screen", [], true, [null, null], KIKO_HOME_ROOM],
  ])("%s", (_, list, loaded, wanted, expected) => {
    expect(resumeChat(list, loaded, wanted)).toBe(expected as RoomId | null)
  })
})

test("kiko is always among the agents, first", () => {
  expect(agentList([{ ...BUILTIN_AGENT }, { id: "a", name: "ada", slug: "ada" as never, prompt: "", model: "" }]).map((a) => a.id)).toEqual(["kiko", "a"])
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

describe("chats that share a title", () => {
  test("the lowest room id keeps the title and the others are numbered, whatever the case", () => {
    const out = distinctTitles([chat("c", { title: "pollen" }), chat("a", { title: "Pollen" }), chat("b", { title: " Pollen " }), chat("d", { title: "Ada" })])
    expect(out.map((c) => c.title)).toEqual(["pollen 3", "Pollen", "Pollen 2", "Ada"])
  })
})
