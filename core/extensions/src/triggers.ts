import { repeatProblem } from "@kiko/sandbox/recurrence"
import type { ExtensionBundle } from "./manifest"

/** The trigger rate rule. It needs rrule, so it stays out of the wire schema in @kiko/protocol. */
export function triggerGapProblems(bundle: ExtensionBundle): string[] {
  return (bundle.manifest.triggers ?? []).flatMap((t) => {
    const problem = repeatProblem(t.rrule, "UTC", Date.now())
    return problem ? [`trigger ${t.id}: ${problem}`] : []
  })
}
