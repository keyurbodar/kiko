import { boundedWait } from "@kiko/durable/bounded-wait"

export type Answer = string

export class AnswerWaiters {
  private readonly waiting = new Map<string, (answer: Answer | null) => void>()
  private readonly early = new Map<string, Answer>()

  wait(id: string, ms: number, signal?: AbortSignal): Promise<Answer | null> {
    const early = this.early.get(id)
    if (early !== undefined) {
      this.early.delete(id)
      return Promise.resolve(early)
    }
    if (signal?.aborted) return Promise.resolve(null)
    return new Promise((resolve) => {
      const wait = boundedWait(ms)
      const onAbort = () => settle(null)
      const settle = (answer: Answer | null) => {
        wait.cancel()
        signal?.removeEventListener("abort", onAbort)
        this.waiting.delete(id)
        resolve(answer)
      }
      wait.then(() => settle(null))
      signal?.addEventListener("abort", onAbort)
      this.waiting.set(id, settle)
    })
  }

  answer(id: string, answer: Answer): boolean {
    const settle = this.waiting.get(id)
    if (settle) settle(answer)
    else this.early.set(id, answer)
    return settle !== undefined
  }

  interrupt(): void {
    for (const settle of [...this.waiting.values()]) settle(null)
  }
}
