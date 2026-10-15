import { expect, test } from "bun:test"
import { sha256Hex } from "@kiko/durable/hash"
import type { FsEntry, NewFile } from "../src/files/file-index"
import { BUILTIN_RECIPES } from "../src/recipes/catalog.gen"
import { RecipeLibrary } from "../src/user/recipe-library"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

async function fixture(mode: "untouched" | "edited" | "deleted" | "old-list") {
  const sql = sqlWith(USER_STEPS)
  const [slug, content] = BUILTIN_RECIPES[0]!
  const path = `recipes/${slug}/RECIPE.md`
  const sha = await sha256Hex(new TextEncoder().encode(content))
  const oldSha = mode === "old-list" ? sha : "previous-shipped-hash"
  const shipped = Object.fromEntries(BUILTIN_RECIPES.map(([s]) => [s, s === slug ? oldSha : ""]))
  sql.exec("INSERT INTO settings (key, value) VALUES ('recipes_seeded', ?)", JSON.stringify(mode === "old-list" ? BUILTIN_RECIPES.map(([s]) => s) : shipped))
  let current = mode === "deleted" ? undefined : { kind: "file", path, sha256: mode === "edited" ? "my-edit" : oldSha } as FsEntry
  const writes: NewFile[] = []
  const library = () => new RecipeLibrary({
    sql,
    userId: () => "owner",
    files: { put: async () => {}, delete: async () => {} } as unknown as R2Bucket,
    list: () => current ? [current] : [],
    put: (input) => { writes.push(input); current = { ...input, kind: "file" } as unknown as FsEntry; return { entry: current, drop: null } },
  })
  return { sql, slug, sha, writes, library }
}

test("a built-in update replaces only the unchanged shipped version", async () => {
  const f = await fixture("untouched")
  await f.library().seed()
  expect(f.writes).toHaveLength(1)
  expect(f.writes[0]?.sha256).toBe(f.sha)
  await f.library().seed()
  expect(f.writes).toHaveLength(1)
})

test("built-in updates preserve edited and deleted files", async () => {
  for (const mode of ["edited", "deleted"] as const) {
    const f = await fixture(mode)
    await f.library().seed()
    expect(f.writes).toHaveLength(0)
  }
})

test("the older names-only seed marker upgrades untouched files to hashes", async () => {
  const f = await fixture("old-list")
  await f.library().seed()
  const value = f.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = 'recipes_seeded'").one().value
  expect(JSON.parse(value)[f.slug]).toBe(f.sha)
  expect(f.writes).toHaveLength(0)
})
