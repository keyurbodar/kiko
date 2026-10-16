import type { Agent, InstallRecipe, RecipeInstall, RoomId } from "@kiko/protocol"
import type { Recipe } from "../recipes/recipe"
import type { RecipeLibrary } from "./recipe-library"
import { deleteInstall, findInstall, findTarget, type Install, listInstalls, recipeRule, recipeWake, saveInstall } from "./recipes"
import type { NewRoutine, Reminder } from "./reminders"
import type { RoutineResult } from "./routines"

const ON_FOR_YOU = " the human turned this on for you in this chat. use it on your own when it fits."

type Ports = {
  sql: SqlStorage
  library: RecipeLibrary
  createRoutine(input: NewRoutine): Promise<RoutineResult>
  cancelRoutine(id: string): Promise<unknown>
  routine(id: string): Reminder | null
  timezone(): Promise<string | null>
  agentNamed(name: string): Agent | null
  makeAgent(name: string, handle: string, description: string, model: string): Promise<Agent | null>
  openChat(title: string, agentIds: readonly string[]): Promise<RoomId>
  chiefModel(): Promise<string>
  announce(roomId: RoomId, input: { installId: string; agent: string; title: string; wake: string | null }): Promise<"delivered" | "refused" | "gone" | "duplicate">
}

type InstallOutcome = { ok: true; install: RecipeInstall; setup: string; existed: boolean } | { ok: false; error: string }

/** Installs and removals. A recipe is a file; an install is a row plus links to its routines. Nothing reconciles them. */
export class RecipeService {
  private queue: Promise<unknown> = Promise.resolve()

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => {})
    return next
  }

  constructor(private readonly p: Ports) {}

  /** The recipe files that load, which of them the owner wrote, the installs with their live routines, and the broken files. */
  async list(): Promise<{ cards: Recipe[]; custom: ReadonlySet<string>; installs: RecipeInstall[]; broken: string[] }> {
    const lib = await this.p.library.read()
    return { cards: lib.recipes, custom: lib.custom, installs: listInstalls(this.p.sql).map((i) => this.withRoutines(i)), broken: lib.broken }
  }

  /** Writes the built-in recipe to the drive. Null when no built-in has that slug. */
  edit(slug: string): Promise<string | null> {
    return this.p.library.edit(slug)
  }

  /** Removes the copies an older build put in the drive. */
  retireSeeded(): Promise<void> {
    return this.p.library.retireSeeded()
  }

  /** Adds a recipe to one agent in one chat. The same recipe, agent, and chat is one install: a second add returns the first. */
  install(input: InstallRecipe, by?: string): Promise<InstallOutcome> {
    return this.serial(() => this.addInstall(input, by))
  }

  private async addInstall(input: InstallRecipe, by?: string): Promise<InstallOutcome> {
    const done = findInstall(this.p.sql, input.installId)
    if (done) return { ok: true, install: this.withRoutines(done), setup: `${done.slug} is already on here.`, existed: true }
    const lib = await this.p.library.read()
    const recipe = lib.recipes.find((r) => r.slug === input.slug)
    if (!recipe) return { ok: false, error: `no recipe named ${input.slug} in /home/recipes` }
    let roomId: RoomId
    let agent: string
    if ("own" in input) {
      const made = this.p.agentNamed(recipe.agent.name) ?? (await this.p.makeAgent(recipe.agent.name, recipe.agent.handle, recipe.description, await this.p.chiefModel()))
      if (!made) return { ok: false, error: `@${recipe.agent.handle} could not be made. pick a chat instead.` }
      roomId = await this.p.openChat(made.name, [made.id])
      agent = made.slug
    } else {
      roomId = input.roomId
      agent = input.agent
    }
    const there = findTarget(this.p.sql, recipe.slug, roomId, agent)
    if (there) return { ok: true, install: this.withRoutines(there), setup: `${recipe.title} is already on for @${agent} in this chat.`, existed: true }
    return this.add(recipe, input.installId, roomId, agent, by)
  }

  private async add(recipe: Recipe, installId: string, roomId: RoomId, agent: string, by: string | undefined): Promise<InstallOutcome> {
    const tz = (await this.p.timezone()) ?? "UTC"
    const at = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString()
    const made: Reminder[] = []
    const undo = async () => {
      for (const r of made) await this.p.cancelRoutine(r.id)
    }
    try {
      for (const t of recipe.triggers) {
        const out = await this.p.createRoutine({ name: t.name, instructions: t.run, trigger: { on: "time", at, rrule: recipeRule(t.every) }, tz, roomId, target: agent, createdBy: "human" })
        if (!out.ok) {
          await undo()
          return { ok: false, error: out.error }
        }
        made.push(out.routine)
      }
      const setup = recipeWake(recipe, made)
      const woke = await this.p.announce(roomId, { installId, agent, title: recipe.title, wake: by === agent ? null : setup })
      if (woke !== "delivered" && woke !== "duplicate") {
        await undo()
        return { ok: false, error: woke === "gone" ? `@${agent} is not in that chat` : "that chat could not take the recipe. try again." }
      }
      const install: Install = { installId, slug: recipe.slug, roomId, agent, at: Date.now() }
      saveInstall(this.p.sql, install)
      for (const r of made) this.p.sql.exec("INSERT OR IGNORE INTO recipe_links (routine_id, install_id) VALUES (?, ?)", r.id, installId)
      return { ok: true, install: this.withRoutines(install), setup, existed: false }
    } catch (error) {
      await undo()
      throw error
    }
  }

  /** Stops one agent's use of a recipe: its routines are cancelled and the install is gone. The recipe file stays. */
  uninstall(installId: string): Promise<boolean> {
    return this.serial(() => this.removeInstall(installId))
  }

  private async removeInstall(installId: string): Promise<boolean> {
    if (!findInstall(this.p.sql, installId)) return false
    const rows = this.p.sql.exec<{ routine_id: string }>("SELECT routine_id FROM recipe_links WHERE install_id = ?", installId).toArray()
    for (const r of rows) await this.p.cancelRoutine(r.routine_id)
    deleteInstall(this.p.sql, installId)
    return true
  }

  /** A routine of an install was cancelled. When it was the install's last one, the install is over too. */
  routineGone(routineId: string): void {
    const row = this.p.sql.exec<{ install_id: string }>("SELECT install_id FROM recipe_links WHERE routine_id = ?", routineId).toArray()[0]
    if (!row) return
    this.p.sql.exec("DELETE FROM recipe_links WHERE routine_id = ?", routineId)
    const left = this.p.sql.exec<{ n: number }>("SELECT count(*) AS n FROM recipe_links WHERE install_id = ?", row.install_id).one().n
    if (!left) deleteInstall(this.p.sql, row.install_id)
  }

  /** The chat is gone. Its installs go with it, and their routines are cancelled. */
  chatGone(roomId: string): Promise<void> {
    return this.serial(async () => {
      for (const install of listInstalls(this.p.sql).filter((i) => i.roomId === roomId)) await this.removeInstall(install.installId)
    })
  }

  /** What an agent's skills list says about each recipe. A recipe with no schedule that the human turned on for this agent here says so. */
  async briefs(roomId: string, agent: string): Promise<{ name: string; description: string }[]> {
    const { recipes } = await this.p.library.read()
    const on = new Set(this.p.sql.exec<{ slug: string }>("SELECT slug FROM recipe_installs WHERE room_id = ? AND agent = ?", roomId, agent).toArray().map((r) => r.slug))
    return recipes.map((r) => ({ name: r.slug, description: `${r.title} recipe: ${r.description}${on.has(r.slug) && !r.triggers.length ? ON_FOR_YOU : ""}` }))
  }

  /** The recipe as `read_skill` shows it, and where it came from. */
  async skillText(slug: string): Promise<string | null> {
    const lib = await this.p.library.read()
    const r = lib.recipes.find((x) => x.slug === slug)
    if (!r) return null
    const from = lib.custom.has(slug) ? `/home/recipes/${r.slug}/RECIPE.md` : "kiko's built-in recipes"
    const apps = r.apps.length ? ` it uses ${r.apps.join(", ")} through the human's connected apps.` : ""
    return `the ${r.title.toLowerCase()} recipe, from ${from}. it runs: ${r.when.toLowerCase()}.${apps}\n\n${r.body}`
  }

  /** An install with its routines that are still live. A routine that is done or cancelled is not shown. */
  private withRoutines(install: Install): RecipeInstall {
    const links = this.p.sql.exec<{ routine_id: string }>("SELECT routine_id FROM recipe_links WHERE install_id = ?", install.installId).toArray()
    const routines = links.flatMap(({ routine_id }) => {
      const r = this.p.routine(routine_id)
      if (!r?.trigger || (r.status !== "active" && r.status !== "paused")) return []
      const trigger = r.trigger.on === "time" ? { ...r.trigger, at: new Date(r.dueUtc).toISOString() } : r.trigger
      return [{ id: r.id, name: r.name ?? "Routine", trigger, tz: r.tz, status: r.status, dueUtc: r.dueUtc }]
    })
    return { ...install, routines }
  }
}
