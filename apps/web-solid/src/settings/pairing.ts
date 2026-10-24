import type { PairCode } from "../chat/computers"

const KEY = "kiko.pc.pairing"

type Saved = PairCode & { readonly known: readonly string[] }

function parse(raw: string | null): Saved | null {
  try {
    const value = JSON.parse(raw ?? "null") as Partial<Saved> | null
    if (!value || typeof value.code !== "string" || typeof value.url !== "string") return null
    if (typeof value.expiresAt !== "number" || !Array.isArray(value.known)) return null
    return { code: value.code, url: value.url, expiresAt: value.expiresAt, known: value.known }
  } catch {
    return null
  }
}

export function openPairing(raw: string | null, ids: readonly string[]): PairCode | null {
  const saved = parse(raw)
  if (!saved || ids.some((id) => !saved.known.includes(id))) return null
  return { code: saved.code, url: saved.url, expiresAt: saved.expiresAt }
}

export const readPairing = (ids: readonly string[]): PairCode | null => {
  const pair = openPairing(localStorage.getItem(KEY), ids)
  if (!pair) localStorage.removeItem(KEY)
  return pair
}

export const savePairing = (pair: PairCode, ids: readonly string[]): void =>
  localStorage.setItem(KEY, JSON.stringify({ ...pair, known: ids } satisfies Saved))

export const clearPairing = (): void => localStorage.removeItem(KEY)
