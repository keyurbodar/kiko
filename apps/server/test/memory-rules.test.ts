import { expect, test } from "bun:test"
import type { Envelope } from "@yuki/protocol"
import { MEMORY_NOTE, memoryExtensions, parseZoomId } from "@yuki/memory/tools"
import { perRun } from "../src/agent/extensions/self"
import { briefToShow } from "@yuki/agent/host"
import { renderInput } from "@yuki/agent/inbox"
import { itemLine } from "@yuki/memory/optmem"
import { buildBrief, shortBrief } from "../src/room/brief"
import type { MemberRow } from "../src/room/members"
import { norm } from "@yuki/memory/life"

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
  const long = { pos: 12, at: Date.UTC(2026, 9, 6, 14, 5), text: "x".repeat(400) }
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
  expect(briefToShow([a], false, first.key, shortBrief)).toEqual({ key: first.key })
  const next = briefToShow([a, b], false, first.key, shortBrief)
  expect(next.brief).toBe(shortBrief(b))
  expect(next.key).not.toBe(first.key)
  expect(briefToShow([b], true, next.key, shortBrief).brief).toBe(b)
  expect(briefToShow([], false, next.key, shortBrief)).toEqual({})
})

let n = 0
const human = (body: string): Envelope =>
  ({ id: `human:01K${++n}`, roomId: "01J00000000000000000000000", from: { kind: "human" }, body, hop: 0, rootId: "m1", seq: n }) as unknown as Envelope

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
  const every = perRun(async () => ++reads)
  await every()
  await every()
  expect(reads).toBe(4)
})

test("the note rule follows capture on every render, and both versions mention replaces", async () => {
  let captures = false
  const port = { note: async () => ({ ok: true as const, pos: 0 }), recall: async () => "", zoom: async () => null, captures: () => captures }
  const section = memoryExtensions(port).find((e) => e.name === MEMORY_NOTE)!.sections![0]!
  const render = () => section.render({} as never, {} as never)
  const off = await render()
  expect(off).toContain("the moment you learn it")
  expect(off).not.toContain("saved on its own")
  captures = true
  const on = await render()
  expect(on).toContain("saved on its own")
  expect(on).not.toContain("the moment you learn it")
  for (const rule of [off, on]) expect(rule).toContain("replaces: life:n")
})
