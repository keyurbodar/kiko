import type { Extension } from "@earendil-works/pi-durable"
import { MEMORY_NOTE } from "@kiko/memory/tools"
import { CONNECT_APP } from "../integrations/composio/connect-tool"
import { BROWSER_EXT } from "./browser/tools"
import { GROUPS_EXT } from "./extensions/chief"
import { MESSAGING } from "./extensions/messaging"
import { ROUTINES } from "./extensions/routines"
import { SELF } from "./extensions/self"
import { SKILLS } from "./extensions/skills"
import { WORK } from "./extensions/names"
import { WORKSPACE } from "./extensions/workspace"
import { TALK } from "./prompt"

export type Role = "talker" | "worker"

const TABLE: Readonly<Record<string, readonly Role[]>> = {
  [TALK]: ["talker"],
  [SELF]: ["talker"],
  [SKILLS]: ["talker"],
  [WORK]: ["talker"],
  [MESSAGING]: ["talker"],
  [MEMORY_NOTE]: ["talker"],
  [WORKSPACE]: ["talker"],
  [ROUTINES]: ["talker"],
  [GROUPS_EXT]: ["talker"],
  [CONNECT_APP]: ["talker"],
  [BROWSER_EXT]: ["worker"],
}

const hasRole = (name: string, role: Role): boolean => (TABLE[name] ?? ["talker", "worker"]).includes(role)

export const forRole = (extensions: readonly Extension[], role: Role): Extension[] =>
  extensions.filter((e) => hasRole(e.name, role))
