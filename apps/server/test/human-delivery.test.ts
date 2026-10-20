import { expect, test } from "bun:test"
import type { AgentSlug, Chat, Envelope, Task } from "@kiko/protocol"
const MAX_ENTRY_BYTES=128*1024
import { Burst } from "../src/room/burst"
import { buildBrief, MAX_BOARD_BYTES } from "../src/room/brief"
import { attachedLine, Deliveries, withContext } from "../src/room/deliver"
import { reactionLines } from "../src/room/reactions"
import { RoomLog } from "../src/room/log"
import { Asks } from "../src/room/asks"
import { MAX_MEMBERS, type MemberRow } from "../src/room/members"
import { tags } from "../src/room/recipients"
import { MAX_TASKS } from "../src/room/workspace"
import { bubbleOf, MAX_BUBBLE_BYTES } from "../src/room/whole-text"
import { ROOM_STEPS } from "../src/room/schema"
import { sqlWith } from "./sql-shim"

const ROOM = "01J0000000000000000000000A"
const NOW = 1_000_000
const home = { userId: "alice", roomId: ROOM as never }
const ada = { slug: "ada", name: "Ada", role: "", model: "", lead: true, status: "idle" } as MemberRow
const bob = { slug: "bob", name: "Bob", role: "", model: "", lead: false, status: "idle" } as MemberRow


function setup(_refusal:unknown){const sql=sqlWith(ROOM_STEPS);const storage={sql,transactionSync:<T>(f:()=>T)=>f()} as unknown as DurableObjectStorage;return {log:new RoomLog(storage,()=>NOW)}}

test("a human message rides with the board's largest brief and is admitted", () => {
  const tasks = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `t${i}`, owner: "ada", status: "todo", title: "漢".repeat(200), dependsOn: [] }) as unknown as Task)
  const brief = buildBrief(ada, { goal: "ship", members: [ada, bob], tasks, reactions: null })
  const envelope: Envelope = { id: "human:m1", roomId: ROOM as never, from: { kind: "human" }, body: "漢".repeat(16_000), hop: 0, rootId: "m1", seq: 1 }
  expect(new TextEncoder().encode(brief).length).toBeLessThanOrEqual(MAX_BOARD_BYTES + 2_048)
  expect(brief).toContain("more on the board")
  expect(new TextEncoder().encode(JSON.stringify({envelopes:[envelope],brief})).length).toBeLessThan(256*1024)
})

test("the worst human message fits its inbox entry, and the test prints the measured margin under the 128 KiB limit", () => {
  // The bubble: 16,000 control characters, six bytes of JSON each, the largest bubble the text can give.
  const bubble = bubbleOf("\u001b".repeat(16_000))
  // The reply quote withContext adds: 600 control characters, the longest quote it keeps.
  const reply = `(replying to @m0, about this part: "${"\u001b".repeat(600)}")`
  // The room's most members, each with a 400-character role (the brief names the whole role, five bytes per character) and a 60-character name.
  const roster = [ada, ...Array.from({ length: MAX_MEMBERS - 1 }, (_, i) => ({ ...bob, slug: `m${i}`, name: "&".repeat(60), lead: false }) as MemberRow)].map((m) => ({
    ...m,
    role: "&".repeat(400),
  }))
  const tasks = Array.from({ length: MAX_TASKS }, (_, i) => ({ id: `t${i}`, owner: "ada", status: "todo", title: "&".repeat(400), dependsOn: [] }) as unknown as Task)
  // Every member but the recipient is doing something long, and the first of them holds 60 paths of 500 characters.
  const holds = Array.from({ length: 60 }, (_, i) => `${"&".repeat(500)}${i}`)
  const team = Object.fromEntries(roster.slice(1).map((m, i) => [m.slug, { doing: "&".repeat(500), holds: i === 0 ? holds : [] }]))
  // Forty reactions by a 33-character actor, each on a 60-character quote.
  const reactions = reactionLines(Array.from({ length: 40 }, () => ({ by: `@${"a".repeat(32)}`, emoji: "❤️‍🔥", text: "&".repeat(60) })))
  const brief = buildBrief(roster[0]!, {
    goal: "&".repeat(500),
    members: roster,
    tasks,
    reactions,
    human: "&".repeat(60),
    team,
  })
  expect(new TextEncoder().encode(brief).length).toBeGreaterThan(MAX_BOARD_BYTES)
  expect(brief).toContain("and 59 more")
  // 100 attachments with 120-character names of control characters, the largest a message can carry.
  const files = Array.from({ length: 100 }, (_, i) => ({ id: `f${i}`, name: "\u001b".repeat(120), size: 1_000_000, type: "text/plain" }))
  const line = attachedLine(files)
  expect(line).toContain("and 95 more")
  const body = `${reply}\n${bubble}\n${line}`
  const envelope: Envelope = { id: "human:m1", roomId: ROOM as never, from: { kind: "human" }, body, hop: 0, rootId: "m1", seq: 1 }
  const entry = new TextEncoder().encode(JSON.stringify(envelope)).length + new TextEncoder().encode(brief).length
  console.log(`worst entry: ${entry} bytes of ${MAX_ENTRY_BYTES}, margin ${MAX_ENTRY_BYTES - entry}`)
  expect(entry, `the worst entry is ${entry} bytes, the limit is ${MAX_ENTRY_BYTES} (${MAX_ENTRY_BYTES - entry} bytes of margin)`).toBeLessThan(MAX_ENTRY_BYTES)
  expect(new TextEncoder().encode(JSON.stringify({envelopes:[envelope],brief})).length).toBeLessThan(256*1024)
})

test("a long doing text and a long handle are cut in the brief", () => {
  const brief = buildBrief(ada, {
    goal: "g",
    members: [ada, { ...bob, role: "" }],
    tasks: [],
    reactions: null,
    human: "h".repeat(300),
    team: { bob: { doing: "d".repeat(5_000), holds: [] } },
  })
  const lines = brief.split("\n")
  expect(lines.find((l) => l.includes("now "))).toContain(`now ${"d".repeat(80)}...`)
  // The human line: a 40-character handle, then the hint.
  expect(lines.find((l) => l.startsWith("the human is"))?.length).toBeLessThan(300)
})

test("the agent's envelope of a long human message names the file that holds its whole text", () => {
  const { log } = setup(null)
  const whole = { id: "0c4f0c4f-0000-4000-8000-000000000001", name: "attachments/abc-message.txt", type: "text/plain", size: 40_000 }
  const stored = log.addMessage({ from: { kind: "human" }, text: "x".repeat(16_000), clientId: "c1", files: [whole] })
  const envelope: Envelope = { id: `human:${stored.id}`, roomId: ROOM as never, from: { kind: "human" }, body: "x".repeat(16_000), hop: 0, rootId: stored.id, seq: stored.seq }
  expect(withContext(log, envelope).body).toContain("(attached: /attachments/abc-message.txt (text/plain, 39 kb).")
})

test("the agent's envelope names the workspace files the human dragged into the message, so it reads them", () => {
  const { log } = setup(null)
  const text = "compare [a.ts](/src/a.ts) with [Plan (v2).md](</notes/Plan (v2).md>) and [site](https://x.com/a) and [a.ts](/src/a.ts)"
  const stored = log.addMessage({ from: { kind: "human" }, text, clientId: "c2" })
  const envelope: Envelope = { id: `human:${stored.id}`, roomId: ROOM as never, from: { kind: "human" }, body: text, hop: 0, rootId: stored.id, seq: stored.seq }
  expect(withContext(log, envelope).body).toContain("(referenced: /src/a.ts, /notes/Plan (v2).md. open a file with read, or list a folder with ls, before you answer about it.)")
})

test("an upload the message carries is attached, not referenced", () => {
  const { log } = setup(null)
  const file = { id: "0c4f0c4f-0000-4000-8000-000000000002", name: "attachments/abc-a.txt", type: "text/plain", size: 10 }
  const text = "see [a.txt](/attachments/abc-a.txt)"
  const stored = log.addMessage({ from: { kind: "human" }, text, clientId: "c3", files: [file] })
  const envelope: Envelope = { id: `human:${stored.id}`, roomId: ROOM as never, from: { kind: "human" }, body: text, hop: 0, rootId: stored.id, seq: stored.seq }
  const body = withContext(log, envelope).body
  expect(body).toContain("(attached: /attachments/abc-a.txt")
  expect(body).not.toContain("(referenced:")
})
