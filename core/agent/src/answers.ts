export type Answer = string

export class AnswerWaiters {
  private readonly waiting = new Map<string, (answer: Answer | null) => void>()
  private readonly early = new Map<string, Answer>()

  // The signal is the waiting tool's: an abort ends the wait with no answer, as a human message does.
  wait(id: string, ms: number, signal?: AbortSignal): Promise<Answer | null> {
    const early = this.early.get(id)
    if (early !== undefined) {
      this.early.delete(id)
      return Promise.resolve(early)
    }
    if (signal?.aborted) return Promise.resolve(null)
    return new Promise((resolve) => {
      const onAbort = () => settle(null)
      const settle = (answer: Answer | null) => {
        clearTimeout(deadline)
        signal?.removeEventListener("abort", onAbort)
        this.waiting.delete(id)
        resolve(answer)
      }
      const deadline = setTimeout(() => settle(null), ms)
      signal?.addEventListener("abort", onAbort)
      this.waiting.set(id, settle)
    })
  }

  answer(id: string, answer: Answer): void {
    const settle = this.waiting.get(id)
    if (settle) settle(answer)
    else this.early.set(id, answer)
  }

  interrupt(): void {
    for (const settle of [...this.waiting.values()]) settle(null)
  }
}
