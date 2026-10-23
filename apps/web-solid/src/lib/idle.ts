export function whenIdle(task: () => void): void {
  if ("requestIdleCallback" in window) requestIdleCallback(task, { timeout: 1500 })
  else setTimeout(task, 200)
}
