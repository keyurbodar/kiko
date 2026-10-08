import type { Envelope, Origin } from "./envelope"

// Architecture section 25.3. Where a run's authority comes from, and how two sources combine. The
// room stamps every envelope, a message an agent sends inherits its chain's authority, and the trust
// gate reads the run's authority to decide whether an `external` call needs the human. Pure.

export type Authority = { origin: Origin; grant: readonly string[] }

export const HUMAN: Authority = { origin: "human", grant: [] }
export const AUTO: Authority = { origin: "auto", grant: [] }

/** An envelope stored before origins existed is `human` when a human wrote it, else `auto`. */
export function authorityOf(e: Pick<Envelope, "from" | "origin" | "grant">): Authority {
  const origin = e.origin ?? (e.from.kind === "human" ? "human" : "auto")
  return origin === "routine" ? { origin, grant: [...(e.grant ?? [])] } : { origin, grant: [] }
}

/**
 * Two sources in one run. A human anywhere in the chain gives the human's authority. Otherwise the
 * stricter wins: `auto` has no grant, and two routines keep only the tools both were granted.
 */
export function combine(a: Authority | null, b: Authority): Authority {
  if (!a) return b
  if (a.origin === "human" || b.origin === "human") return HUMAN
  if (a.origin === "auto" || b.origin === "auto") return AUTO
  return { origin: "routine", grant: a.grant.filter((t) => b.grant.includes(t)) }
}

export const authorityOfAll = (envelopes: readonly Pick<Envelope, "from" | "origin" | "grant">[]): Authority | null =>
  envelopes.reduce<Authority | null>((acc, e) => combine(acc, authorityOf(e)), null)

/** The envelope fields that carry `a`. */
export const stamp = (a: Authority): Pick<Envelope, "origin" | "grant"> => (a.origin === "routine" ? { origin: a.origin, grant: a.grant } : { origin: a.origin })
