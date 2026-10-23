import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Harness, TaskId, TaskInspection } from "@earendil-works/pi-durable"
import { HarnessNotPaused } from "./errors"

export async function continueAtBoundary(
  harness: Harness,
  due: () => boolean,
  sleeping: (task: TaskInspection["record"]) => boolean = () => false,
): Promise<{
  readonly closed: Promise<void>
  readonly continuing: () => boolean
  dispose(): void
}> {
  const live = await harness.inspect(BACKGROUND_CONTEXT)
  if (live.scheduling !== "paused")
    throw new HarnessNotPaused({ message: "Attach continuation before enabling the Harness" })
  const running = new Set<TaskId>(
    live.tasks
      .filter((task) => task.record.state.status === "running" && !sleeping(task.record))
      .map((task) => task.record.id),
  )
  const finished = Promise.withResolvers<void>()
  let continuing = false
  const dispose = harness.subscribeCommits((publication) => {
    for (const change of publication.changes) {
      if (change.type !== "task") continue
      if (change.value.state.status === "running" && !sleeping(change.value)) running.add(change.value.id)
      else running.delete(change.value.id)
    }
    if (continuing || running.size || !due()) return
    continuing = true
    queueMicrotask(() => {
      void harness.close(BACKGROUND_CONTEXT).then(finished.resolve, finished.reject)
    })
  })
  return { closed: finished.promise, continuing: () => continuing, dispose }
}
