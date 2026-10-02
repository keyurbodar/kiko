import type { Task } from "@kiko/protocol"

/** The tasks still open: not done, not cancelled. The group top bar counts these (P6-09). */
export const openTasks = (tasks: readonly Task[]) => tasks.filter((t) => t.status !== "done" && t.status !== "cancelled")
