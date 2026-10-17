import { describe, expect, test } from "bun:test"
import { describeCall } from "../../../../server/src/agent/extensions/presence"
import { captionOf, motionOf } from "./action"

describe("how a working agent's dots move", () => {
  test("every report the server makes maps to the motion it describes", () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["read", { path: "notes.md" }, "scan"],
      ["ls", {}, "scan"],
      ["web_fetch", {}, "scan"],
      ["write", { path: "/a.html" }, "hop"],
      ["edit", { path: "a.html" }, "hop"],
      ["create_agent", {}, "hop"],
      ["start_work", {}, "orbit"],
      ["create_routine", {}, "orbit"],
      ["composio_remote_workbench", {}, "orbit"],
      ["composio_multi_execute_tool", {}, "orbit"],
      ["some_new_tool", {}, "orbit"],
    ]
    for (const [name, args, motion] of cases) expect([name, motionOf(describeCall(name, args)?.doing)]).toEqual([name, motion])
  })

  test("no report, or the reply itself, is kat's wave", () => {
    expect(motionOf(undefined)).toBe("wave")
    expect(motionOf("writing a reply")).toBe("wave")
  })
})

describe("captionOf", () => {
  test("the line names the activity, and a run that is only writing says it is thinking", () => {
    expect(captionOf(undefined, 5_000)).toBe("Thinking")
    expect(captionOf("writing a reply", 5_000)).toBe("Thinking")
    expect(captionOf("editing /hello.html", 5_000)).toBe("Editing /hello.html")
    expect(captionOf("reading a web page", 5_000)).toBe("Reading a web page")
  })

  test("the clock is the activity's own, and shows only after 30 seconds", () => {
    expect(captionOf("editing /hello.html", 29_000)).toBe("Editing /hello.html")
    expect(captionOf("editing /hello.html", 30_000)).toBe("Editing /hello.html for 30s.")
    expect(captionOf("editing /hello.html", 72_000)).toBe("Editing /hello.html for 1m 12s.")
    expect(captionOf(undefined, 45_000)).toBe("Thinking for 45s.")
  })

  test("a long activity says nothing about a cap: there is none", () => {
    expect(captionOf("reading a web page", 605_000)).toBe("Reading a web page for 10m 5s.")
  })
})
