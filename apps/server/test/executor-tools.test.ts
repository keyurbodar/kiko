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
    const run = (t: typeof execute, args: unknown) => (t as unknown as { execute: (a: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }).execute(args)
    expect((await run(execute, { code: "1+1" })).content[0]!.text).toBe("ok")
    const failed = await run(list, {})
    expect(failed.isError).toBe(true)
    expect(failed.content[0]!.text).toContain("offline")
    expect(calls).toEqual([["execute", { code: "1+1" }], ["list-artifacts", {}]])
  })

  test("a name a model cannot hold is cleaned", () => {
    expect(toolName("gmail.send email")).toBe("executor_gmail_send_email")
  })
})
