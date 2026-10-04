import { describe, expect, test } from "bun:test"
import { describeCall } from "../../../../server/src/agent/extensions/presence"
import { actOf } from "./action"

describe("what a working agent is shown doing", () => {
  test("every report the server makes maps to the act it describes", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["read", { path: "notes.md" }, "read"],
      ["ls", {}, "read"],
      ["write", { path: "/a.html" }, "build"],
      ["edit", { path: "a.html" }, "build"],
      ["web_fetch", {}, "browse"],
      ["spawn_subagent", {}, "helper"],
      ["create_reminder", {}, "remind"],
      ["propose_agent", {}, "hatch"],
      ["executor_execute", {}, "tool"],
      ["executor_gmail_send", {}, "tool"],
      ["some_new_tool", {}, "tool"],
    ]
    for (const [name, args, act] of cases) expect([name, actOf(describeCall(name, args) ?? undefined)]).toEqual([name, act])
  })

  test("no report, or the reply itself, is writing", () => {
    expect(actOf(undefined)).toBe("write")
    expect(actOf("writing a reply")).toBe("write")
  })
})
