export type Section = "needs" | "working" | "pinned" | "chats"
export type Folded = Partial<Record<Section, boolean>>

const KEY = "kiko:sidebar-folded"
const SECTIONS: readonly Section[] = ["needs", "working", "pinned", "chats"]

export function parseFolded(raw: string | null): Folded {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== "object" || value === null) return {}
    const out: Folded = {}
    for (const key of SECTIONS) {
      const flag = (value as Record<string, unknown>)[key]
      if (typeof flag === "boolean") out[key] = flag
    }
    return out
  } catch {
    return {}
  }
}

export const serializeFolded = (folded: Folded): string => JSON.stringify(folded)

export const loadFolded = (): Folded => parseFolded(localStorage.getItem(KEY))

export const saveFolded = (folded: Folded): void => localStorage.setItem(KEY, serializeFolded(folded))
