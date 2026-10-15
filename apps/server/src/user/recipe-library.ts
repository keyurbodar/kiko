import { sha256Hex } from "@kiko/durable/hash"
import type { RecipeCard } from "@kiko/protocol"
import type { FsEntry, FsFail, NewFile } from "../files/file-index"
import { fileKey, HOME } from "../files/upload"
import { getSetting, setSetting } from "../lib/settings"
import { recipeCard } from "../recipes/card"
import { BUILTIN_RECIPES } from "../recipes/catalog.gen"
import { parseRecipe, type Recipe } from "../recipes/recipe"

/** The owner's recipes are files: /home/recipes/<slug>/RECIPE.md. The human and agents read, edit, and delete them there. */
export const RECIPES_DIR = "recipes"
const SEEDED = "recipes_seeded"
const FILE = /^recipes\/([^/]+)\/RECIPE\.md$/
const MAX_BYTES = 64 * 1024

type Deps = {
  sql: SqlStorage
  files: R2Bucket
  userId: () => string
  list: (dir: string, recursive: boolean) => FsEntry[] | FsFail
  put: (input: NewFile) => { entry: FsEntry | null }
}

export type Library = { recipes: Recipe[]; broken: string[] }

export class RecipeLibrary {
  private readonly parsed = new Map<string, Recipe | string>()
  private seeding: Promise<void> | undefined

  constructor(private readonly d: Deps) {}

  /** Copies each built-in recipe into the drive once. One the owner deleted stays deleted; a new built-in arrives on the next visit. */
  seed(): Promise<void> {
    this.seeding ??= this.copyBuiltins().finally(() => {
      this.seeding = undefined
    })
    return this.seeding
  }

  private async copyBuiltins(): Promise<void> {
    const seeded = new Set<string>(JSON.parse(getSetting(this.d.sql, SEEDED) ?? "[]") as string[])
    const fresh = BUILTIN_RECIPES.filter(([slug]) => !seeded.has(slug))
    if (!fresh.length) return
    for (const [slug, content] of fresh) {
      const body = new TextEncoder().encode(content)
      const id = crypto.randomUUID()
      const r2Key = fileKey(this.d.userId(), HOME, id)
      await this.d.files.put(r2Key, body, { httpMetadata: { contentType: "text/markdown" } })
      this.d.put({ id, path: `${RECIPES_DIR}/${slug}/RECIPE.md`, r2Key, size: body.length, type: "text/markdown", sha256: await sha256Hex(body), author: { kind: "agent", slug: "yuki" as never }, expectSha256: "none" })
      seeded.add(slug)
    }
    setSetting(this.d.sql, SEEDED, JSON.stringify([...seeded]))
  }

  /** Every recipe file that parses, and the reason each one that does not. Parsed once per file version. */
  async read(): Promise<Library> {
    await this.seed()
    const listed = this.d.list(RECIPES_DIR, true)
    const out: Library = { recipes: [], broken: [] }
    if (!Array.isArray(listed)) return out
    for (const f of listed) {
      const slug = f.kind === "file" ? FILE.exec(f.path)?.[1] : undefined
      if (f.kind !== "file" || !slug) continue
      let r = this.parsed.get(`${f.path}:${f.sha256}`)
      if (r === undefined) {
        r = await this.parse(f, slug)
        this.parsed.set(`${f.path}:${f.sha256}`, r)
      }
      if (typeof r === "string") out.broken.push(r)
      else out.recipes.push(r)
    }
    out.recipes.sort((a, b) => a.title.localeCompare(b.title))
    return out
  }

  async get(slug: string): Promise<Recipe | undefined> {
    return (await this.read()).recipes.find((r) => r.slug === slug)
  }

  async cards(): Promise<RecipeCard[]> {
    return (await this.read()).recipes.map(recipeCard)
  }

  private async parse(f: FsEntry & { kind: "file" }, slug: string): Promise<Recipe | string> {
    if (f.size > MAX_BYTES) return `recipe ${slug}: the file is larger than ${MAX_BYTES / 1024} KB`
    const object = await this.d.files.get(f.r2Key)
    if (!object) return `recipe ${slug}: the file is missing`
    try {
      return parseRecipe(await object.text(), slug)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
}
