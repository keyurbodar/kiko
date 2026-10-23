import type { Activity, AgentState, WorkerRow } from "@kiko/protocol"

export function activityOf(
  state: AgentState,
  stored: Activity | null,
  workers: readonly WorkerRow[],
): Activity | undefined {
  if (state === "idle") return undefined
  if (stored) return stored
  const running = workers.filter((w) => w.status === "running")
  if (state === "working" && running.length) return { kind: "background", workers: running }
  return state === "typing" ? { kind: "writing" } : undefined
}
