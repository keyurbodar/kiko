import type { DriverCall } from "@kiko/computer/driver"
import { Deadline } from "../deadline"
import type { Driver } from "../driver"

const CALL_MS = 15_000

export type Tools = {
  has(name: string): boolean
  call(name: string, args: Record<string, unknown>): Promise<unknown>
}

export function driverTools(driver: () => Driver | null): Tools {
  const names = () => new Set((driver()?.state()?.desktop?.tools ?? []).map((tool) => tool.name))
  return {
    has: (name) => names().has(name),
    call(name, args) {
      const current = driver()
      if (!current) return Promise.reject(new Error("the kiko app is not running on this machine"))
      if (!names().has(name)) return Promise.reject(new Error(`this computer has no ${name} tool`))
      const call: DriverCall = { method: "desktop.call", params: { name, args } }
      return current.call(call, new Deadline(CALL_MS))
    },
  }
}

export function toolValue(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null
  const result = value as { structuredContent?: unknown; content?: unknown }
  if (typeof result.structuredContent === "object" && result.structuredContent !== null)
    return result.structuredContent as Record<string, unknown>
  if (!Array.isArray(result.content)) return null
  for (const item of result.content) {
    if (typeof item !== "object" || item === null) continue
    const text = (item as { text?: unknown }).text
    if (typeof text !== "string") continue
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>
    } catch {}
  }
  return null
}
