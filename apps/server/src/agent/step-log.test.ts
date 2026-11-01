import type { ConversationId } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { stepsFromEntries } from "./step-log"

const CONTEXT = "c1" as unknown as ConversationId
const scope = () => ({ runId: "run:1" })

type Entry = Parameters<typeof stepsFromEntries>[0][number]

const assistant = (id: number, content: readonly object[], text?: string): Entry => ({
  id,
  conversationId: CONTEXT,
  kind: "pi.assistant",
  model: [
    {
      role: "assistant",
      timestamp: 1_000,
      content: [...(text ? [{ type: "text", text }] : []), ...content],
    },
  ],
})

const call = (id: string, name: string, args: Record<string, unknown>) => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
})

const result = (
  id: number,
  toolCallId: string,
  text: string,
  extra: { timestamp?: number; durationMs?: number; isError?: boolean } = {},
): Entry => ({
  id,
  conversationId: CONTEXT,
  kind: "pi.tool",
  model: [
    {
      role: "toolResult",
      toolCallId,
      timestamp: extra.timestamp ?? 1_400,
      durationMs: extra.durationMs ?? 400,
      ...(extra.isError ? { isError: true } : {}),
      content: [{ type: "text", text }],
    },
  ],
})

const input = (id: number, kind = "kiko.input"): Entry => ({ id, conversationId: CONTEXT, kind })

describe("steps from the journal", () => {
  it("turns a tool round's text into the run's note and its result into a card", () => {
    const items = stepsFromEntries(
      [input(1), assistant(2, [call("t1", "bash", { command: "ls -la" })], "On it."), result(3, "t1", "a.ts")],
      1,
      scope,
    )

    expect(items.map((item) => item.step)).toMatchObject([
      { id: "note:2", name: "note", note: true, label: "On it.", status: "done" },
      {
        id: "t1",
        runId: "run:1",
        tool: "run",
        name: "bash",
        label: "Ran ls -la",
        status: "done",
        startedAt: 1_000,
        endedAt: 1_400,
        output: "a.ts",
      },
    ])
  })

  it("keeps a failed call failed and drops a call that never returned", () => {
    const items = stepsFromEntries(
      [
        input(1),
        assistant(2, [call("t1", "bash", { command: "false" }), call("t2", "bash", { command: "sleep 9" })]),
        result(3, "t1", "exit 1", { isError: true }),
      ],
      1,
      scope,
    )

    expect(items.map((item) => [item.step.id, item.step.status, item.step.output])).toEqual([
      ["t1", "failed", "exit 1"],
    ])
  })

  it("stops at the next input and skips what came before the window", () => {
    const items = stepsFromEntries(
      [
        assistant(2, [call("old", "bash", { command: "ls" })]),
        result(3, "old", "before"),
        input(4),
        assistant(5, [call("t1", "bash", { command: "ls" })]),
        result(6, "t1", "inside"),
        input(7, "pi.user"),
        assistant(8, [call("t2", "bash", { command: "ls" })]),
        result(9, "t2", "after"),
      ],
      4,
      scope,
    )

    expect(items.map((item) => item.step.id)).toEqual(["t1"])
  })

  it("uses the agent's own description when it has one", () => {
    const items = stepsFromEntries(
      [input(1), assistant(2, [call("t1", "bash", { command: "ls" })]), result(3, "t1", "a.ts")],
      1,
      scope,
      () => ({ label: "checked the folder", input: "ls" }),
    )

    expect(items[0]?.step).toMatchObject({ label: "checked the folder", input: "ls" })
  })
})
