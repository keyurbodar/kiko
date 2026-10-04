import { describe, expect, test } from "bun:test"
import { describeCall } from "../../../../server/src/agent/extensions/presence"
import { motionOf } from "./action"

describe("how a working agent's dots move", () => {
  test("every report the server makes maps to the motion it describes", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["read", { path: "notes.md" }, "scan"],
      ["ls", {}, "scan"],
      ["web_fetch", {}, "scan"],
      ["write", { path: "/a.html" }, "hop"],
      ["edit", { path: "a.html" }, "hop"],
      ["propose_agent", {}, "hop"],
      ["spawn_subagent", {}, "orbit"],
      ["create_reminder", {}, "orbit"],
      ["executor_execute", {}, "orbit"],
      ["executor_gmail_send", {}, "orbit"],
      ["some_new_tool", {}, "orbit"],
    ]
    for (const [name, args, motion] of cases) expect([name, motionOf(describeCall(name, args) ?? undefined)]).toEqual([name, motion])
  })

  test("no report, or the reply itself, is kat's wave", () => {
    expect(motionOf(undefined)).toBe("wave")
    expect(motionOf("writing a reply")).toBe("wave")
  })
})
