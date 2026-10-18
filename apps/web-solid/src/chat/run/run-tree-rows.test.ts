import { describe, expect, test } from "bun:test"
import type { RunStep } from "@kiko/protocol"
import { isLive, LIVE_ROWS, type Tree, type TreeRow, type TreeState, treeOf } from "./run-tree-rows"

const step = (id: string, at: number, over: Partial<RunStep> = {}): RunStep => ({
  id,
  runId: "r1",
  slug: "kiko" as RunStep["slug"],
  tool: "read",
  name: "read",
  label: `Read /${id}.md`,
  status: "done",
  startedAt: at,
  after: 0,
  ...over,
})
const reads = (...ids: string[]) => ids.map((id, i) => step(id, 1000 * (i + 1)))
const worker = (id: string, at: number, over: Partial<RunStep> = {}) => step(id, at, { worker: { id: "k1", task: "Check the build" }, ...over })
const note = (id: string, at: number, label: string) => step(id, at, { tool: "other", name: "note", note: true, label })

const line = (row: TreeRow) => `${row.kind === "step" ? "" : `${row.kind}: `}${row.label}${row.icon ? ` [${row.icon}]` : ""}${row.running ? " *" : ""}`

/**
 * What the reader sees, top to bottom: the head (">" closed, "v" open, "!" for a failure), the rows
 * it opens while it is open, then the rows that always show. A row that is not a call names its
 * kind first, its glyph follows in brackets, and a label that shines ends in "*".
 */
const drawn = (tree: Tree): string[] => [
  ...(tree.head ? [`${tree.head.label} ${tree.head.open ? "v" : ">"}${tree.head.failed ? " !" : ""}`] : []),
  ...(tree.head?.open ? tree.folded : []).map(line),
  ...tree.shown.map(line),
]

const working: TreeState = { working: true, open: false }
const done = (count: number, over: Partial<TreeState> = {}): TreeState => ({ working: false, open: false, count, ...over })

describe("treeOf while the agent works", () => {
  const table: [string, RunStep[], TreeState, string[]][] = [
    [
      "up to three entries show as they are, and the running one shines in the present tense",
      [step("a", 1000), step("b", 2000), step("c", 3000, { status: "running" })],
      working,
      ["Read /a.md [file-view]", "Read /b.md [file-view]", "Reading /c.md [file-view] *"],
    ],
    [
      "a step still running keeps the window live after a bubble opens it",
      [step("a", 1000), step("b", 2000, { tool: "run", name: "bash", label: "Ran bun test", input: "bun test", status: "running" })],
      { working: false, open: false, count: 2 },
      ["Read /a.md [file-view]", "Running bun [terminal] *"],
    ],
    ["older entries fold under one row that counts them", reads("a", "b", "c", "d", "e"), working, ["2 earlier steps >", "Read /c.md [file-view]", "Read /d.md [file-view]", "Read /e.md [file-view]"]],
    [
      "that row opens the whole list",
      reads("a", "b", "c", "d", "e"),
      { working: true, open: true },
      ["2 earlier steps v", "Read /a.md [file-view]", "Read /b.md [file-view]", "Read /c.md [file-view]", "Read /d.md [file-view]", "Read /e.md [file-view]"],
    ],
    ["one earlier step is one", reads("a", "b", "c", "d"), working, ["1 earlier step >", "Read /b.md [file-view]", "Read /c.md [file-view]", "Read /d.md [file-view]"]],
    [
      "a failure that folded away marks the row that hides it",
      [step("a", 1000, { status: "failed" }), ...reads("b", "c", "d").map((s, i) => ({ ...s, startedAt: 2000 + i }))],
      working,
      ["1 earlier step > !", "Read /b.md [file-view]", "Read /c.md [file-view]", "Read /d.md [file-view]"],
    ],
    ["a failed step shows the alert glyph", [step("a", 1000, { tool: "run", name: "bash", label: "Ran bun test", status: "failed" })], working, ["Ran bun test [alert-circle]"]],
    [
      "a background worker is one row named by its task, shining while it works",
      [step("a", 1000), step("start", 2000, { tool: "other", name: "start_work", label: "Started a worker" }), worker("w1", 2500), worker("w2", 3000, { status: "running" }), step("b", 4000)],
      working,
      ["1 earlier step >", "Started a worker [worker]", "worker: Check the build [worker] *", "Read /b.md [file-view]"],
    ],
    ["a note is plain words with no glyph", [step("a", 1000), note("n", 1500, "Now the inbox."), step("b", 2000, { status: "running" })], working, ["Read /a.md [file-view]", "note: Now the inbox.", "Reading /b.md [file-view] *"]],
    ["a window with no steps yet draws nothing", [], working, []],
  ]
  for (const [name, steps, state, want] of table) test(name, () => expect(drawn(treeOf(steps, state))).toEqual(want))

  test("it shows the newest entries and folds the oldest", () => {
    const tree = treeOf(reads("a", "b", "c", "d", "e", "f"), working)
    expect(tree.shown).toHaveLength(LIVE_ROWS)
    expect(tree.folded.map((r) => r.label)).toEqual(["Read /a.md", "Read /b.md", "Read /c.md"])
  })
})

describe("treeOf once a bubble opens the window", () => {
  const ran = step("c", 3000, { tool: "run", name: "bash", label: "Ran bun test" })
  const table: [string, RunStep[], TreeState, string[]][] = [
    ["finished work is one closed sentence", [...reads("a", "b"), ran], done(3), ["Read 2 files and ran 1 command >"]],
    ["opening it shows every entry", [...reads("a", "b"), ran], done(3, { open: true }), ["Read 2 files and ran 1 command v", "Read /a.md [file-view]", "Read /b.md [file-view]", "Ran bun test [terminal]"]],
    ["a failure shows the alert glyph on the sentence", [step("a", 1000, { tool: "run", name: "bash", label: "Ran bun test", status: "failed" })], done(1), ["Ran 1 command > !"]],
    ["the bubble's count stands in while this client holds none of its steps", [], done(5), ["5 steps >"]],
    ["one step is one", [], done(1), ["1 step >"]],
    ["it stands in while some are missing too, and the open list shows the ones held", reads("a"), done(3, { open: true }), ["3 steps v", "Read /a.md [file-view]"]],
    ["the list waits for the rest with a shining row while they are on their way", reads("a"), done(3, { open: true, fetching: true }), ["3 steps v", "Read /a.md [file-view]", "loading: Loading steps… *"]],
    ["once every step is held the wait goes, even if an answer is still marked as coming", reads("a", "b"), done(2, { open: true, fetching: true }), ["Read 2 files v", "Read /a.md [file-view]", "Read /b.md [file-view]"]],
    ["a worker folds into one row in the finished list", [step("a", 1000), worker("w1", 2000), worker("w2", 3000)], done(3, { open: true }), ["Read 3 files v", "Read /a.md [file-view]", "worker: Check the build [worker]"]],
    ["a window of words only falls back to the count", [note("n", 1000, "Thinking it over.")], done(1, { open: true }), ["1 step v", "note: Thinking it over."]],
    ["the summary counts only calls, and the notes still show", [step("a", 1000), note("n", 1500, "Next, the plan."), step("b", 2000)], done(3, { open: true }), ["Read 2 files v", "Read /a.md [file-view]", "note: Next, the plan.", "Read /b.md [file-view]"]],
    ["no count and no steps draws nothing", [], { working: false, open: false }, []],
  ]
  for (const [name, steps, state, want] of table) test(name, () => expect(drawn(treeOf(steps, state))).toEqual(want))

  test("a done tree keeps every entry behind its head, with nothing always shown", () => {
    const tree = treeOf(reads("a", "b", "c", "d", "e"), done(5))
    expect(tree.head?.kind).toBe("summary")
    expect(tree.folded).toHaveLength(5)
    expect(tree.shown).toEqual([])
  })
})

test("a window is live while its agent works on it or any step runs", () => {
  expect(isLive([], true)).toBe(true)
  expect(isLive([{ status: "done" }, { status: "running" }], false)).toBe(true)
  expect(isLive([{ status: "done" }, { status: "failed" }], false)).toBe(false)
})
