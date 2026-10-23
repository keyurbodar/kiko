export type DiffLine = { kind: "same" | "add" | "del"; text: string }

const MAX_CELLS = 4_000_000

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before === "" ? [] : before.replace(/\n$/, "").split("\n")
  const b = after === "" ? [] : after.replace(/\n$/, "").split("\n")
  if (a.length * b.length > MAX_CELLS)
    return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))]
  const w = b.length + 1
  const lcs = new Uint32Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! })
      i++
      j++
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) out.push({ kind: "del", text: a[i++]! })
    else out.push({ kind: "add", text: b[j++]! })
  }
  while (i < a.length) out.push({ kind: "del", text: a[i++]! })
  while (j < b.length) out.push({ kind: "add", text: b[j++]! })
  return out
}
