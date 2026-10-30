import type { RunStep, Task } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import type { ChatMessage } from "../../lib/types"
import type { HelperLane } from "../helpers/helper-model"
import {
  FINISH_KEEP_MS,
  agentFiles,
  helperSplit,
  nowRows,
  outputTiles,
  progressView,
  usedRows,
} from "./thread-details-model"

const task = (id: string, status: Task["status"], title = id) =>
  ({ id, status, title, dependsOn: [] }) as unknown as Task

const step = (over: Partial<RunStep>): RunStep =>
  ({
    id: "s1",
    runId: "r1",
    slug: "kiko",
    tool: "web",
    name: "browse",
    label: "Browsed a page",
    status: "done",
    startedAt: 1,
    after: 0,
    ...over,
  }) as RunStep

describe("thread details model", () => {
  it("splits open and done tasks and puts the run's first open task in progress", () => {
    const tasks = [task("a", "done"), task("b", "doing"), task("c", "todo"), task("d", "cancelled")]
    const view = progressView(tasks, true)
    expect(view.open.map((entry) => entry.id)).toEqual(["b", "c"])
    expect(view.done.map((entry) => entry.id)).toEqual(["a"])
    expect(view.currentId).toBe("b")
    expect(`${view.completed} of ${view.total}`).toBe("1 of 3")
    expect(view.allDone).toBe(false)
    expect(progressView(tasks, false).currentId).toBeNull()
  })

  it("knows when every task is done", () => {
    const view = progressView([task("a", "done"), task("b", "done")], false)
    expect(view.allDone).toBe(true)
    expect(progressView([], false).allDone).toBe(false)
  })

  it("keeps a finished helper briefly and then counts it under finished", () => {
    const lane = (id: string, state: HelperLane["state"], endedAt?: number): HelperLane => ({
      id,
      slug: "kiko",
      window: "kiko#1",
      task: id,
      title: id,
      state,
      line: "Reading",
      startedAt: 1,
      endedAt,
      count: 1,
      steps: [],
    })
    const lanes = [lane("w1", "working"), lane("w2", "done", 1_000), lane("w3", "failed", 0)]
    const early = helperSplit(lanes, 1_000 + FINISH_KEEP_MS - 1)
    expect(early.shown.map((entry) => entry.id)).toEqual(["w1", "w2"])
    expect(early.working).toBe(1)
    expect(early.finished.map((entry) => entry.id)).toEqual(["w2", "w3"])
    expect(helperSplit(lanes, 1_000 + FINISH_KEEP_MS).shown.map((entry) => entry.id)).toEqual(["w1"])
  })

  it("shows the newest outputs and folds the rest into a +N tile", () => {
    const files = ["a", "b", "c", "d"]
    expect(outputTiles(files, 6)).toEqual({ shown: ["d", "c", "b", "a"], more: 0 })
    expect(outputTiles(files, 3)).toEqual({ shown: ["d", "c"], more: 2 })
  })

  it("keeps owner uploads out of the outputs and leaves them to the used rows", () => {
    const files = [{ name: "notes.md" }, { name: "attachments/mvmm766u-plan.pdf" }, { name: "out/report.csv" }]
    expect(agentFiles(files).map((file) => file.name)).toEqual(["notes.md", "out/report.csv"])
  })

  it("builds the used rows from uploads and tool calls, one row per category that has data", () => {
    const messages = [
      {
        sender: "user",
        files: [{ name: "attachments/plan.pdf", path: "/attachments/plan.pdf", size: 1, type: "application/pdf" }],
      },
      {
        sender: "user",
        files: [{ name: "attachments/shot.mov", path: "/attachments/shot.mov", size: 1, type: "video/quicktime" }],
      },
      { sender: "bot", files: [{ name: "made.md", path: "/made.md", size: 1, type: "text/markdown" }] },
    ] as unknown as ChatMessage[]
    const steps = [
      step({ id: "s1", name: "browse", label: "Browsed a page", input: '{"urls":["https://example.com"]}' }),
      step({
        id: "s2",
        name: "composio_web_search",
        tool: "search",
        label: "Searched the web",
        input: '{"query":"flights"}',
      }),
      step({ id: "s3", name: "recall", tool: "other", label: "Recalled a fact" }),
    ]
    const rows = usedRows(messages, steps)
    expect(rows.map((row) => row.kind)).toEqual(["uploads", "web", "pages", "memory"])
    expect(rows[0]).toMatchObject({ label: "Uploads", summary: "plan.pdf, shot.mov" })
    expect(rows[1]).toMatchObject({ label: "Web search", summary: "1 search" })
    expect(rows[1]!.items[0]!.name).toBe("flights")
    expect(rows[2]).toMatchObject({ label: "Pages read", summary: "1 page" })
    expect(rows[2]!.items[0]!.name).toBe("https://example.com")
    expect(rows[3]!.label).toBe("Memory")
  })

  it("leaves out categories with no client data", () => {
    expect(usedRows([], [])).toEqual([])
    expect(usedRows([], [step({ name: "read", tool: "read", label: "Read a file" })])).toEqual([])
  })

  it("names one Now row per working agent with the time it started", () => {
    const rows = nowRows({
      slugs: ["kiko", "scout"],
      lines: ["Reading notes.md", undefined],
      since: (slug) => (slug === "kiko" ? 10 : undefined),
      fallback: 50,
    })
    expect(rows).toEqual([
      { slug: "kiko", line: "Reading notes.md", since: 10 },
      { slug: "scout", line: "Working", since: 50 },
    ])
  })
})
