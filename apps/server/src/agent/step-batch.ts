/**
 * Sends step reports to the room in order, one request at a time. What piles up while a request is in flight
 * goes out together in the next one, so parallel tool calls cost one request, not one each. No timer: the
 * request itself is the wait.
 */
export class StepBatch<T> {
  private queue: T[] = []
  private sending = false

  constructor(private readonly send: (items: readonly T[]) => Promise<unknown>) {}

  push(item: T): void {
    this.queue.push(item)
    if (!this.sending) queueMicrotask(() => void this.flush())
  }

  private async flush(): Promise<void> {
    if (this.sending || !this.queue.length) return
    this.sending = true
    try {
      while (this.queue.length) {
        const items = this.queue
        this.queue = []
        await this.send(items).catch(() => undefined)
      }
    } finally {
      this.sending = false
    }
  }
}
