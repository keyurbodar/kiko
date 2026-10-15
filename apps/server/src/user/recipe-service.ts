import type { Agent, RecipeInstall, RoomId } from "@kiko/protocol"
import type { InstallRecipe } from "@kiko/protocol"
import { parseRecipe, type Recipe } from "../recipes/recipe"
import { BUILTIN_RECIPES } from "../recipes/catalog.gen"
import type { RecipeLibrary } from "./recipe-library"
import { deleteInstall, findInstall, findTarget, listInstalls, recipeRule, recipeWake, saveInstall } from "./recipes"
import type { NewRoutine, Reminder } from "./reminders"
import type { RoutineResult } from "./routines"

const MISSING = "missing"
const ON_FOR_YOU = " the human turned this on for you in this chat. use it on your own when it fits."

type Ports = {
  sql: SqlStorage
  library: RecipeLibrary
  createRoutine(input: NewRoutine): Promise<RoutineResult>
  updateRoutine(id: string, patch: { status?: "active" | "paused"; instructions?: string; trigger?: NewRoutine["trigger"] }): Promise<RoutineResult>
  cancelRoutine(id: string): Promise<unknown>
  routine(id: string): Reminder | null
  timezone(): Promise<string | null>
  makeAgent(name: string, handle: string, description: string, model: string): Promise<Agent | null>
  openChat(title: string, agentIds: readonly string[]): Promise<RoomId>
  chiefModel(): Promise<string>
  announce(roomId: RoomId, input: { installId: string; agent: string; title: string; wake: string | null }): Promise<"delivered" | "refused" | "gone" | "duplicate">
  notice(roomId: RoomId, id: string, text: string): Promise<void>
}

type InstallOutcome = { ok: true; install: RecipeInstall; setup: string; existed: boolean } | { ok: false; error: string }

type RoutineRow = { install_id: string; idx: number; routine_id: string; every: string; run: string; sha: string; paused_missing: number; slug: string; room_id: string }

/** Installs, removals, and keeping each install's routines in step with the recipe file. */
export class RecipeService {
  private queue: Promise<unknown> = Promise.resolve()

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => {})
    return next
  }

  constructor(private readonly p: Ports) {}

  /** Puts new built-in recipes in the drive and brings installs in line with their files. */
  async sync(): Promise<void> {
    await this.p.library.seed()
    await this.reconcile()
  }

  async list(): Promise<{ cards: Recipe[]; installs: RecipeInstall[]; broken: string[] }> {
    await this.reconcile()
    const { recipes, broken } = await this.p.library.read()
    const links = this.p.sql.exec<{ install_id: string; routine_id: string }>("SELECT install_id, routine_id FROM recipe_routines").toArray()
    const installs = listInstalls(this.p.sql).map((install) => ({ ...install, routines: links.filter((link) => link.install_id === install.installId).flatMap((link) => {
      const r = this.p.routine(link.routine_id)
      if (!r?.trigger || (r.status !== "active" && r.status !== "paused")) return []
      const trigger = r.trigger.on === "time" ? { ...r.trigger, at: new Date(r.dueUtc).toISOString() } : r.trigger
      return [{ id: r.id, name: r.name ?? "Routine", trigger, tz: r.tz, status: r.status, dueUtc: r.dueUtc }]
    }) }))
    return { cards: recipes, installs, broken }
  }

  /** Adds a recipe to one agent in one chat. The same recipe, agent, and chat is one install: a second add returns the first. */
  install(input: InstallRecipe, by?: string): Promise<InstallOutcome> {
    return this.serial(() => this.addInstall(input, by))
  }

  private async addInstall(input: InstallRecipe, by?: string): Promise<InstallOutcome> {
    const done = findInstall(this.p.sql, input.installId)
    if (done) return { ok: true, install: done, setup: `${done.slug} is already on here.`, existed: true }
    const lib = await this.p.library.read()
    const recipe = lib.recipes.find((r) => r.slug === input.slug)
    if (!recipe) return { ok: false, error: `no recipe named ${input.slug} in /home/recipes` }
    let roomId: RoomId
    let agent: string
    if ("own" in input) {
      const made = await this.p.makeAgent(recipe.agent.name, recipe.agent.handle, recipe.description, await this.p.chiefModel())
      if (!made) return { ok: false, error: `@${recipe.agent.handle} could not be made. pick a chat instead.` }
      roomId = await this.p.openChat(made.name, [made.id])
      agent = made.slug
    } else {
      roomId = input.roomId
      agent = input.agent
    }
    const there = findTarget(this.p.sql, recipe.slug, roomId, agent)
    if (there) return { ok: true, install: there, setup: `${recipe.title} is already on for @${agent} in this chat.`, existed: true }
    return this.add(recipe, lib.sha.get(recipe.slug) ?? "", input.installId, roomId, agent, by)
  }

  private async add(recipe: Recipe, sha: string, installId: string, roomId: RoomId, agent: string, by: string | undefined): Promise<InstallOutcome> {
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
      const install: RecipeInstall = { installId, slug: recipe.slug, roomId, agent, at: Date.now() }
      saveInstall(this.p.sql, install)
      recipe.triggers.forEach((t, idx) => this.p.sql.exec("INSERT OR REPLACE INTO recipe_routines (install_id, idx, routine_id, every, run, sha) VALUES (?, ?, ?, ?, ?, ?)", installId, idx, made[idx]?.id, t.every, t.run, sha))
      return { ok: true, install, setup, existed: false }
    } catch (error) {
      await undo()
      throw error
    }
  }

  /** Stops one agent's use of a recipe: its routines are cancelled and the install is gone. The recipe file stays. */
  uninstall(installId: string): Promise<boolean> {
    return this.serial(async () => {
      await this.syncRoutines()
      return this.removeInstall(installId)
    })
  }

  private async removeInstall(installId: string): Promise<boolean> {
    if (!findInstall(this.p.sql, installId)) return false
    const rows = this.p.sql.exec<{ routine_id: string }>("SELECT routine_id FROM recipe_routines WHERE install_id = ?", installId).toArray()
    for (const r of rows) await this.p.cancelRoutine(r.routine_id)
    deleteInstall(this.p.sql, installId)
    return true
  }

  /** A routine of an install was cancelled. When it was the install's last one, the install is over too. */
  routineGone(routineId: string): void {
    const row = this.p.sql.exec<{ install_id: string }>("SELECT install_id FROM recipe_routines WHERE routine_id = ?", routineId).toArray()[0]
    if (!row) return
    this.p.sql.exec("DELETE FROM recipe_routines WHERE routine_id = ?", routineId)
    const left = this.p.sql.exec<{ n: number }>("SELECT count(*) AS n FROM recipe_routines WHERE install_id = ?", row.install_id).one().n
    if (!left) deleteInstall(this.p.sql, row.install_id)
  }

  /**
   * Brings each install's routines in line with its recipe file. A schedule or text the owner or the agent changed on the
   * routine no longer matches the copy taken from the file, and is left alone. A recipe whose file is gone pauses its routines.
   */
  reconcile(): Promise<void> {
    return this.serial(() => this.syncRoutines())
  }

  private async syncRoutines(): Promise<void> {
    const installs = listInstalls(this.p.sql)
    if (!installs.length) return
    const lib = await this.p.library.read()
    // Older installs did not record their routine ids. Adopt only routines that name the recipe's skill.
    for (const install of installs) {
      if (this.p.sql.exec("SELECT 1 FROM recipe_routines WHERE install_id = ?", install.installId).toArray().length) continue
      const builtin = BUILTIN_RECIPES.find(([slug]) => slug === install.slug)
      const recipe = lib.recipes.find((r) => r.slug === install.slug) ?? (builtin ? parseRecipe(builtin[1], builtin[0]) : undefined)
      if (!recipe?.triggers.length) continue
      const old = this.p.sql.exec<{ id: string; name: string; text: string }>("SELECT id, name, text FROM reminders WHERE room_id = ? AND target = ? AND status IN ('active', 'paused') ORDER BY created_at", install.roomId, install.agent).toArray()
      const used = new Set<string>()
      for (const [idx, t] of recipe.triggers.entries()) {
        const matches = old.filter((r) => !used.has(r.id) && r.name === t.name.toLowerCase() && r.text.includes(`${install.slug} skill`))
        const first = matches[0]
        if (!first) continue
        used.add(first.id)
        this.p.sql.exec("INSERT OR IGNORE INTO recipe_routines (install_id, idx, routine_id, every, run, sha) VALUES (?, ?, ?, ?, ?, ?)", install.installId, idx, first.id, t.every, t.run, lib.sha.get(install.slug) ?? "legacy")
        for (const duplicate of matches.slice(1)) await this.p.cancelRoutine(duplicate.id)
      }
      if (!used.size) deleteInstall(this.p.sql, install.installId)
    }
    for (const install of installs) {
      if (!this.p.sql.exec("SELECT 1 FROM chats WHERE room_id = ?", install.roomId).toArray().length) await this.removeInstall(install.installId)
    }
    const rows = this.p.sql
      .exec<RoutineRow>("SELECT r.*, i.slug, i.room_id FROM recipe_routines r JOIN recipe_installs i USING (install_id)")
      .toArray()
    if (!rows.length) return
    for (const row of rows) {
      const routine = this.p.routine(row.routine_id)
      if (!routine || routine.status === "cancelled" || routine.status === "done") {
        this.routineGone(row.routine_id)
        continue
      }
      const recipe = lib.recipes.find((r) => r.slug === row.slug)
      const sha = lib.sha.get(row.slug)
      const stamp = (every: string, run: string, to: string) => this.p.sql.exec("UPDATE recipe_routines SET every = ?, run = ?, sha = ? WHERE install_id = ? AND idx = ?", every, run, to, row.install_id, row.idx)
      if (!recipe || sha === undefined) {
        if (row.sha === MISSING) continue
        if (routine.status === "active") {
          const out = await this.p.updateRoutine(row.routine_id, { status: "paused" })
          if (!out.ok) throw new Error(out.error)
          this.p.sql.exec("UPDATE recipe_routines SET paused_missing = 1 WHERE install_id = ? AND idx = ?", row.install_id, row.idx)
          await this.p.notice(row.room_id as RoomId, `recipe-missing:${row.install_id}:${row.idx}`, `i paused "${routine.name}": its recipe file ${row.slug} is gone from home/recipes. put it back to resume it, or cancel the routine.`)
        }
        stamp(row.every, row.run, MISSING)
        continue
      }
      if (row.sha === sha) continue
      const t = recipe.triggers[row.idx]
      const patch: Parameters<Ports["updateRoutine"]>[1] = {}
      if (row.sha === MISSING && row.paused_missing && routine.status === "paused") patch.status = "active"
      if (!t) {
        await this.p.cancelRoutine(row.routine_id)
        continue
      }
      if (t && t.every !== row.every && routine.rrule === recipeRule(row.every)) patch.trigger = { on: "time", at: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(), rrule: recipeRule(t.every) }
      if (t && t.run !== row.run && routine.text === row.run) patch.instructions = t.run
      if (Object.keys(patch).length) {
        const out = await this.p.updateRoutine(row.routine_id, patch)
        if (!out.ok) throw new Error(out.error)
      }
      this.p.sql.exec("UPDATE recipe_routines SET paused_missing = 0 WHERE install_id = ? AND idx = ?", row.install_id, row.idx)
      stamp(t?.every ?? row.every, t?.run ?? row.run, sha)
    }
  }

  /** What an agent's skills list says about each recipe. A recipe with no schedule that the human turned on for this agent here says so. */
  async briefs(roomId: string, agent: string): Promise<{ name: string; description: string }[]> {
    const { recipes } = await this.p.library.read()
    const on = new Set(this.p.sql.exec<{ slug: string }>("SELECT slug FROM recipe_installs WHERE room_id = ? AND agent = ?", roomId, agent).toArray().map((r) => r.slug))
    return recipes.map((r) => ({ name: r.slug, description: `${r.title} recipe: ${r.description}${on.has(r.slug) && !r.triggers.length ? ON_FOR_YOU : ""}` }))
  }

  /** The recipe as `read_skill` shows it. */
  async skillText(slug: string): Promise<string | null> {
    const r = (await this.p.library.read()).recipes.find((x) => x.slug === slug)
    if (!r) return null
    const apps = r.apps.length ? ` it uses ${r.apps.join(", ")} through the human's connected apps.` : ""
    return `the ${r.title.toLowerCase()} recipe, from /home/recipes/${r.slug}/RECIPE.md. it runs: ${r.when.toLowerCase()}.${apps}\n\n${r.body}`
  }
}
