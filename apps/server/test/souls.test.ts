import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { YUKI_SOUL, Souls } from "../src/user/souls"

function storage(agents: [slug: string, name: string, prompt: string][] = []): SqlStorage {
  const db = new Database(":memory:")
  db.exec("CREATE TABLE agents (slug TEXT PRIMARY KEY, name TEXT, prompt TEXT)")
  for (const row of agents) db.query("INSERT INTO agents VALUES (?, ?, ?)").run(...row)
  const exec = (query: string, ...args: unknown[]) => {
    const rows = db.query(query).all(...(args as never[]))
    return { toArray: () => rows }
  }
  return { exec } as unknown as SqlStorage
}

test("a new chief gets Yuki's soul", async () => {
  const soul = await new Souls(storage()).get("yuki")
  expect(soul.body).toBe(YUKI_SOUL)
  expect(soul.body).toStartWith("# yuki\n\ni'm yuki, their chief:")
})

test("a new agent's first soul is the agent the human described", async () => {
  const soul = await new Souls(storage([["ada", "Ada", "reads code and says what is wrong"]])).get("ada")
  expect(soul.body).toBe("# Ada\n\nreads code and says what is wrong\n\n## what i've learned about working with them\n")
})

test("a stored soul is returned as it is, and seeding never overwrites it", async () => {
  const souls = new Souls(storage())
  await souls.seed("yuki", "# yuki\n\nmy own words\n")
  await souls.seed("yuki", YUKI_SOUL)
  expect((await souls.get("yuki")).body).toBe("# yuki\n\nmy own words\n")
})
