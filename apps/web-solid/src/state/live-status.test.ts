import { describe, expect, it } from "vitest"
import { liveLine, liveStatusOf, type LiveInput } from "./live-status"

const human = (seq: number) => ({ seq, from: { kind: "human" as const } })
const agent = (seq: number, slug = "kiko") => ({ seq, from: { kind: "agent" as const, slug } })

const input = (over: Partial<LiveInput>): LiveInput => ({
  slug: "kiko",
  status: { state: "typing" },
  messages: [human(1)],
  mark: undefined,
  running: false,
  ...over,
})

describe("liveStatusOf", () => {
  it("says Thinking while the agent has not replied since the status started", () => {
    expect(liveStatusOf(input({}))).toEqual({ kind: "thinking", text: "Thinking" })
  })

  it("goes idle once a reply from that agent lands after the status started", () => {
    expect(liveStatusOf(input({ messages: [human(1), agent(2)], mark: 1 }))).toEqual({ kind: "idle", text: "" })
  })

  it("clears a status it never saw start once the agent has replied to the newest human message", () => {
    expect(liveStatusOf(input({ messages: [human(1), agent(2)] })).kind).toBe("idle")
  })

  it("keeps a status that started after the agent's last reply", () => {
    expect(liveStatusOf(input({ messages: [human(1), agent(2)], mark: 2 })).kind).toBe("thinking")
  })

  it("stays live while one of the agent's steps is still running", () => {
    expect(liveStatusOf(input({ messages: [human(1), agent(2)], mark: 1, running: true })).kind).toBe("thinking")
  })

  it("ignores another agent's reply", () => {
    expect(liveStatusOf(input({ messages: [human(1), agent(2, "juno")], mark: 1 })).kind).toBe("thinking")
  })

  it("is idle without a status", () => {
    expect(liveStatusOf(input({ status: undefined })).kind).toBe("idle")
  })

  it("names the tool in plain words and shows file names without storage prefixes", () => {
    const status = {
      state: "working" as const,
      doing: "reading /attachments/mvmm766u-notes.md",
      activity: { kind: "tool" as const, tool: "read" as const, caption: "reading /attachments/mvmm766u-notes.md" },
    }
    expect(liveStatusOf(input({ status }))).toEqual({ kind: "tool", text: "Reading notes.md" })
    expect(liveStatusOf(input({ status: { state: "working", doing: "using slow_tool" } })).text).toBe("Using slow tool")
  })

  it("does not keep a finished tool's words once the agent is back to typing", () => {
    const status = {
      state: "typing" as const,
      doing: "using slow tool",
      activity: { kind: "tool" as const, tool: "other" as const, caption: "using slow tool" },
    }
    expect(liveStatusOf(input({ status }))).toEqual({ kind: "thinking", text: "Thinking" })
  })

  it("shows a retry detail while typing", () => {
    expect(liveStatusOf(input({ status: { state: "typing", doing: "retrying, attempt 2" } })).text).toBe(
      "Retrying, attempt 2",
    )
  })
})

describe("liveLine", () => {
  it("uses the status text alone in a one-agent chat", () => {
    expect(liveLine([{ name: "Kiko", status: { kind: "tool", text: "Reading notes.md" } }], false)).toBe(
      "Reading notes.md",
    )
  })

  it("names the agent in a group", () => {
    expect(liveLine([{ name: "Juno", status: { kind: "thinking", text: "Thinking" } }], true)).toBe("Juno is thinking")
    expect(
      liveLine(
        [
          { name: "Juno", status: { kind: "thinking", text: "Thinking" } },
          { name: "Kiko", status: { kind: "tool", text: "Reading notes.md" } },
        ],
        true,
      ),
    ).toBe("Juno and Kiko are busy")
  })

  it("is null when nobody is live", () => {
    expect(liveLine([], true)).toBeNull()
  })
})
