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
  test("a quick run shows only its act, and writing shows nothing", () => {
    expect(captionOf(undefined, 5_000)).toBeUndefined()
    expect(captionOf("writing a reply", 5_000)).toBeUndefined()
    expect(captionOf("editing /hello.html", 5_000)).toBe("Editing /hello.html")
  })
  test("a run past 30 seconds says for how long", () => {
    expect(captionOf(undefined, 45_000)).toBe("Working for 45s.")
    expect(captionOf("editing /hello.html", 72_000)).toBe("Editing /hello.html for 1m 12s.")
  })
  test("a run past 2 minutes says a slow model is why", () => {
    expect(captionOf(undefined, 125_000)).toBe("Working for 2m 5s. Slow models can take a few minutes. Kiko stops a request at 5 minutes.")
  })
})
