// One bounded wait inside a single request. It never schedules work across requests, so a timer is
// safe here, and the no-timer-in-do rule exempts this file by path as it does safe-fetch.ts. Callers
// pass the handle to `cancel` when the wait ends early, so a pending timer cannot outlive its caller.

export function boundedWait(ms: number): Promise<void> & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  }) as Promise<void> & { cancel: () => void }
  promise.cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
  }
  return promise
}
