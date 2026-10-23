export class InputQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(task: () => Promise<T>, recover: () => Promise<void>): Promise<T> {
    const result = this.tail.then(task).catch(async (error: unknown) => {
      await recover().catch(() => undefined)
      throw error
    })
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
