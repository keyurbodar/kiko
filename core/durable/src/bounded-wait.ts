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
