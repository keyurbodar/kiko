import { boundedWait } from "@kiko/durable/bounded-wait"

export const FIRST_BYTE_MS = 120_000
export const STALL_MS = 90_000

class StallError extends Error {
  constructor() {
    super("the model stopped responding and the request timed out")
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

/** The same response, whose body errors when no chunk arrives for `ms`. Long answers are normal, so a body that keeps sending is never cut. */
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
