import { describe, expect, test } from "bun:test"
import { effectOf } from "@kiko/agent/effects"
import type { ApprovalGate } from "../src/integrations/executor/approval"
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

  test("resume answers only to its pause card, so the trust gate does not post a second one", () => {
    const ext = executorExtension([{ name: "resume", inputSchema: { type: "object" } }], async () => ({ content: [] }))
    expect(effectOf((ext.tools ?? [])[0]!)).toEqual({ effect: "write", outside: "executor" })
  })

  test("a name a model cannot hold is cleaned", () => {
    expect(toolName("gmail.send email")).toBe("executor_gmail_send_email")
  })

  const pause = (requestId: string, status = "approval-required") =>
    JSON.stringify({ status, requestId, invocation: {}, elicitation: { mode: "form", message: "Approve gmail.send?", requestedSchema: { type: "object", properties: {} } }, expiresAt: Date.now() + 900_000 })
  const v2 = [
    { name: "execute", inputSchema: { type: "object" } },
    { name: "resume", inputSchema: { type: "object", properties: { requestId: { type: "string" }, response: { type: "object" } } } },
  ]
  type Run = (t: unknown, args: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }>
  const runner = (call: string): Run => (t, args) => (t as { execute: (a: unknown, api: unknown) => Promise<never> }).execute(args, { conversationId: "c", callId: call })
  /** A room whose pause cards the test decides, keyed as the room keys them: by tool and request id. */
  const room = () => {
    const cards = new Map<string, { state: "pending" | "accepted"; summary?: string; ttlMs?: number }>()
    const gate: ApprovalGate = async (req) => {
      const k = `executor_resume:${req.requestId}`
      if (req.kind === "resume") return cards.get(k)?.state === "accepted" ? "approval-1" : { refused: "waiting for the human's approval." }
      cards.set(k, { state: "pending", summary: req.summary, ttlMs: req.ttlMs })
      return { refused: "waiting for the human's approval." }
    }
    return { cards, gate }
  }

  test("P7-05: a pause posts a card at once, and resume runs only against the human's accepted card, with kiko's answer", async () => {
    const { cards, gate } = room()
    const sent: [string, Record<string, unknown>][] = []
    const ext = executorExtension(v2, async (name, args) => {
      sent.push([name, structuredClone(args)])
      return { content: [{ type: "text", text: name === "execute" ? pause("apr_42abc") : JSON.stringify({ status: "completed", execution: { ok: true } }) }] }
    }, gate)
    const [execute, resume] = ext.tools ?? []
    const run = runner("2")

    const first = await run(execute, { code: "send the email" })
    expect(first.content[0]!.text).toContain("paused for the human")
    const card = cards.get("executor_resume:apr_42abc")!
    expect(card.state).toBe("pending")
    expect(card.summary).toBe("Approve gmail.send?")
    expect(card.ttlMs).toBeGreaterThan(14 * 60_000)

    // The model tries to resume on its own: refused, and executor's resume is never called.
    const selfApproved = await run(resume, { requestId: "apr_42abc", response: { action: "accept" } })
    expect(selfApproved.isError).toBe(true)
    expect(selfApproved.content[0]!.text).toContain("cannot approve it yourself")
    expect(sent.map(([n]) => n)).toEqual(["execute"])

    // The human accepts. Resume runs once, and fields the model slips into a consent are dropped.
    cards.set("executor_resume:apr_42abc", { state: "accepted" })
    await run(resume, { requestId: "apr_42abc", response: { action: "accept", content: { to: "someone-else@example.com" } } })
    expect(sent[1]).toEqual(["resume", { requestId: "apr_42abc", response: { action: "accept", content: {} } }])
  })

  test("a form question passes the human's fields, and a pause after resume posts a new card", async () => {
    const { cards, gate } = room()
    const sent: Record<string, unknown>[] = []
    const ext = executorExtension(v2, async (name, args) => {
      sent.push(structuredClone(args))
      return { content: [{ type: "text", text: name === "execute" ? pause("elc_q1", "input-required") : pause("apr_next") }] }
    }, gate)
    const [execute, resume] = ext.tools ?? []
    const run = runner("3")
    expect((await run(execute, { code: "book it" })).content[0]!.text).toContain("pass their answer as response.content")
    cards.set("executor_resume:elc_q1", { state: "accepted" })
    const next = await run(resume, { requestId: "elc_q1", response: { action: "accept", content: { seat: "12a" } } })
    expect(sent[1]).toEqual({ requestId: "elc_q1", response: { action: "accept", content: { seat: "12a" } } })
    expect(next.content[0]!.text).toContain("requestId apr_next")
    expect(cards.get("executor_resume:apr_next")?.state).toBe("pending")
  })

  test("a result that is not a pause passes through untouched", async () => {
    const { cards, gate } = room()
    const ext = executorExtension(v2, async () => ({ content: [{ type: "text", text: "paused for approval, executionId: exec_1" }] }), gate)
    const out = await runner("4")((ext.tools ?? [])[0], { code: "x" })
    expect(out.content[0]!.text).toBe("paused for approval, executionId: exec_1")
    expect(cards.size).toBe(0)
  })
})
