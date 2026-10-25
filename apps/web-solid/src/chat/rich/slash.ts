import type { Token } from "../../composer/tokens"

const SLASH = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=$|[\s.,!?;:)])/g

export type Piece = { text: string } | { token: Token }

export function slashPieces(text: string, resolve: (name: string) => Token | undefined): Piece[] {
  const out: Piece[] = []
  let last = 0
  for (const m of text.matchAll(SLASH)) {
    const token = resolve(m[2]!)
    if (!token) continue
    const start = m.index + m[1]!.length
    if (start > last) out.push({ text: text.slice(last, start) })
    out.push({ token })
    last = start + 1 + m[2]!.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
