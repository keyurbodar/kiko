import type { RecipeInstall, RoomId } from "@kiko/protocol"
import type { Recipe } from "../recipes/recipe"
import type { Reminder } from "./reminders"

type Row = { install_id: string; slug: string; room_id: string; agent: string; at: number }

const toInstall = (r: Row): RecipeInstall => ({ installId: r.install_id, slug: r.slug, roomId: r.room_id as RoomId, agent: r.agent, at: r.at })

export function listInstalls(sql: SqlStorage): RecipeInstall[] {
  return sql.exec<Row>("SELECT * FROM recipe_installs ORDER BY at").toArray().map(toInstall)
}

export function findInstall(sql: SqlStorage, installId: string): RecipeInstall | null {
  const row = sql.exec<Row>("SELECT * FROM recipe_installs WHERE install_id = ?", installId).toArray()[0]
  return row ? toInstall(row) : null
}

export function saveInstall(sql: SqlStorage, install: RecipeInstall): void {
  sql.exec("INSERT OR IGNORE INTO recipe_installs (install_id, slug, room_id, agent, at) VALUES (?, ?, ?, ?, ?)", install.installId, install.slug, install.roomId, install.agent, install.at)
}

/** A recipe's rule, given the minute it names: without BYSECOND the routine would fire at the second the human added it. */
export const recipeRule = (every: string) => (/BYMINUTE=/i.test(every) && !/BYSECOND=/i.test(every) ? `${every};BYSECOND=0` : every)

/** What the agent hears once, right after the human adds the recipe. */
export function recipeWake(r: Recipe, routines: readonly Reminder[]): string {
  const lines = [`the human just added the "${r.title}" recipe to this chat. its instructions are the ${r.slug} skill: load it with read_skill("${r.slug}") first.`]
  lines.push(routines.length ? `it made these routines: ${routines.map((t) => `"${t.name}" (id ${t.id})`).join(", ")}. it runs: ${r.when.toLowerCase()}.` : `it runs: ${r.when.toLowerCase()}.`)
  lines.push("now say hi in one short bubble with what it will do for them.")
  if (r.setup.length) lines.push(`then ask, one short bubble each: ${r.setup.join(" / ")}. when they answer, change the routine to fit with update_routine, and keep what they said in memory.`)
  if (r.apps.length) lines.push(`it needs ${r.apps.join(" and ")}. if one is not connected, say which and send the connect link once.`)
  return lines.join("\n")
}
