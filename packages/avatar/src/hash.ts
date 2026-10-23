const utf8 = new TextEncoder()

function feed(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i]!, 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h
}

function finalize(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

export function normalizeName(name: string): string {
  return name.normalize("NFC").trim().toLowerCase()
}

export function seedState(name: string, normalize = true): number {
  const s = normalize ? normalizeName(name) : name
  return feed(1779033703 ^ s.length, utf8.encode(s))
}

export function stream(state: number, key: string): number {
  return finalize(feed(feed(state, Uint8Array.of(0xff)), utf8.encode(key))) / 4294967296
}

export function mulberry(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
