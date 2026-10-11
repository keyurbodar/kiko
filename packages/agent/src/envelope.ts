export type Origin = "human" | "routine" | "auto"

export type Sender = { kind: "human" } | { kind: "agent"; slug: string } | { kind: "system"; reason: string }

export type Envelope = {
  id: string
  from: Sender
  body: string
  replyTo?: string
  hop: number
  rootId: string
  origin?: Origin
  seq: number
}

export const originOf = (e: Pick<Envelope, "from" | "origin">): Origin => e.origin ?? (e.from.kind === "human" ? "human" : "auto")

/** A run joined by the human counts as the human's. Otherwise any automatic input makes it automatic. */
export function joinOrigin(a: Origin | null, b: Origin): Origin {
  if (!a) return b
  if (a === "human" || b === "human") return "human"
  if (a === "auto" || b === "auto") return "auto"
  return "routine"
}

export const originOfAll = (envelopes: readonly Pick<Envelope, "from" | "origin">[]): Origin | null =>
  envelopes.reduce<Origin | null>((acc, e) => joinOrigin(acc, originOf(e)), null)
