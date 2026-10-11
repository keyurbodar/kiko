export type Answer = string

export class AnswerWaiters {
  private readonly waiting = new Map<string, (answer: Answer | null) => void>()
  private readonly early = new Map<string, Answer>()

  wait(id: string, ms: number): Promise<Answer | null> {
    const early = this.early.get(id)
    if (early !== undefined) {
      this.early.delete(id)
      return Promise.resolve(early)
    }
    return new Promise((resolve) => {
      const settle = (answer: Answer | null) => {
        clearTimeout(deadline)
        this.waiting.delete(id)
        resolve(answer)
      }
      const deadline = setTimeout(() => settle(null), ms)
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
