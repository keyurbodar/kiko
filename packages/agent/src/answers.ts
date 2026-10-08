// Architecture section 7.5. An `ask` waits inside the asker's run. The room pushes the teammate's
// answer here the moment it is stored, and a human message ends every wait at once (section 7.8).
// Waits live in memory: after an eviction the replayed tool reads the stored answer from the room.

/** A teammate's answer, and whether the run that wrote it read outside content. */
export type Answer = { text: string; tainted: boolean }

export class AnswerWaiters {
  private readonly waiting = new Map<string, (answer: Answer | null) => void>()
  /** Answers pushed before their tool started waiting, which happens when the teammate is fast. */
  private readonly early = new Map<string, Answer>()

  /** The answer to ask `id`, or null when `ms` passes or the human writes. */
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

  /** The human wrote: every waiting tool stops and the run answers them first. */
  interrupt(): void {
    for (const settle of [...this.waiting.values()]) settle(null)
  }
}
