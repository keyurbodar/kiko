import { KIKO } from "@kiko/protocol"
import type { AgentHome } from "../room/home"
import type { Reminder } from "../user/reminders"

export function canManageRoutine(home: Pick<AgentHome, "roomId" | "slug">, routine: Reminder): boolean {
  return home.slug === KIKO || routine.roomId === home.roomId || routine.target === home.slug
}
