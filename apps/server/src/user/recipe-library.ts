import type { FileBucket } from "../files/store"
import { sha256Hex } from "@kiko/durable/hash"
import type { FsEntry, FsFail, NewFile } from "../files/file-index"
import { deleteFiles, fileKey, HOME } from "../files/upload"
import { deleteSetting, getSetting } from "../lib/settings"
import { BUILTIN_RECIPES } from "../recipes/catalog.gen"
import { parseRecipe, type Recipe } from "../recipes/recipe"

const RECIPES_DIR = "recipes"
const SEEDED = "recipes_seeded"
const FILE = /^recipes\/([^/]+)\/RECIPE\.md$/
const MAX_BYTES = 64 * 1024
const encoder = new TextEncoder()

type Deps = {
  sql: SqlStorage
  files: FileBucket
  userId: () => string
  list: (dir: string, recursive: boolean) => FsEntry[] | FsFail
  put: (input: NewFile) => { drop: string | null; entry: FsEntry | null; conflict?: boolean }
  remove: (paths: string[], recursive: boolean) => { ok: boolean }
}

type Library = { recipes: Recipe[]; custom: ReadonlySet<string>; broken: string[] }

const builtinParsed = new Map<string, { text: string; recipe: Recipe }>()
for (const [slug, text] of BUILTIN_RECIPES) builtinParsed.set(slug, { text, recipe: parseRecipe(text, slug) })

export class RecipeLibrary {
  private readonly parsed = new Map<string, Recipe | string>()

  constructor(private readonly d: Deps) {}

  async read(): Promise<Library> {
    const recipes = new Map<string, Recipe>()
    for (const [slug, b] of builtinParsed) recipes.set(slug, b.recipe)
    const custom = new Set<string>()
    const broken: string[] = []
    const listed = this.d.list(RECIPES_DIR, true)
    if (Array.isArray(listed)) {
      for (const f of listed) {
        const slug = f.kind === "file" ? FILE.exec(f.path)?.[1] : undefined
        if (f.kind !== "file" || !slug) continue
        const key = `${f.path}:${f.sha256}`
        let r = this.parsed.get(key)
        if (r === undefined) {
          r = await this.parse(f, slug)
          this.parsed.set(key, r)
        }
        if (typeof r === "string") broken.push(r)
        else {
          recipes.set(slug, r)
          custom.add(slug)
        }
      }
    }
    const sorted = [...recipes.values()].sort((a, b) => a.title.localeCompare(b.title))
    return { recipes: sorted, custom, broken }
  }

  async edit(slug: string): Promise<string | null> {
    const builtin = builtinParsed.get(slug)
    if (!builtin) return null
    const path = `${RECIPES_DIR}/${slug}/RECIPE.md`
    if (this.exists(path)) return path
    const body = encoder.encode(builtin.text)
    const id = crypto.randomUUID()
    const r2Key = fileKey(this.d.userId(), HOME, id)
    await this.d.files.put(r2Key, body, { httpMetadata: { contentType: "text/markdown" } })
    const out = this.d.put({
      id,
      path,
      r2Key,
      size: body.length,
      type: "text/markdown",
      sha256: await sha256Hex(body),
      author: { kind: "human" },
      expectSha256: "none",
    })
    if (out.conflict) await deleteFiles(this.d.files, r2Key)
    if (out.drop) await deleteFiles(this.d.files, out.drop)
    if (out.entry || this.exists(path)) return path
    throw new Error(`recipe ${slug}: the file could not be written`)
  }

  async retireSeeded(): Promise<void> {
    const raw = getSetting(this.d.sql, SEEDED)
    if (raw === null) return
    const stored = JSON.parse(raw) as string[] | Record<string, string>
    const shipped: Record<string, string> = Array.isArray(stored) ? {} : stored
    for (const [slug, sha] of Object.entries(shipped)) {
      if (!sha) continue
      const path = `${RECIPES_DIR}/${slug}/RECIPE.md`
      const current = this.fileAt(path)
      if (!current) continue
      const builtin = builtinParsed.get(slug)
      const builtinSha = builtin ? await sha256Hex(encoder.encode(builtin.text)) : null
      if (current.sha256 !== sha && current.sha256 !== builtinSha) continue
      const inside = this.d.list(`${RECIPES_DIR}/${slug}`, true)
      if (!Array.isArray(inside) || inside.some((e) => !(e.kind === "file" && e.path === path))) continue
      this.d.remove([`${RECIPES_DIR}/${slug}`], true)
    }
    const left = this.d.list(RECIPES_DIR, true)
    if (Array.isArray(left) && left.length === 0) this.d.remove([RECIPES_DIR], false)
    deleteSetting(this.d.sql, SEEDED)
  }

  private exists(path: string): boolean {
    return this.fileAt(path) !== null
  }

  private fileAt(path: string): (FsEntry & { kind: "file" }) | null {
    const listed = this.d.list(RECIPES_DIR, true)
    if (!Array.isArray(listed)) return null
    const hit = listed.find((e): e is FsEntry & { kind: "file" } => e.kind === "file" && e.path === path)
    return hit ?? null
  }

  private async parse(f: FsEntry & { kind: "file" }, slug: string): Promise<Recipe | string> {
    if (f.size > MAX_BYTES) return `recipe ${slug}: the file is larger than ${MAX_BYTES / 1024} KB`
    const object = await this.d.files.get(f.r2Key)
    if (!object) return `recipe ${slug}: the file is missing`
    try {
      return parseRecipe(new TextDecoder().decode(await object.arrayBuffer()), slug)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
}
