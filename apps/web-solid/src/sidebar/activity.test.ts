import { describe, expect, test } from "bun:test"
import type { Chat, ChatLast, MessageId, RoomId } from "@kiko/protocol"
import { chatRow, mentionIds, viewLast } from "../lib/store"
import type { ViewMessage } from "../sync/patches"
import { type ActivityLine, describeLast, typingLine } from "./activity"

const at = 1
const ada = { from: "agent", name: "Ada", at } as const
const you = { from: "human", at } as const

describe("describeLast", () => {
  // [case, last, the DM line, the group line]
  const cases: [string, ChatLast, ActivityLine, ActivityLine][] = [
    ["an agent's text", { ...ada, kind: "text", text: "hi there" }, { text: "hi there" }, { from: "ada", text: "hi there" }],
    ["your text", { ...you, kind: "text", text: "hello" }, { from: "you", text: "hello" }, { from: "you", text: "hello" }],
    ["a photo", { ...ada, kind: "photo" }, { text: "photo" }, { from: "ada", text: "photo" }],
    ["a photo with a caption", { ...you, kind: "photo", text: "look" }, { from: "you", text: "photo, look" }, { from: "you", text: "photo, look" }],
    ["two photos", { ...you, kind: "photo", count: 2 }, { from: "you", text: "2 photos" }, { from: "you", text: "2 photos" }],
    ["a video", { ...ada, kind: "video" }, { text: "video" }, { from: "ada", text: "video" }],
    ["an album", { ...you, kind: "album" }, { from: "you", text: "album" }, { from: "you", text: "album" }],
    ["a file", { ...ada, kind: "file", file: "plan.pdf" }, { text: "plan.pdf" }, { from: "ada", text: "plan.pdf" }],
    ["three files", { ...you, kind: "file", count: 3 }, { from: "you", text: "3 files" }, { from: "you", text: "3 files" }],
    ["a voice message", { ...you, kind: "voice" }, { from: "you", text: "voice message" }, { from: "you", text: "voice message" }],
    ["audio", { ...ada, kind: "audio", file: "song.mp3" }, { text: "song.mp3" }, { from: "ada", text: "song.mp3" }],
    ["a link", { ...you, kind: "link", text: "https://kat.ai" }, { from: "you", text: "https://kat.ai" }, { from: "you", text: "https://kat.ai" }],
    ["a reaction", { ...ada, kind: "react", emoji: "❤️", text: "hello" }, { text: 'reacted ❤️ to "hello"' }, { text: 'ada reacted ❤️ to "hello"' }],
    ["a join", { ...ada, kind: "joined" }, { text: "ada joined" }, { text: "ada joined" }],
    ["a leave", { ...ada, kind: "left" }, { text: "ada left" }, { text: "ada left" }],
    ["a rename", { ...you, kind: "renamed", text: "launch" }, { text: "you renamed the group to launch" }, { text: "you renamed the group to launch" }],
    ["a new group", { ...you, kind: "created" }, { text: "you created the group" }, { text: "you created the group" }],
    ["an approval", { ...ada, kind: "approval" }, { text: "needs your approval" }, { text: "ada needs your approval" }],
    ["a reminder", { from: "system", kind: "notice", text: "reminder: water", at }, { text: "reminder: water" }, { text: "reminder: water" }],
  ]
  for (const [name, last, dm, group] of cases) {
    test(`${name} in a dm`, () => expect(describeLast(last, false)).toEqual(dm))
    test(`${name} in a group`, () => expect(describeLast(last, true)).toEqual(group))
  }
})

describe("typingLine", () => {
  const cases: [readonly string[], boolean, string][] = [
    [["Ada"], false, "typing"],
    [["Ada"], true, "ada is typing"],
    [["Ada", "Bob"], true, "ada and bob are typing"],
    [["Ada", "Bob", "Cy"], true, "ada and 2 others are typing"],
    [[], true, "typing"],
  ]
  for (const [names, group, want] of cases) test(`${names.join(",")} ${group ? "group" : "dm"}`, () => expect(typingLine(names, group)).toBe(want))
})

const chat = (extra: Partial<Chat> = {}): Chat => ({
  roomId: "01J0000000000000000000000A" as RoomId,
  title: "plans",
  pinned: false,
  muted: false,
  lastSeq: 5,
  lastPreview: "raw text",
  unread: 1,
  updatedAt: 10,
  ...extra,
})

describe("chatRow", () => {
  test("a row stored before `last` shows its plain preview", () => {
    expect(chatRow(chat())).toMatchObject({ preview: "raw text", presence: "idle" })
  })

  test("a group row names the sender and carries the mention count", () => {
    const row = chatRow(chat({ group: true, mentions: 2, last: { ...ada, kind: "text", text: "@alice look" } }))
    expect(row).toMatchObject({ previewFrom: "ada", preview: "@alice look", mentions: 2 })
  })

  test("typing names who, in a group", () => {
    const row = chatRow(chat({ group: true }), "idle", { typing: ["Ada", "Bob"] })
    expect(row).toMatchObject({ presence: "typing", typing: "ada and bob are typing" })
  })

  test("the open room's own newest message wins over the server's line", () => {
    const row = chatRow(chat({ last: { ...ada, kind: "text", text: "old" } }), "idle", { last: { ...you, kind: "photo", at: 99 }, group: false })
    expect(row).toMatchObject({ previewFrom: "you", preview: "photo", updatedAt: 99 })
  })
})

const message = (id: string, seq: number, from: ViewMessage["from"], text: string, extra: Partial<ViewMessage> = {}): ViewMessage =>
  ({ id: id as MessageId, seq, at: seq, from, text, ...extra }) as ViewMessage
const agent = { kind: "agent", slug: "ada" } as ViewMessage["from"]

describe("mentionIds", () => {
  const list = [
    message("h1", 1, { kind: "human" }, "hi"),
    message("a1", 2, agent, "hey @alice, a question"),
    message("a2", 3, agent, "done", { replyTo: "h1" as MessageId }),
    message("a3", 4, agent, "nothing for you"),
    message("a4", 5, agent, "@alicebot is someone else"),
  ]
  test("an @handle and a reply to the human are mentions, oldest first", () => {
    expect(mentionIds(list, "alice", ["ada"]).map((m) => m.id)).toEqual(["a1" as MessageId, "a2" as MessageId])
  })
  test("a handle an agent also holds counts as none", () => {
    expect(mentionIds(list, "alice", ["ada", "alice"]).map((m) => m.id)).toEqual(["a2" as MessageId])
  })
})

describe("viewLast", () => {
  test("a pending photo from the composer is a photo before it uploads", () => {
    const m = message("local:1", Number.MAX_SAFE_INTEGER, { kind: "human" }, "", { pending: true, local: [{ src: "blob:x", name: "a.png", mime: "", width: 4, height: 3 }] })
    expect(viewLast(m, (s) => s)).toEqual({ from: "human", kind: "photo", at: Number.MAX_SAFE_INTEGER })
  })
})
