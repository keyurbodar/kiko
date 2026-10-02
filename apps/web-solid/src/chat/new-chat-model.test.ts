import { describe, expect, test } from "bun:test"
import type { Agent, AgentSlug } from "@kiko/protocol"
import { agentList, agentProblem, BUILTIN_AGENT, chatTitle, cleanHandle, filterAgents, slugFromName } from "./new-chat-model"

const ada: Agent = { id: "1", name: "Ada Lovelace", slug: "ada" as AgentSlug, prompt: "", model: "" }

describe("new chat model", () => {
  test("the built-in agent leads the list and is never doubled", () => {
    expect(agentList([ada]).map((a) => a.id)).toEqual(["kiko", "1"])
    expect(agentList([BUILTIN_AGENT, ada]).map((a) => a.id)).toEqual(["kiko", "1"])
  })

  test("search matches name or handle, and ignores an @", () => {
    const all = agentList([ada])
    expect(filterAgents(all, "").length).toBe(2)
    expect(filterAgents(all, "@ad").map((a) => a.id)).toEqual(["1"])
    expect(filterAgents(all, "love").map((a) => a.id)).toEqual(["1"])
    expect(filterAgents(all, "ada ko")).toEqual([])
  })

  test("a handle defaults from the name", () => {
    expect(slugFromName("Ada Lovelace!")).toBe("ada-lovelace")
    expect(slugFromName("  --x--  ")).toBe("x")
    expect(slugFromName("a".repeat(40))).toHaveLength(32)
    expect(cleanHandle("@Ada Love")).toBe("adalove")
  })

  test("a group name wins only for a group", () => {
    const kiko = BUILTIN_AGENT
    expect(chatTitle([ada], "ignored")).toBe("ada lovelace")
    expect(chatTitle([ada, kiko], "Plans")).toBe("plans")
    expect(chatTitle([ada, kiko], "  ")).toBe("ada lovelace, kiko")
  })

  test("the form refuses a missing name, a bad handle, and a taken handle", () => {
    const ok = { name: "bo", handle: "bo", prompt: "", model: "" }
    expect(agentProblem(ok, [ada])).toBeNull()
    expect(agentProblem({ ...ok, name: " " }, [ada])).toBe("give it a name")
    expect(agentProblem({ ...ok, handle: "" }, [ada])).not.toBeNull()
    expect(agentProblem({ ...ok, handle: "ada" }, [ada])).toBe("that handle is taken")
  })
})
