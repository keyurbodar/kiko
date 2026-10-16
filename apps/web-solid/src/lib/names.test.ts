import { expect, test } from "bun:test"
import { agentDisplayName } from "./names"

const agents = [{ slug: "ebert", name: "Ebert" }]

test("an agent shows its name, Kiko shows as Kiko, and an unknown handle shows as itself", () => {
  expect(agentDisplayName("ebert", agents)).toBe("Ebert")
  expect(agentDisplayName("kiko", agents)).toBe("Kiko")
  expect(agentDisplayName("zed", agents)).toBe("zed")
})
