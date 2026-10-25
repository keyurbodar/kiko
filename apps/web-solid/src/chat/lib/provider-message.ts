const STATUS = /^\s*\d{3}\b[\s:.-]*/
const MAX = 240

function messageIn(value: unknown): string | undefined {
  if (typeof value === "string") return undefined
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  for (const key of ["error", "detail"]) {
    const inner = messageIn(record[key])
    if (inner) return inner
  }
  return typeof record.message === "string" && record.message.trim() ? record.message : undefined
}

function fromJson(text: string): string | undefined {
  const start = text.indexOf("{")
  if (start < 0) return undefined
  try {
    return messageIn(JSON.parse(text.slice(start)))
  } catch {
    return undefined
  }
}

function sentence(text: string): string {
  const words = text.replace(/\s+/g, " ").trim()
  const short = words.length > MAX ? `${words.slice(0, MAX - 1).trimEnd()}…` : words
  return /[.!?…]$/.test(short) ? short : `${short}.`
}

export function providerMessage(detail: string | undefined): string | undefined {
  const text = detail?.trim()
  if (!text || text.startsWith("<")) return undefined
  const found = fromJson(text) ?? (text.includes("{") ? undefined : text.replace(STATUS, ""))
  return found?.trim() ? sentence(found) : undefined
}
