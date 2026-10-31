import * as Schema from "effect/Schema"
import { boundedWait } from "@kiko/durable/bounded-wait"

export const FIRST_BYTE_MS = 120_000
export const STALL_MS = 90_000

class StallError extends Schema.TaggedError<StallError>()("StallError", {
  message: Schema.String,
}) {}

function aborting(signal: AbortSignal): Promise<never> & { cancel: () => void } {
  let stop = () => {}
  const promise = new Promise<never>((_, reject) => {
    const onAbort = () => reject(signal.reason)
    if (signal.aborted) onAbort()
    else {
      signal.addEventListener("abort", onAbort, { once: true })
      stop = () => signal.removeEventListener("abort", onAbort)
    }
  }) as Promise<never> & { cancel: () => void }
  promise.cancel = stop
  return promise
}

export async function orStall<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  const wait = boundedWait(ms)
  const abort = signal ? aborting(signal) : undefined
  const racers: Promise<T>[] = [
    work,
    wait.then((): never => {
      throw new StallError({ message: "the model stopped responding and the request timed out" })
    }),
  ]
  if (abort) racers.push(abort)
  try {
    return await Promise.race(racers)
  } finally {
    wait.cancel()
    abort?.cancel()
  }
}

export function guardStall(response: Response, ms: number): Response {
  if (!response.body) return response
  const reader = response.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await orStall(reader.read(), ms)
        if (next.done) controller.close()
        else controller.enqueue(next.value)
      } catch (error) {
        reader.cancel().catch(() => {})
        controller.error(error)
      }
    },
    cancel: (reason) => reader.cancel(reason),
  })
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}
