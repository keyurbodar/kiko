/**
 * pi-durable's retry policy for a run: a transient model error (a rate limit, a 5xx, a dropped connection, a timeout)
 * is retried after a pause, up to this many times, so a hiccup does not end the human's turn. Anything else, such as a
 * bad key or a model the provider retired, ends the run at once. One table, because the typing line says the same
 * count the policy uses.
 */
export const RETRY = { enabled: true, maxRetries: 3, baseDelayMs: 2_000 } as const

/** What the typing line says while a retry waits: "retrying, 2 of 3". */
export const retrying = (attempt: number): string => `retrying, ${attempt} of ${RETRY.maxRetries}`
