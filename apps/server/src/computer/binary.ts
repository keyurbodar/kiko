import { IMAGE_REF, type ImagePart } from "@kiko/computer/frame"

type Bag = Record<string, unknown>

const isBag = (value: unknown): value is Bag => typeof value === "object" && value !== null

export function joinImages(value: unknown, parts: readonly ImagePart[], data: Uint8Array): unknown {
  let at = 0
  const slices = parts.map((part) => {
    const slice = data.subarray(at, at + part.length)
    at += part.length
    return slice
  })
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (!isBag(node)) return node
    const ref = node[IMAGE_REF]
    if (typeof ref === "number" && slices[ref] !== undefined) return slices[ref]
    const out: Bag = {}
    for (const [key, child] of Object.entries(node)) out[key] = walk(child)
    return out
  }
  return walk(value)
}
