import { Fail } from "./log"

export class Deadline {
  readonly signal: AbortSignal
  private readonly endsAt: number

  constructor(
    readonly budgetMs: number,
    readonly controller = new AbortController(),
  ) {
    this.endsAt = Date.now() + budgetMs
    this.signal = controller.signal
  }

  remaining(): number {
    return Math.max(0, this.endsAt - Date.now())
  }

  get aborted(): boolean {
    return this.signal.aborted
  }

  get cancelled(): boolean {
    return this.signal.reason instanceof Fail && this.signal.reason.code === "cancelled"
  }

  child(minMs: number): Deadline {
    const child = new Deadline(Math.max(minMs, this.remaining()))
    this.signal.addEventListener("abort", () => child.controller.abort(this.signal.reason), { once: true })
    return child
  }
}

export function abortReason(signal: AbortSignal): Fail {
  const reason: unknown = signal.reason
  return reason instanceof Fail ? reason : new Fail({ code: "cancelled", message: "the call was cancelled" })
}
