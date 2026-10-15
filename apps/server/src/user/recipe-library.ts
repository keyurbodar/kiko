import { sha256Hex } from "@kiko/durable/hash"
import type { FsEntry, FsFail, NewFile } from "../files/file-index"
import { deleteFiles, fileKey, HOME } from "../files/upload"
import { getSetting, setSetting } from "../lib/settings"
import { BUILTIN_RECIPES } from "../recipes/catalog.gen"
import { parseRecipe, type Recipe } from "../recipes/recipe"

/** The owner's recipes are files: /home/recipes/<slug>/RECIPE.md. The human and agents read, edit, and delete them there. */
const RECIPES_DIR = "recipes"
const SEEDED = "recipes_seeded"
const FILE = /^recipes\/([^/]+)\/RECIPE\.md$/
const MAX_BYTES = 64 * 1024

type Deps = {
  sql: SqlStorage
  files: R2Bucket
  userId: () => string
  list: (dir: string, recursive: boolean) => FsEntry[] | FsFail
  put: (input: NewFile) => { entry: FsEntry | null; drop: string | null }
}

type Library = { recipes: Recipe[]; broken: string[]; sha: Map<string, string> }

export class RecipeLibrary {
  private readonly parsed = new Map<string, Recipe | string>()
  private seeding: Promise<void> | undefined
  private seeded = false

  constructor(private readonly d: Deps) {}

  /**
   * Puts each built-in recipe in the drive. A new one is copied once, and one the owner deleted stays deleted. A built-in we
   * improved replaces the owner's copy only while that copy is still exactly the version we shipped before.
   */
  seed(): Promise<void> {
    if (this.seeded) return Promise.resolve()
    this.seeding ??= this.copyBuiltins()
      .then(() => {
        this.seeded = true
      })
      .finally(() => {
        this.seeding = undefined
      })
    return this.seeding
  }

  private async copyBuiltins(): Promise<void> {
    const stored = JSON.parse(getSetting(this.d.sql, SEEDED) ?? "{}") as string[] | Record<string, string>
    // An older build kept only the names, so it cannot say whether a copy was edited. Those never update.
    const shipped: Record<string, string> = Array.isArray(stored) ? Object.fromEntries(stored.map((slug) => [slug, ""])) : stored
    let changed = Array.isArray(stored)
    const here = this.d.list(RECIPES_DIR, true)
    for (const [slug, content] of BUILTIN_RECIPES) {
      const body = new TextEncoder().encode(content)
      const sha = await sha256Hex(body)
      const before = shipped[slug]
      if (before === sha) continue
      const path = `${RECIPES_DIR}/${slug}/RECIPE.md`
      const current = Array.isArray(here) ? here.find((e): e is FsEntry & { kind: "file" } => e.kind === "file" && e.path === path) : undefined
      if (before === "") {
        if (current?.sha256 === sha) { shipped[slug] = sha; changed = true }
        continue
      }
      shipped[slug] = sha
      changed = true
      if (before === undefined ? !!current : current?.sha256 !== before) continue
      const id = crypto.randomUUID()
      const r2Key = fileKey(this.d.userId(), HOME, id)
      await this.d.files.put(r2Key, body, { httpMetadata: { contentType: "text/markdown" } })
      const put = this.d.put({ id, path, r2Key, size: body.length, type: "text/markdown", sha256: sha, author: { kind: "agent", slug: "yuki" as never }, expectSha256: current?.sha256 ?? "none" })
      if (put.drop) await deleteFiles(this.d.files, put.drop)
    }
    if (changed) setSetting(this.d.sql, SEEDED, JSON.stringify(shipped))
  }

  /** Every recipe file that parses, and the reason each one that does not. Parsed once per file version. */
  async read(): Promise<Library> {
    await this.seed()
    const listed = this.d.list(RECIPES_DIR, true)
    const out: Library = { recipes: [], broken: [], sha: new Map() }
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
      else {
        out.recipes.push(r)
        out.sha.set(slug, f.sha256)
      }
    }
    out.recipes.sort((a, b) => a.title.localeCompare(b.title))
    return out
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
