import type { Envelope, Origin } from "./envelope"

export type Authority = { origin: Origin; grant: readonly string[] }

export const HUMAN: Authority = { origin: "human", grant: [] }
export const AUTO: Authority = { origin: "auto", grant: [] }

export function authorityOf(e: Pick<Envelope, "from" | "origin" | "grant">): Authority {
  const origin = e.origin ?? (e.from.kind === "human" ? "human" : "auto")
  return origin === "routine" ? { origin, grant: [...(e.grant ?? [])] } : { origin, grant: [] }
}

export function combine(a: Authority | null, b: Authority): Authority {
  if (!a) return b
  if (a.origin === "human" || b.origin === "human") return HUMAN
  if (a.origin === "auto" || b.origin === "auto") return AUTO
  return { origin: "routine", grant: a.grant.filter((t) => b.grant.includes(t)) }
}

export const authorityOfAll = (envelopes: readonly Pick<Envelope, "from" | "origin" | "grant">[]): Authority | null =>
  envelopes.reduce<Authority | null>((acc, e) => combine(acc, authorityOf(e)), null)

export const stamp = (a: Authority): Pick<Envelope, "origin" | "grant"> => (a.origin === "routine" ? { origin: a.origin, grant: a.grant } : { origin: a.origin })
