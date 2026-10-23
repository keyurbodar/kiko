export function describe(names: string[], max: number): string {
  if (names.length === 0) return ""

  const head = names.slice(0, Math.max(1, max))
  const rest = names.length - head.length

  if (rest > 0) {
    return `${head.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"} are typing`
  }
  if (head.length === 1) return `${head[0]} is typing`

  return `${head.slice(0, -1).join(", ")} and ${head[head.length - 1]} are typing`
}
