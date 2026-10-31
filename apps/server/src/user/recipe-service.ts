import type {
  Agent,
  InstallRecipe,
  RecipeInstall,
  RecipeNeedsConnect,
  RecipeRoutine,
  RoomId,
  Trigger,
} from "@kiko/protocol"
import { toolkitSlug } from "../recipes/card"
import type { Recipe } from "../recipes/recipe"
import type { RecipeLibrary } from "./recipe-library"
import {
  deleteInstall,
  findInstall,
  findTarget,
  type Install,
  listInstalls,
  recipeLocation,
  recipeRule,
  recipeWake,
  saveInstall,
} from "./recipes"
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
  changed(): void
  composio: {
    connected(): Promise<ReadonlySet<string> | "off" | null>
    link(app: string): Promise<string | null>
  }
  announce(
    roomId: RoomId,
    input: { installId: string; agent: string; title: string; wake: string | null },
  ): Promise<"delivered" | "refused" | "gone" | "duplicate">
}

type InstallOutcome =
  | { ok: true; install: RecipeInstall; setup: string; existed: boolean }
  | { ok: false; error: string }
  | { ok: false; needsConnect: RecipeNeedsConnect }

export class RecipeService {
  private queue: Promise<unknown> = Promise.resolve()

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => {})
    return next
  }

  constructor(private readonly p: Ports) {}

  async list(): Promise<{ cards: Recipe[]; custom: ReadonlySet<string>; installs: RecipeInstall[]; broken: string[] }> {
    const lib = await this.p.library.read()
    const routines = this.routinesByInstall()
    return {
      cards: lib.recipes,
      custom: lib.custom,
      installs: listInstalls(this.p.sql).map((i) => ({ ...i, routines: routines.get(i.installId) ?? [] })),
      broken: lib.broken,
    }
  }

  edit(slug: string): Promise<string | null> {
    return this.p.library.edit(slug)
  }

  retireSeeded(): Promise<void> {
    return this.p.library.retireSeeded()
  }

  install(input: InstallRecipe, by?: string): Promise<InstallOutcome> {
    return this.serial(() => this.addInstall(input, by))
  }

  private async addInstall(input: InstallRecipe, by?: string): Promise<InstallOutcome> {
    const done = findInstall(this.p.sql, input.installId)
    if (done)
      return { ok: true, install: this.withRoutines(done), setup: `${done.slug} is already on here.`, existed: true }
    const lib = await this.p.library.read()
    const recipe = lib.recipes.find((r) => r.slug === input.slug)
    if (!recipe)
      return { ok: false, error: lib.problems.get(input.slug) ?? `no recipe named ${input.slug} in /home/recipes` }
    const on = "own" in input ? undefined : findTarget(this.p.sql, recipe.slug, input.roomId, input.agent)
    if (on)
      return {
        ok: true,
        install: this.withRoutines(on),
        setup: `${recipe.title} is already on for @${on.agent} in this chat.`,
        existed: true,
      }
    const needsConnect = await this.gate(recipe)
    if (needsConnect) return { ok: false, needsConnect }
    let roomId: RoomId
    let agent: string
    if ("own" in input) {
      const made =
        this.p.agentNamed(recipe.agent.name) ??
        (await this.p.makeAgent(recipe.agent.name, recipe.agent.handle, recipe.description, await this.p.chiefModel()))
      if (!made) return { ok: false, error: `@${recipe.agent.handle} could not be made. pick a chat instead.` }
      roomId = await this.p.openChat(made.name, [made.id])
      agent = made.slug
    } else {
      roomId = input.roomId
      agent = input.agent
    }
    const there = findTarget(this.p.sql, recipe.slug, roomId, agent)
    if (there)
      return {
        ok: true,
        install: this.withRoutines(there),
        setup: `${recipe.title} is already on for @${agent} in this chat.`,
        existed: true,
      }
    return this.add(recipe, lib.custom.has(recipe.slug), input.installId, roomId, agent, by)
  }

  private async gate(recipe: Recipe): Promise<RecipeNeedsConnect | null> {
    if (!recipe.apps.length) return null
    const have = await this.p.composio.connected()
    if (have === "off")
      return {
        state: "needs_connect",
        links: [],
        reason: "Add a Composio key in Settings, Integrations, then add this recipe again.",
      }
    if (!have) return { state: "needs_connect", links: [], reason: "Kiko could not check your apps. Try again." }
    const missing = recipe.apps.filter((app) => !have.has(toolkitSlug(app)))
    if (!missing.length) return null
    const made = await Promise.all(missing.map(async (app) => ({ app, url: await this.p.composio.link(app) })))
    const links = made.flatMap((l) => (l.url ? [{ app: l.app, url: l.url }] : []))
    return {
      state: "needs_connect",
      links,
      ...(links.length ? {} : { reason: "Kiko could not make a connect link. Try again." }),
    }
  }

  private async add(
    recipe: Recipe,
    custom: boolean,
    installId: string,
    roomId: RoomId,
    agent: string,
    by: string | undefined,
  ): Promise<InstallOutcome> {
    const tz = (await this.p.timezone()) ?? "UTC"
    const at = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString()
    const made: Reminder[] = []
    const undo = async () => {
      for (const r of made) await this.p.cancelRoutine(r.id)
    }
    try {
      for (const t of recipe.triggers) {
        const out = await this.p.createRoutine({
          name: t.name,
          instructions: t.run,
          trigger: { on: "time", at, rrule: recipeRule(t.every) },
          tz,
          roomId,
          target: agent,
          createdBy: "human",
        })
        if (!out.ok) {
          await undo()
          return { ok: false, error: out.error }
        }
        made.push(out.routine)
      }
      const setup = recipeWake(recipe, recipeLocation(recipe.slug, custom), made)
      const woke = await this.p.announce(roomId, {
        installId,
        agent,
        title: recipe.title,
        wake: by === agent ? null : setup,
      })
      if (woke !== "delivered" && woke !== "duplicate") {
        await undo()
        return {
          ok: false,
          error: woke === "gone" ? `@${agent} is not in that chat` : "that chat could not take the recipe. try again.",
        }
      }
      const install: Install = { installId, slug: recipe.slug, roomId, agent, at: Date.now() }
      saveInstall(this.p.sql, install)
      this.p.changed()
      for (const r of made)
        this.p.sql.exec("INSERT OR IGNORE INTO recipe_links (routine_id, install_id) VALUES (?, ?)", r.id, installId)
      return { ok: true, install: this.withRoutines(install), setup, existed: false }
    } catch (error) {
      await undo()
      throw error
    }
  }

  uninstall(installId: string): Promise<boolean> {
    return this.serial(() => this.removeInstall(installId))
  }

  private async removeInstall(installId: string): Promise<boolean> {
    if (!findInstall(this.p.sql, installId)) return false
    const rows = this.p.sql
      .exec<{ routine_id: string }>("SELECT routine_id FROM recipe_links WHERE install_id = ?", installId)
      .toArray()
    for (const r of rows) await this.p.cancelRoutine(r.routine_id)
    deleteInstall(this.p.sql, installId)
    this.p.changed()
    return true
  }

  routineGone(routineId: string): void {
    const row = this.p.sql
      .exec<{ install_id: string }>("SELECT install_id FROM recipe_links WHERE routine_id = ?", routineId)
      .toArray()[0]
    if (!row) return
    this.p.sql.exec("DELETE FROM recipe_links WHERE routine_id = ?", routineId)
    const left = this.p.sql
      .exec<{ n: number }>("SELECT count(*) AS n FROM recipe_links WHERE install_id = ?", row.install_id)
      .one().n
    if (left) return
    deleteInstall(this.p.sql, row.install_id)
    this.p.changed()
  }

  chatGone(roomId: string): Promise<void> {
    return this.serial(async () => {
      for (const install of listInstalls(this.p.sql).filter((i) => i.roomId === roomId))
        await this.removeInstall(install.installId)
    })
  }

  agentGone(slug: string, roomId?: string): Promise<void> {
    return this.serial(async () => {
      for (const install of listInstalls(this.p.sql).filter(
        (i) => i.agent === slug && (roomId === undefined || i.roomId === roomId),
      ))
        await this.removeInstall(install.installId)
    })
  }

  async briefs(roomId: string, agent: string): Promise<{ name: string; description: string; location: string }[]> {
    const on = new Set(
      this.p.sql
        .exec<{ slug: string }>("SELECT slug FROM recipe_installs WHERE room_id = ? AND agent = ?", roomId, agent)
        .toArray()
        .map((r) => r.slug),
    )
    if (!on.size) return []
    const { recipes, custom } = await this.p.library.read()
    return recipes
      .filter((r) => on.has(r.slug))
      .map((r) => ({
        name: r.slug,
        description: `${r.title} recipe: ${r.description}${r.triggers.length ? "" : ON_FOR_YOU}`,
        location: recipeLocation(r.slug, custom.has(r.slug)),
      }))
  }

  private routinesByInstall(): Map<string, RecipeRoutine[]> {
    const rows = this.p.sql
      .exec<{
        install_id: string
        id: string
        name: string | null
        trigger: string
        tz: string
        status: "active" | "paused"
        due_utc: number
      }>(
        `SELECT l.install_id, r.id, r.name, r."trigger", r.tz, r.status, r.due_utc
         FROM recipe_links l JOIN reminders r ON r.id = l.routine_id
         WHERE r."trigger" IS NOT NULL AND r.status IN ('active', 'paused')
         ORDER BY l.rowid`,
      )
      .toArray()
    const out = new Map<string, RecipeRoutine[]>()
    for (const row of rows) {
      const trigger = JSON.parse(row.trigger) as Trigger
      const routine: RecipeRoutine = {
        id: row.id,
        name: row.name ?? "Routine",
        trigger: trigger.on === "time" ? { ...trigger, at: new Date(row.due_utc).toISOString() } : trigger,
        tz: row.tz,
        status: row.status,
        dueUtc: row.due_utc,
      }
      const list = out.get(row.install_id)
      if (list) list.push(routine)
      else out.set(row.install_id, [routine])
    }
    return out
  }

  private withRoutines(install: Install): RecipeInstall {
    const links = this.p.sql
      .exec<{ routine_id: string }>("SELECT routine_id FROM recipe_links WHERE install_id = ?", install.installId)
      .toArray()
    const routines = links.flatMap(({ routine_id }) => {
      const r = this.p.routine(routine_id)
      if (!r?.trigger || (r.status !== "active" && r.status !== "paused")) return []
      const trigger = r.trigger.on === "time" ? { ...r.trigger, at: new Date(r.dueUtc).toISOString() } : r.trigger
      return [{ id: r.id, name: r.name ?? "Routine", trigger, tz: r.tz, status: r.status, dueUtc: r.dueUtc }]
    })
    return { ...install, routines }
  }
}
