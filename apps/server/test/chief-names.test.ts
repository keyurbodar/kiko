import { expect, test } from "bun:test"
import type { Agent, AgentSlug } from "@kiko/protocol"
import { checkProposal } from "../src/room/chief"

const pollen: Agent = { id: "a1", name: "Pollen", slug: "pollen" as AgentSlug, prompt: "", model: "" }
const spec = (name: string, handle: string) => ({ name, handle, description: "d", soul: "# s\nbe kind" })

test("a proposal for a name an agent already has is refused, ignoring case and spaces", () => {
  for (const name of ["pollen", " POLLEN ", "Kiko"]) {
    const out = checkProposal({ kind: "agent", agent: spec(name, "fresh") }, [pollen])
    expect(out).toMatchObject({ error: expect.stringContaining("already exists") })
  }
  expect(checkProposal({ kind: "agent", agent: spec("Bee", "bee") }, [pollen])).toMatchObject({ kind: "agent" })
})
