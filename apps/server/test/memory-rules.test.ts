import { expect, test } from "bun:test"
import type { Envelope } from "@kiko/protocol"
import { parseZoomId } from "@kiko/memory/tools"
import { perRun } from "../src/agent/extensions/self"
import { briefToShow } from "@kiko/agent/host"
import { renderInput } from "@kiko/agent/inbox"
import { itemLine } from "@kiko/memory/optmem"
import { buildBrief, shortBrief } from "../src/room/brief"
import type { MemberRow } from "../src/room/members"
import { norm } from "@kiko/memory/life"

// Section 13.4 and 7.4: the small rules that keep a run from paying twice for what it already has.

const zoomCases: [string, ReturnType<typeof parseZoomId>][] = [
  ["chat:12", { log: "chat", id: "12" }],
  ["#12", { log: "chat", id: "12" }],
  ["12", { log: "chat", id: "12" }],
  [" chat:#12 ", { log: "chat", id: "12" }],
  ["chat:0-63", { log: "chat", id: "0-63" }],
  ["#0-63", { log: "chat", id: "0-63" }],
  ["room:16-31", { log: "chat", id: "16-31" }],
  ["life:64-127", { log: "life", id: "64-127" }],
  ["life:#7", { log: "life", id: "7" }],
  ["Life:7", { log: "life", id: "7" }],
  ["chat:", null],
  ["web:12", null],
  ["twelve", null],
]
for (const [raw, want] of zoomCases) test(`zoom id ${JSON.stringify(raw)}`, () => expect(parseZoomId(raw)).toEqual(want))

test("a cut line's hint is an id zoom takes, in its own log", () => {
  const long = { pos: 12, at: Date.UTC(2026, 9, 6, 14, 5), text: "x".repeat(400), tainted: false }
  const chat = itemLine(long, 300)
  expect(chat).toEndWith("(cut, zoom chat:12)")
  expect(parseZoomId(/zoom (\S+)\)$/.exec(chat)![1]!)).toEqual({ log: "chat", id: "12" })
  expect(itemLine(long, 300, true, "life")).toEndWith("(cut, zoom life:12)")
})

const ada: MemberRow = { slug: "ada", name: "ada", role: "", lead: true, status: "idle" } as unknown as MemberRow
const bob: MemberRow = { slug: "bob", name: "bob", role: "tests", lead: false, status: "idle" } as unknown as MemberRow
const brief = (adaDoing: string | null, bobDoing: string | null) =>
  buildBrief(ada, {
    goal: "trip",
    members: [ada, bob],
    tasks: [],
    reactions: null,
    human: "sam",
    team: { ada: { doing: adaDoing, holds: adaDoing ? ["plan.md"] : [] }, bob: { doing: bobDoing, holds: [] } },
  })

test("the agent's own doing is not in its brief, a teammate's is", () => {
  expect(brief("editing /plan.md", null)).toBe(brief(null, null))
  expect(brief(null, "reading a web page")).toContain("@bob (bob): tests, now reading a web page")
})

test("the long line about the human is cut from a brief that is not fresh", () => {
  const full = brief(null, null)
  expect(full).toContain("the human is @sam. write @sam only when you need them")
  expect(shortBrief(full)).toContain("the human is @sam.\n")
  expect(shortBrief(full)).not.toContain("write @sam")
})

test("only the newest brief shows, once, until it changes or the run starts fresh", () => {
  const a = brief(null, null)
  const b = brief(null, "reading a web page")
  const first = briefToShow([a], true, undefined, shortBrief)
  expect(first.brief).toBe(a)
  // The same brief again, on a run that goes on: the transcript has it.
  expect(briefToShow([a], false, first.key, shortBrief)).toEqual({ key: first.key })
  // A batch with two briefs shows only the newest, without the long line.
  const next = briefToShow([a, b], false, first.key, shortBrief)
  expect(next.brief).toBe(shortBrief(b))
  expect(next.key).not.toBe(first.key)
  // A fresh run shows it in full even when unchanged, since the transcript starts over.
  expect(briefToShow([b], true, next.key, shortBrief).brief).toBe(b)
  expect(briefToShow([], false, next.key, shortBrief)).toEqual({})
})

let n = 0
const human = (body: string): Envelope =>
  ({ id: `human:01K${++n}`, roomId: "01J00000000000000000000000", from: { kind: "human" }, body, hop: 0, rootId: "m1", tainted: false, seq: n }) as unknown as Envelope

test("a batch with one human message names its id, briefly", () => {
  const one = human("thanks!")
  expect(renderInput({ briefs: [], envelopes: [one] })).toBe(`thanks!\n\n<context>message id: ${one.id.slice(6)}</context>`)
  const two = [human("a"), human("b")]
  expect(renderInput({ briefs: [], envelopes: two })).toContain(`message ids, oldest first:\n${two[0]!.id.slice(6)}: a\n${two[1]!.id.slice(6)}: b`)
})

test("a note that says the same fact in other words is one fact", () => {
  expect(norm("The human's sister is Maya.")).toBe(norm("human's sister maya"))
  expect(norm("her sister is maya")).not.toBe(norm("his sister is maya"))
  expect(norm("likes tea")).not.toBe(norm("likes coffee"))
})

test("the prompt reads a file once per run, and again when the run changes", async () => {
  let reads = 0
  let run = 1
  const read = perRun(async () => ++reads, () => run)
  expect(await read()).toBe(1)
  expect(await read()).toBe(1)
  run = 2
  expect(await read()).toBe(2)
  // Without a stamp, every request reads.
  const every = perRun(async () => ++reads)
  await every()
  await every()
  expect(reads).toBe(4)
})
