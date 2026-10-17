import type { Extension } from "@earendil-works/pi-durable"
import { MEMORY_NOTE } from "@kiko/memory/tools"
import { BROWSER_EXT } from "./browser/tools"
import { GROUPS_EXT } from "./extensions/chief"
import { MESSAGING } from "./extensions/messaging"
import { ROUTINES } from "./extensions/routines"
import { WORK } from "./extensions/names"
import { WORKSPACE } from "./extensions/workspace"

/**
 * The roles an agent runs as. The talker is the agent the human writes to. A worker is the
 * background conversation `start_work` opens, and it answers only its lead.
 */
export type Role = "talker" | "worker"

/**
 * Which roles get each extension, by name. The talker and the worker differ only here, so this is the
 * one place a tool is given to one and not the other. A name that is not listed reaches both, so a
 * test extension or a new one is never silently dropped.
 */
const TABLE: Readonly<Record<string, readonly Role[]>> = {
  // A worker has no chat to lead and no teammates to message: its answer is its report.
  [WORK]: ["talker"],
  [MESSAGING]: ["talker"],
  [MEMORY_NOTE]: ["talker"],
  [WORKSPACE]: ["talker"],
  [ROUTINES]: ["talker"],
  [GROUPS_EXT]: ["talker"],
  // Driving the browser is slow, so it is the worker's job. Connected apps, web search included, reach both.
  [BROWSER_EXT]: ["worker"],
}

export const hasRole = (name: string, role: Role): boolean => (TABLE[name] ?? ["talker", "worker"]).includes(role)

/** The extensions one role gets, in the order they were built. */
export const forRole = (extensions: readonly Extension[], role: Role): Extension[] => extensions.filter((e) => hasRole(e.name, role))
