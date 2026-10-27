import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { defineExtension, Harness, hook, MemoryStorage, ToolTask } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { fakeSetup } from "../dev-fake"
import { presenceExtension, type StepItem, type StepsPort } from "./presence"

const context = BACKGROUND_CONTEXT

const BLOCKED = "you already made this exact call twice. change the approach or answer with what you have."

function blocker(tool: string, after: number): ReturnType<typeof defineExtension> {
  let seen = 0
  return defineExtension({
    name: "test-blocker",
    hooks: [
      hook(ToolTask, {
        beforeTool: (call) => {
          if (call.name !== tool) return undefined
          seen += 1
          return seen > after ? { block: BLOCKED } : undefined
        },
      }),
    ],
  })
}

function recorder() {
  const pushed: StepItem[] = []
  const port: StepsPort = {
    scope: () => ({ runId: "r1" }),
    push: (item) => void pushed.push(item),
  }
  return { pushed, port }
}

const stillOpen = (pushed: readonly StepItem[]): string[] => {
  const running = new Set<string>()
  for (const item of pushed) {
    if (item.step.status === "running") running.add(item.step.id)
    else running.delete(item.step.id)
  }
  return [...running]
}

async function round(contents: readonly string[], extra: ReturnType<typeof blocker>) {
  const { pushed, port } = recorder()
  const setup = fakeSetup(undefined, undefined, undefined, {
    presence: port,
    runId: () => "r1",
    testExtensions: [extra],
  })
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: setup.models, registry: setup.registry, settings: setup.settings },
    context,
  )
  harness.resume()
  const root = await harness.root(context, { agent: setup.agent })
  for (const content of contents) {
    const submission = await root.submit({ type: "input", content }, context)
    expect(await submission.wait(context)).toMatchObject({ status: "done" })
  }
  await harness.close(context)
  return pushed
}

describe("a step shown while a call runs", () => {
  it("closes when a later hook blocks the call, so its lane stops working", async () => {
    const pushed = await round(['[tool slow_tool {"ms":1}]'], blocker("slow_tool", 0))

    expect(pushed.filter((item) => item.step.status === "running")).toHaveLength(1)
    expect(pushed.filter((item) => item.step.status === "failed")).toHaveLength(1)
    expect(stillOpen(pushed)).toEqual([])
  })

  it("closes a call that finishes after the server restarted mid-call", async () => {
    const { pushed, port } = recorder()
    const restarted = presenceExtension(port)
    const handlers = restarted.hooks?.find((each) => "afterTool" in each.handlers)?.handlers as {
      afterTool: (call: unknown, result: unknown, api: unknown) => Promise<unknown>
    }
    await handlers.afterTool(
      { id: "c1", name: "bash", arguments: { command: "ls" } },
      { output: [{ type: "text", text: "a.txt" }], isError: false },
      { conversationId: "conv-1" },
    )

    expect(pushed.map((item) => [item.step.id, item.step.status])).toEqual([["c1", "done"]])
  })

  it("closes every step of a round whose calls all ran", async () => {
    const pushed = await round(['[tool slow_tool {"ms":1}]'], blocker("slow_tool", 9))

    expect(pushed.filter((item) => item.step.status === "running")).toHaveLength(1)
    expect(pushed.filter((item) => item.step.status === "failed")).toEqual([])
    expect(stillOpen(pushed)).toEqual([])
  })
})
