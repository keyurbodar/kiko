import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { classifyFailure, runLoop, SYSTEM_PROMPT_SHA } from "./loop"
import { ModelClient } from "./model"
import type { Contender, Task, ToolResult } from "./types"

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kiko-loop-"))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function clientOf(replies: readonly (unknown | "error")[]): ModelClient {
  let index = 0
  const send = async (): Promise<Response> => {
    const reply = replies[index++]
    if (reply === undefined) throw new Error("the test ran out of replies")
    if (reply === "error") return new Response("upstream failed", { status: 500 })
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } })
  }
  return new ModelClient({ key: "test", version: "0", fetch: send })
}

const usage = {
  prompt_tokens: 10,
  completion_tokens: 5,
  completion_tokens_details: { reasoning_tokens: 2 },
  cost: 0.001,
  opencode: { list_cost: 0.001, tokens: { cache_read: 4 } },
}

function saysDone(): unknown {
  return { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "DONE" } }], usage }
}

function callsTool(name: string, args: unknown, id = "call-1"): unknown {
  return {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
    usage,
  }
}

function contender(call: (name: string, args: unknown) => ToolResult | Promise<ToolResult>): Contender {
  return {
    name: "test",
    version: "1",
    tracks: ["terminal"],
    async start() {},
    tools: () => [
      { name: "shell", description: "run a command", parameters: { type: "object" } },
      { name: "look", description: "see the screen", parameters: { type: "object" } },
    ],
    call: async (name, args) => call(name, args),
    async stop() {},
  }
}

const task = (limits = { turns: 5, seconds: 60 }): Task => ({
  id: "terminal-999-test",
  track: "terminal",
  os: ["linux"],
  needs: [],
  heldOut: false,
  prompt: "do the thing",
  limits,
  async setup() {},
  async oracle() {},
  async check() {
    return { pass: true, checks: [{ name: "done", pass: true, detail: "ok" }] }
  },
})

async function run(
  replies: readonly (unknown | "error")[],
  call: (name: string, args: unknown) => ToolResult | Promise<ToolResult> = () => ({
    text: "ok",
    images: [],
    isError: false,
  }),
  options: { vision?: boolean; limits?: { turns: number; seconds: number } } = {},
) {
  const dir = await tempDir()
  const result = await runLoop({
    task: task(options.limits),
    contender: contender(call),
    model: { id: "beam-free", vision: options.vision ?? false },
    client: clientOf(replies),
    runId: "run-1",
    trialId: "trial-1",
    trajectoryDir: dir,
    condition: "foreground",
    seed: 1,
    rep: 1,
  })
  return { result, dir }
}

describe("agent loop", () => {
  it("runs a tool call and stops on DONE", async () => {
    const { result } = await run([callsTool("shell", { command: "ls" }), saysDone()])
    expect(result.outcome).toBe("done")
    expect(result.turns).toBe(2)
    expect(result.toolCalls).toBe(1)
    expect(result.toolErrors).toBe(0)
    expect(result.usage).toEqual({ prompt: 20, cached: 8, completion: 10, reasoning: 4, cost: 0.002, listCost: 0.002 })
    expect(result.trajectory.requests).toHaveLength(2)
    expect(result.trajectory.tools).toHaveLength(1)
    expect(result.trajectory.tools[0]?.args).toEqual({ command: "ls" })
    expect(result.trajectory.system_prompt_sha).toBe(SYSTEM_PROMPT_SHA)
    expect(result.trajectory.requests[1]?.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ])
  })

  it("records a model error without retrying", async () => {
    const { result } = await run(["error"])
    expect(result.outcome).toBe("model_error")
    expect(result.trajectory.requests).toHaveLength(1)
    expect(result.trajectory.requests[0]?.error).toContain("500")
  })

  it("stops at the turn limit", async () => {
    const { result } = await run([callsTool("shell", {}), callsTool("shell", {}), saysDone()], undefined, {
      limits: { turns: 2, seconds: 60 },
    })
    expect(result.outcome).toBe("turns")
    expect(result.turns).toBe(2)
    expect(result.toolCalls).toBe(2)
  })

  it("nudges a reply that is not DONE and keeps going", async () => {
    const reply = {
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "I am still working" } }],
      usage,
    }
    const { result } = await run([reply, saysDone()])
    expect(result.outcome).toBe("done")
    expect(result.turns).toBe(2)
    const second = result.trajectory.requests[1]?.messages ?? []
    expect(second[second.length - 1]).toEqual({
      role: "user",
      content: "Keep going. Reply with DONE when the task is finished.",
    })
  })

  it("reports an unknown tool as a tool error", async () => {
    const { result } = await run([callsTool("nope", {}), saysDone()])
    expect(result.outcome).toBe("done")
    expect(result.toolErrors).toBe(1)
    expect(result.trajectory.tools[0]?.text).toContain("there is no tool called nope")
  })

  it("stops when a tool throws", async () => {
    const { result } = await run([callsTool("shell", {})], () => {
      throw new Error("the tool exploded")
    })
    expect(result.outcome).toBe("tool_crash")
    expect(result.toolErrors).toBe(1)
    expect(result.trajectory.tools[0]?.is_error).toBe(true)
  })

  it("drops images for a model that cannot see them", async () => {
    const { result, dir } = await run([callsTool("look", {}), saysDone()], () => ({
      text: "a screenshot",
      images: [{ mime: "image/png", base64: "aGk=" }],
      isError: false,
    }))
    expect(result.imagesSent).toBe(0)
    expect(result.imagesDropped).toBe(1)
    expect(existsSync(join(dir, "trial-1-tool-1-1.png"))).toBe(true)
    const tool = result.trajectory.requests[1]?.messages[3]
    expect(JSON.stringify(tool)).not.toContain("aGk=")
  })

  it("sends images to a model that can see them", async () => {
    const { result } = await run(
      [callsTool("look", {}), saysDone()],
      () => ({ text: "a screenshot", images: [{ mime: "image/png", base64: "aGk=" }], isError: false }),
      { vision: true },
    )
    expect(result.imagesSent).toBe(1)
    expect(result.imagesDropped).toBe(0)
  })

  it("classifies a failure from the trajectory", async () => {
    const { result } = await run([callsTool("shell", {}), saysDone()])
    const background = { focusSteals: 0, pointerMoves: 0, keysSwallowed: 0, windowsRaised: 0 }
    expect(classifyFailure(result, { pass: true, checks: [] }, background)).toBe("")
    expect(classifyFailure(result, { pass: false, checks: [] }, { ...background, pointerMoves: 1 })).toBe("background")
    expect(classifyFailure(result, { pass: false, checks: [] }, background)).toBe("targeting")
  })

  it("counts a tool call written as text and classifies it as a model failure", async () => {
    const reply = {
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: '<tool_call>{"name": "shell", "arguments": {"command": "ls"}}</tool_call>',
          },
        },
      ],
      usage,
    }
    const { result } = await run([reply, saysDone()])
    expect(result.trajectory.text_tool_calls).toBe(1)
    expect(result.toolCalls).toBe(0)
    const background = { focusSteals: 0, pointerMoves: 0, keysSwallowed: 0, windowsRaised: 0 }
    expect(classifyFailure(result, { pass: false, checks: [] }, background)).toBe("model")
  })
})
