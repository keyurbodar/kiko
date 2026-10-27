function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return h >>> 0
}

function random(seed: string): () => number {
  let a = hash(seed)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round = (n: number) => Math.round(n * 100) / 100

export type Flake = { arm: string; hub: number }

export function flake(seed: string): Flake {
  const next = random(seed)
  const length = 7.5 + next() * 3
  const gap = next() < 0.5 ? 0 : 1.6
  const branches = 1 + Math.floor(next() * 3)
  const spread = 0.55 + next() * 0.45
  const tip = next()
  const parts = [`M0 ${-gap}L0 ${-round(length)}`]
  for (let i = 0; i < branches; i++) {
    const at = 0.3 + ((i + 0.4 + next() * 0.4) / branches) * 0.55
    const y = -length * at
    const size = 1.8 + next() * 2.4
    const dx = round(size * Math.sin(spread))
    const dy = round(size * Math.cos(spread))
    parts.push(`M${-dx} ${round(y - dy)}L0 ${round(y)}L${dx} ${round(y - dy)}`)
  }
  if (tip < 0.4) {
    const dx = round(1.6 * Math.sin(spread))
    const dy = round(1.6 * Math.cos(spread))
    parts.push(`M${-dx} ${round(-length + dy)}L0 ${round(-length)}L${dx} ${round(-length + dy)}`)
  }
  return { arm: parts.join(""), hub: next() < 0.5 ? 0 : 1.1 }
}
