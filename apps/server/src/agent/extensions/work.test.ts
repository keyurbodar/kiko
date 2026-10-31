import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Agent, ConversationId, TaskId, ToolExecutionApi } from "@earendil-works/pi-durable"
import type { Work, Workers } from "@kiko/agent/workers"
import { describe, expect, it } from "vitest"
import { workExtensions, workerThinking } from "./work"

type Doc = Record<string, unknown>

const parent = { model: null, thinkingLevel: "high" } as unknown as Agent

function fakeWork(over: Partial<Work> = {}): Work {
  return {
    id: "w1",
    task: "look it up",
    conversationId: 11 as ConversationId,
    submissionId: null,
    status: "done",
    step: null,
    steps: 2,
    delivered: true,
    runId: null,
    startedAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function fakeWorkers(work: Work | null): Workers {
  return {
    get: (id: string) => (work?.id === id ? work : null),
    byTask: () => null,
    reserve: () => work,
    live: () => (work ? [work] : []),
    placed: () => {},
    follow: () => {},
    complete: async () => {},
    step: () => "talker",
    touched: () => {},
    stop: async () => null,
  } as unknown as Workers
}

function fakeApi(agentDoc: Doc, workerDoc: Doc): ToolExecutionApi {
  const tx = {
    doc: async (token: { definition: { kind: string } }) =>
      token.definition.kind === "kiko.worker-tasks" ? workerDoc : agentDoc,
    createTask: async () => 8 as TaskId,
    createConversation: async () => ({ id: 11 as ConversationId }),
  }
  const api = {
    taskId: 7 as TaskId,
    conversationId: 1 as ConversationId,
    agent: async () => parent,
    commit: async (change: (tx: object) => unknown) => change(tx),
    conversation: async () => ({ id: 11 as ConversationId }),
  }
  return api as unknown as ToolExecutionApi
}

function toolNamed(workers: Workers, name: string) {
  const tool = workExtensions(
    workers,
    () => [],
    () => null,
  )[0].tools?.find((t) => t.name === name)
  if (!tool) throw new Error(`missing tool ${name}`)
  return tool
}

describe("workerThinking", () => {
  it("runs at the parent's level when the job asks for none", () => {
    expect(workerThinking("high", undefined)).toBe("high")
  })

  it("lowers a worker for a lookup job", () => {
    expect(workerThinking("high", "minimal")).toBe("minimal")
    expect(workerThinking("medium", "off")).toBe("off")
  })

  it("never runs a worker above its parent", () => {
    expect(workerThinking("low", "xhigh")).toBe("low")
    expect(workerThinking("off", "max")).toBe("off")
  })
})

describe("work tools", () => {
  it("remembers the level a worker was started at", async () => {
    const agentDoc: Doc = {}
    const workerDoc: Doc = { children: {}, reporters: {} }
    const api = fakeApi(agentDoc, workerDoc)
    const work = fakeWork({ conversationId: null, status: "pending" })
    await toolNamed(fakeWorkers(work), "start_work").execute(
      { task: "look it up", thinking: "minimal" },
      api,
      BACKGROUND_CONTEXT,
    )
    expect(agentDoc.thinkingLevel).toBe("minimal")
    expect(workerDoc.thinking).toEqual({ w1: "minimal" })
  })

  it("revives a finished worker at the level it was started at", async () => {
    const agentDoc: Doc = {}
    const workerDoc: Doc = { children: {}, reporters: {}, thinking: { w1: "minimal" } }
    const api = fakeApi(agentDoc, workerDoc)
    await toolNamed(fakeWorkers(fakeWork()), "steer_work").execute(
      { id: "w1", text: "the answer changed" },
      api,
      BACKGROUND_CONTEXT,
    )
    expect(agentDoc.thinkingLevel).toBe("minimal")
  })

  it("revives a worker without a stored level at the parent's level", async () => {
    const agentDoc: Doc = {}
    const workerDoc: Doc = { children: {}, reporters: {} }
    const api = fakeApi(agentDoc, workerDoc)
    await toolNamed(fakeWorkers(fakeWork()), "steer_work").execute(
      { id: "w1", text: "the answer changed" },
      api,
      BACKGROUND_CONTEXT,
    )
    expect(agentDoc.thinkingLevel).toBe("high")
  })
})
