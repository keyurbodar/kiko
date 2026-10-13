import { expect, test } from "bun:test"
import { KIKO_SOUL, Souls } from "../src/user/souls"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

function storage(agents: [slug: string, name: string, prompt: string][] = []): SqlStorage {
  const sql = sqlWith(USER_STEPS)
  for (const [slug, name, prompt] of agents) sql.exec("INSERT INTO agents (id, name, slug, prompt, created_at) VALUES (?, ?, ?, ?, 0)", slug, name, slug, prompt)
  return sql
}

test("a new chief gets Kiko's soul", async () => {
  const soul = await new Souls(storage()).get("yuki")
  expect(soul.body).toBe(KIKO_SOUL)
  expect(soul.body).toStartWith("# kiko\n\ni'm kiko, their chief:")
})

test("a new agent's first soul is the agent the human described", async () => {
  const soul = await new Souls(storage([["ada", "Ada", "reads code and says what is wrong"]])).get("ada")
  expect(soul.body).toBe("# Ada\n\nreads code and says what is wrong\n\n## what i've learned about working with them\n")
})

test("a stored soul is returned as it is, and seeding never overwrites it", async () => {
  const souls = new Souls(storage())
  await souls.seed("yuki", "# kiko\n\nmy own words\n")
  await souls.seed("yuki", KIKO_SOUL)
  expect((await souls.get("yuki")).body).toBe("# kiko\n\nmy own words\n")
})
