import type { FileBucket } from "../src/files/store"
import { expect, test } from "bun:test"
import { sha256Hex } from "@kiko/durable/hash"
import type { FsEntry, NewFile } from "../src/files/file-index"
import { BUILTIN_RECIPES } from "../src/recipes/catalog.gen"
import { RecipeLibrary } from "../src/user/recipe-library"
import { USER_STEPS } from "../src/user/schema"
import { sqlWith } from "./sql-shim"

const encoder = new TextEncoder()
const [slug, builtinText] = BUILTIN_RECIPES[0]!
const path = `recipes/${slug}/RECIPE.md`

/** A fake drive: file entries under recipes/, bodies by R2 key, and every write and removal. */
function drive(sql = sqlWith(USER_STEPS)) {
  let entries: FsEntry[] = []
  const bodies = new Map<string, Uint8Array>()
  const writes: NewFile[] = []
  const removed: string[][] = []
  const files = {
    put: async (key: string, body: Uint8Array) => void bodies.set(key, body),
    get: async (key: string) => (bodies.has(key) ? { arrayBuffer: async () => bodies.get(key)!.slice().buffer } : null),
    delete: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) bodies.delete(k)
    },
  }
  const library = new RecipeLibrary({
    sql,
    files: files as unknown as FileBucket,
    userId: () => "owner",
    list: (dir) => entries.filter((e) => e.path.startsWith(`${dir}/`) || e.path === dir),
    put: (input) => {
      writes.push(input)
      entries = [...entries.filter((e) => e.path !== input.path), { kind: "file", ...input } as unknown as FsEntry]
      return { drop: null, entry: entries.at(-1) ?? null }
    },
    remove: (paths, recursive) => {
      removed.push(paths)
      entries = entries.filter((e) => !paths.some((p) => e.path === p || (recursive && e.path.startsWith(`${p}/`))))
      return { ok: true }
    },
  })
  return {
    sql,
    library,
    writes,
    removed,
    entries: () => entries,
    async addFile(text: string, at = path) {
      const key = `k-${at}-${text.length}`
      const body = encoder.encode(text)
      bodies.set(key, body)
      entries = [...entries.filter((e) => e.path !== at), { kind: "file", path: at, r2Key: key, size: body.length, sha256: await sha256Hex(body) } as unknown as FsEntry]
    },
  }
}

test("built-ins are listed with no drive files, and nothing is written", async () => {
  const d = drive()
  const lib = await d.library.read()
  expect(lib.recipes.map((r) => r.slug).sort()).toEqual(BUILTIN_RECIPES.map(([s]) => s).sort())
  expect(lib.custom.size).toBe(0)
  expect(lib.broken).toEqual([])
  expect(d.writes).toHaveLength(0)
})

test("a drive file with the same slug replaces the built-in and is marked custom", async () => {
  const d = drive()
  await d.addFile(builtinText.replace(/^title: .*$/m, "title: My own version"))
  const lib = await d.library.read()
  expect(lib.custom.has(slug)).toBe(true)
  expect(lib.recipes.find((r) => r.slug === slug)?.title).toBe("My own version")
  expect(lib.recipes.filter((r) => r.slug === slug)).toHaveLength(1)
})

test("a broken drive file is reported, and the built-in of its slug stays listed", async () => {
  const d = drive()
  await d.addFile("---\ntitle: Broken\n---\nno description here")
  const lib = await d.library.read()
  expect(lib.broken).toHaveLength(1)
  expect(lib.broken[0]).toContain(slug)
  expect(lib.custom.has(slug)).toBe(false)
  expect(lib.recipes.some((r) => r.slug === slug)).toBe(true)
})

test("edit copies a built-in once; a second edit writes nothing and returns the same path", async () => {
  const d = drive()
  expect(await d.library.edit(slug)).toBe(path)
  expect(d.writes).toHaveLength(1)
  expect(d.writes[0]).toMatchObject({ path, author: { kind: "human" } })
  expect(await d.library.edit(slug)).toBe(path)
  expect(d.writes).toHaveLength(1)
  expect((await d.library.read()).custom.has(slug)).toBe(true)
})

test("edit returns null for a slug with no built-in", async () => {
  const d = drive()
  expect(await d.library.edit("no-such-recipe")).toBeNull()
  expect(d.writes).toHaveLength(0)
})

test("cleanup removes an unedited old copy, keeps an edited one, and clears the setting once", async () => {
  const d = drive()
  await d.addFile(builtinText)
  d.sql.exec("INSERT INTO settings (key, value) VALUES ('recipes_seeded', ?)", JSON.stringify({ [slug]: "an-older-hash" }))
  await d.library.retireSeeded()
  expect(d.entries().some((e) => e.path === path)).toBe(false)
  expect(d.removed).toEqual([[`recipes/${slug}`], ["recipes"]])
  expect(d.sql.exec("SELECT value FROM settings WHERE key = 'recipes_seeded'").toArray()).toHaveLength(0)

  const kept = drive()
  await kept.addFile("title: an edit the owner made")
  kept.sql.exec("INSERT INTO settings (key, value) VALUES ('recipes_seeded', ?)", JSON.stringify({ [slug]: "an-older-hash" }))
  await kept.library.retireSeeded()
  expect(kept.entries().some((e) => e.path === path)).toBe(true)
  expect(kept.removed).toEqual([])

  await d.library.retireSeeded()
  expect(d.removed).toHaveLength(2)
})
