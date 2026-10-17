import { expect, test } from "bun:test"
import { ACK_CHARS, ackOf, hasToolCall, NOTE_CHARS, noteOf, postOf } from "../src/agent/pacing"
import { Outbox, type RoomPort } from "../src/agent/outbox"
import { AGENT_STEPS } from "../src/agent/schema"
import { sqlWith } from "./sql-shim"

const call = { type: "toolCall" }
const says = (text: string, extra: Record<string, unknown> = {}) => ({ role: "assistant", stopReason: "stop", content: [{ type: "text", text }], ...extra })
const narrates = (text: string) => ({ role: "assistant", stopReason: "toolUse", content: [{ type: "text", text }, call] })

test("a message with a tool call is narration, and the first narration of a run is the ack", () => {
  expect(postOf(narrates("Reading the file."), { posted: false, quiet: false })).toBe("ack")
  // Once the run has said anything, later narration belongs to the step pane.
  expect(postOf(narrates("Reading it again."), { posted: true, quiet: false })).toBe("none")
})

test("a message with no tool call is the answer, whatever came before it", () => {
  expect(postOf(says("Here it is."), { posted: false, quiet: false })).toBe("answer")
  expect(postOf(says("Here it is."), { posted: true, quiet: false })).toBe("answer")
})

test("a quiet run, one answering a system event, posts nothing either way", () => {
  expect(postOf(narrates("Checking."), { posted: false, quiet: true })).toBe("none")
})

test("a failed or aborted message posts nothing", () => {
  expect(postOf(says("Wait.", { stopReason: "error" }), { posted: false, quiet: false })).toBe("none")
  expect(postOf(says("Half.", { stopReason: "aborted" }), { posted: false, quiet: false })).toBe("none")
})

test("the ack is its first line, cut short", () => {
  expect(ackOf("\n  Retrying SRK photos.\nthen more")).toBe("Retrying SRK photos.")
  expect(ackOf("x".repeat(ACK_CHARS + 50))).toHaveLength(ACK_CHARS)
  expect(ackOf("   ")).toBe("")
})

test("a note is trimmed to its budget", () => {
  expect(noteOf("  Reading it now.  ")).toBe("Reading it now.")
  expect(noteOf("y".repeat(NOTE_CHARS + 50))).toHaveLength(NOTE_CHARS)
})

test("hasToolCall only counts a call", () => {
  expect(hasToolCall(narrates("x"))).toBe(true)
  expect(hasToolCall(says("x"))).toBe(false)
  expect(hasToolCall(undefined)).toBe(false)
})

/** An outbox over a fake room, driven one entry at a time the way the harness drives it. */
function driven() {
  const posts: string[] = []
  const notes: { id: string; text: string }[] = []
  const room = {
    post: async (_r: string, _a: number, _i: number, block: string) => void posts.push(block),
    draft: async () => {},
    note: async (_r: string, id: string, text: string) => void notes.push({ id, text }),
    status: async () => {},
    workers: async () => {},
    endRun: async () => {},
    react: async () => {},
    runError: async () => {},
  } satisfies RoomPort
  const outbox = new Outbox({ sql: sqlWith(AGENT_STEPS) } as unknown as DurableObjectStorage, () => room, () => "run")
  const inner = outbox as unknown as { start(id: string, cursor: number): Promise<void>; entry(e: unknown): Promise<void>; save(r: unknown): void; run: unknown }
  const entry = (id: number, model: readonly unknown[]) => inner.entry({ id, kind: "pi.message", model })
  return { posts, notes, inner: { start: (id: string, cursor: number) => inner.start(id, cursor), entry } }
}

test("narration, tool, narration, tool, answer posts the ack and the answer, and notes the narration", async () => {
  const { posts, notes, inner } = driven()
  await inner.start("run-1", 0)
  await inner.entry(1, [narrates("Reading /plan.md.")])
  await inner.entry(2, [narrates("Listing the folder.")])
  await inner.entry(3, [narrates("Running the tests.")])
  await inner.entry(4, [says("All three checks pass.")])
  expect(posts).toEqual(["Reading /plan.md.", "All three checks pass."])
  expect(notes.map((n) => n.text)).toEqual(["Listing the folder.", "Running the tests."])
})

test("a run with only an answer posts the answer, with no note", async () => {
  const { posts, notes, inner } = driven()
  await inner.start("run-1", 0)
  await inner.entry(1, [says("Yes, it is done.")])
  expect(posts).toEqual(["Yes, it is done."])
  expect(notes).toEqual([])
})

test("a message the model failed carries no bubble and no note", async () => {
  const { posts, notes, inner } = driven()
  await inner.start("run-1", 0)
  await inner.entry(1, [{ role: "assistant", stopReason: "error", content: [{ type: "text", text: "Wait a minute." }] }])
  expect(posts).toEqual([])
  expect(notes).toEqual([])
})
