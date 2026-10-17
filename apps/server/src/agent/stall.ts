import { boundedWait } from "@kiko/durable/bounded-wait"

export const FIRST_BYTE_MS = 120_000
export const STALL_MS = 90_000
/** The most one model request may take, start to end, even while chunks keep coming. */
const MAX_REQUEST_MS = 300_000

export class StallError extends Error {
  constructor() {
    super("the model stopped responding and the request timed out")
  }
}

export class TooSlowError extends Error {
  constructor() {
    super("the model was still answering after 5 minutes, so the request was stopped")
  }
}

/** Races a pending read or request against a quiet period, so a stalled provider ends the run instead of leaving it typing. */
export async function orStall<T>(work: Promise<T>, ms: number): Promise<T> {
  const wait = boundedWait(ms)
  try {
    return await Promise.race([work, wait.then((): never => { throw new StallError() })])
  } finally {
    wait.cancel()
  }
}

/** The same response, whose body errors when no chunk arrives for `ms`, or when the whole body takes longer than `totalMs`. */
export function guardStall(response: Response, ms: number, totalMs = MAX_REQUEST_MS, now: () => number = Date.now): Response {
  if (!response.body) return response
  const reader = response.body.getReader()
  const end = now() + totalMs
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const left = end - now()
        if (left <= 0) throw new TooSlowError()
        const next = await (left < ms ? orTooSlow(reader.read(), left) : orStall(reader.read(), ms))
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

async function orTooSlow<T>(work: Promise<T>, ms: number): Promise<T> {
  try {
    return await orStall(work, ms)
  } catch (error) {
    throw error instanceof StallError ? new TooSlowError() : error
  }
}
