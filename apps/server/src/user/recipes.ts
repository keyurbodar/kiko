import type { RecipeInstall, RoomId } from "@kiko/protocol"
import type { Recipe } from "../recipes/recipe"
import type { Reminder } from "./reminders"

type Row = { install_id: string; slug: string; room_id: string; agent: string; at: number }

export type Install = Omit<RecipeInstall, "routines">

const toInstall = (r: Row): Install => ({
  installId: r.install_id,
  slug: r.slug,
  roomId: r.room_id as RoomId,
  agent: r.agent,
  at: r.at,
})

export function listInstalls(sql: SqlStorage): Install[] {
  return sql.exec<Row>("SELECT * FROM recipe_installs ORDER BY at").toArray().map(toInstall)
}

export function findInstall(sql: SqlStorage, installId: string): Install | null {
  const row = sql.exec<Row>("SELECT * FROM recipe_installs WHERE install_id = ?", installId).toArray()[0]
  return row ? toInstall(row) : null
}

export function findTarget(sql: SqlStorage, slug: string, roomId: string, agent: string): Install | null {
  const row = sql
    .exec<Row>("SELECT * FROM recipe_installs WHERE slug = ? AND room_id = ? AND agent = ?", slug, roomId, agent)
    .toArray()[0]
  return row ? toInstall(row) : null
}

export function deleteInstall(sql: SqlStorage, installId: string): void {
  sql.exec("DELETE FROM recipe_links WHERE install_id = ?", installId)
  sql.exec("DELETE FROM recipe_installs WHERE install_id = ?", installId)
}

export function saveInstall(sql: SqlStorage, install: Install): void {
  sql.exec(
    "INSERT OR IGNORE INTO recipe_installs (install_id, slug, room_id, agent, at) VALUES (?, ?, ?, ?, ?)",
    install.installId,
    install.slug,
    install.roomId,
    install.agent,
    install.at,
  )
}

export const recipeRule = (every: string) =>
  /BYMINUTE=/i.test(every) && !/BYSECOND=/i.test(every) ? `${every};BYSECOND=0` : every

export const recipeLocation = (slug: string, custom: boolean) =>
  `/${custom ? "home" : "kiko"}/recipes/${slug}/RECIPE.md`

export function recipeWake(r: Recipe, location: string, routines: readonly Reminder[]): string {
  const lines = [
    `the human just added the "${r.title}" recipe to this chat. read its instructions in ${location} first.`,
  ]
  lines.push(
    routines.length
      ? `it made these routines: ${routines.map((t) => `"${t.name}" (id ${t.id})`).join(", ")}. it runs: ${r.when.toLowerCase()}.`
      : `it runs: ${r.when.toLowerCase()}.`,
  )
  lines.push("now say hi in one short bubble with what it will do for them.")
  if (r.setup.length)
    lines.push(
      `then ask, one short bubble each: ${r.setup.join(" / ")}. when they answer, change the routine to fit with update_routine, and keep what they said in memory.`,
    )
  return lines.join("\n")
}
