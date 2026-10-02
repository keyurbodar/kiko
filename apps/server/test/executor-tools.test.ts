import { describe, expect, test } from "bun:test"
import { effectOf } from "../src/agent/effects"
import { executorExtension, toolName } from "../src/integrations/executor/tools"

describe("executor tools (P7-04)", () => {
  const listed = [
    { name: "execute", description: "run code against your apps", inputSchema: { type: "object", properties: { code: { type: "string" } } } },
    { name: "list-artifacts", description: "list artifacts", inputSchema: { type: "object", properties: {} }, readOnly: true },
  ]

  test("every listed tool is registered as executor_<name>, external unless read-only, results untrusted", () => {
    const ext = executorExtension(listed, async () => ({ content: [] }))
    const tools = ext.tools ?? []
    expect(tools.map((t) => t.name)).toEqual(["executor_execute", "executor_list-artifacts"])
    expect(effectOf(tools[0]!)).toEqual({ effect: "external", outside: "executor" })
    expect(effectOf(tools[1]!)).toEqual({ effect: "read", outside: "executor" })
  })

  test("a call goes to executor by its own name, and a failure comes back as a tool error", async () => {
    const calls: [string, unknown][] = []
    const ext = executorExtension(listed, async (name, args) => {
      calls.push([name, args])
      if (name === "list-artifacts") throw new Error("offline")
      return { content: [{ type: "text", text: "ok" }] }
    })
    const [execute, list] = ext.tools ?? []
    const run = (t: typeof execute, args: unknown) => (t as unknown as { execute: (a: unknown, api: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }).execute(args, { conversationId: "c", callId: "1" })
    expect((await run(execute, { code: "1+1" })).content[0]!.text).toBe("ok")
    const failed = await run(list, {})
    expect(failed.isError).toBe(true)
    expect(failed.content[0]!.text).toContain("offline")
    expect(calls).toEqual([["execute", { code: "1+1" }], ["list-artifacts", {}]])
  })

  test("a name a model cannot hold is cleaned", () => {
    expect(toolName("gmail.send email")).toBe("executor_gmail_send_email")
  })

  test("P7-05: a pause posts a card at once, and resume runs only against the human's accepted card", async () => {
    const tools = [
      { name: "execute", inputSchema: { type: "object" } },
      { name: "resume", inputSchema: { type: "object", properties: { executionId: { type: "string" } } } },
    ]
    const cards = new Map<string, "pending" | "accepted">()
    const gate = async (_key: string, tool: string, args: Record<string, unknown>) => {
      const k = `${tool}:${args.executionId}`
      if (cards.get(k) === "accepted") return "approval-1"
      cards.set(k, "pending")
      return { refused: "waiting for the human's approval." }
    }
    const executed: string[] = []
    const ext = executorExtension(tools, async (name) => {
      executed.push(name)
      return { content: [{ type: "text", text: name === "execute" ? 'paused: requires human approval. {"executionId": "exec_42abc"}' : "sent" }] }
    }, gate)
    const [execute, resume] = ext.tools ?? []
    const run = (t: typeof execute, args: unknown) => (t as unknown as { execute: (a: unknown, api: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }).execute(args, { conversationId: "c", callId: "2" })

    const first = await run(execute, { code: "send the email" })
    expect(first.content[0]!.text).toContain("paused for the human's approval")
    expect(cards.get("executor_resume:exec_42abc")).toBe("pending")

    // The model tries to resume on its own: refused, and executor's resume is never called.
    const selfApproved = await run(resume, { executionId: "exec_42abc" })
    expect(selfApproved.isError).toBe(true)
    expect(selfApproved.content[0]!.text).toContain("cannot approve it yourself")
    expect(executed).toEqual(["execute"])

    // The human accepts in the chat; now resume runs, once.
    cards.set("executor_resume:exec_42abc", "accepted")
    expect((await run(resume, { executionId: "exec_42abc" })).content[0]!.text).toBe("sent")
    expect(executed).toEqual(["execute", "resume"])
  })
})
