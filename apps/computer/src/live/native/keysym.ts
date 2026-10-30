export function unicodeKeysym(codepoint: number): number {
  if ((codepoint >= 0x20 && codepoint <= 0x7e) || (codepoint >= 0xa0 && codepoint <= 0xff)) return codepoint
  return 0x01000000 + codepoint
}

export function spareKeycode(mapping: ArrayLike<number>, min: number, max: number, perKeycode: number): number | null {
  for (let keycode = max; keycode >= min; keycode--) {
    const start = (keycode - min) * perKeycode
    let free = true
    for (let level = 0; level < perKeycode; level++) {
      if (mapping[start + level] !== 0) {
        free = false
        break
      }
    }
    if (free) return keycode
  }
  return null
}
