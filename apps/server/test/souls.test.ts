import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { KIKO_SOUL, Souls } from "../src/user/souls"

// The chief's soul from before the rename, with a lesson it learned since.
const OLD = "# kiko\n\ni'm kiko, their chief: the one they text first about anything.\n\n## what i've learned about working with them\n- they like bullet points\n"

function storage(): SqlStorage {
  const db = new Database(":memory:")
  db.exec("CREATE TABLE agents (slug TEXT PRIMARY KEY, name TEXT, prompt TEXT)")
  const exec = (query: string, ...args: unknown[]) => {
    const rows = db.query(query).all(...(args as never[]))
    return { toArray: () => rows }
  }
  return { exec } as unknown as SqlStorage
}

test("a new chief gets Yuki's soul", async () => {
  const soul = await new Souls(storage()).get("kiko")
  expect(soul.body).toBe(KIKO_SOUL)
  expect(soul.body).toStartWith("# yuki\n\ni'm yuki, their chief:")
})

test("the chief's old soul is renamed once and keeps what it learned", async () => {
  const sql = storage()
  const souls = new Souls(sql)
  await souls.seed("kiko", OLD)
  const renamed = await souls.get("kiko")
  expect(renamed.body).toBe(OLD.replace("# kiko\n\ni'm kiko,", "# yuki\n\ni'm yuki,"))
  expect(renamed.body).toContain("- they like bullet points")
  expect(await souls.get("kiko")).toEqual(renamed)
})

test("a chief's soul the human rewrote is left alone", async () => {
  const souls = new Souls(storage())
  await souls.seed("kiko", "# kiko\n\nmy own words about kiko\n")
  expect((await souls.get("kiko")).body).toBe("# kiko\n\nmy own words about kiko\n")
})

test("another agent's soul that names kiko is left alone", async () => {
  const souls = new Souls(storage())
  await souls.seed("ada", OLD)
  expect((await souls.get("ada")).body).toBe(OLD)
})
