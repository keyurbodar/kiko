import type { ScriptBinding } from "@kiko/durable/cloudflare"

export const DEFAULT_SCRIPT = "kiko"

export type Script = {
  readonly name: string
  readonly tag: string | null
  readonly modified: string
  readonly bindings: ReadonlyArray<ScriptBinding>
}

export type Scan =
  | { readonly _tag: "Mine"; readonly script: Script }
  | { readonly _tag: "Other"; readonly script: Script; readonly ownerId: string }
  | { readonly _tag: "Unclaimed"; readonly script: Script }
  | { readonly _tag: "Foreign"; readonly script: Script }

export type Target = Exclude<Scan, { _tag: "Foreign" }> | { readonly _tag: "Empty"; readonly nameTaken: boolean }

export type Pointer = { readonly v: 1; readonly url: string; readonly accountId: string; readonly script: string }

export const isKikoName = (name: string): boolean => name === DEFAULT_SCRIPT || name.startsWith(`${DEFAULT_SCRIPT}-`)

export function classify(script: Script, sub: string): Scan {
  if (!script.bindings.some((binding) => binding.type === "durable_object_namespace"))
    return { _tag: "Foreign", script }
  const owner = script.bindings.find((binding) => binding.name === "OWNER_ID")
  if (owner?.type !== "plain_text" || !owner.text) return { _tag: "Unclaimed", script }
  return owner.text === sub ? { _tag: "Mine", script } : { _tag: "Other", script, ownerId: owner.text }
}

const newestFirst = (pointed: (scan: Scan) => boolean) => (a: Scan, b: Scan) =>
  Number(pointed(b)) - Number(pointed(a)) || b.script.modified.localeCompare(a.script.modified)

export function targetOf(scans: ReadonlyArray<Scan>, pointed: (scan: Scan) => boolean): Target {
  const order = newestFirst(pointed)
  const mine = scans.filter((scan) => scan._tag === "Mine").sort(order)[0]
  if (mine) return mine
  const claimable = scans.filter((scan) => scan._tag === "Other" || scan._tag === "Unclaimed").sort(order)[0]
  if (claimable?._tag === "Other" || claimable?._tag === "Unclaimed") return claimable
  return { _tag: "Empty", nameTaken: scans.some((scan) => scan.script.name === DEFAULT_SCRIPT) }
}

export const maskEmail = (email: string): string => {
  const at = email.lastIndexOf("@")
  return at < 1 ? "•••" : `${email[0]}•••${email.slice(at)}`
}
