const NAMED: Readonly<Record<string, string>> = {
  enter: "\r",
  return: "\r",
  tab: "\t",
  esc: "\x1b",
  escape: "\x1b",
  space: " ",
  backspace: "\x7f",
  delete: "\x1b[3~",
  insert: "\x1b[2~",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  f1: "\x1bOP",
  f2: "\x1bOQ",
  f3: "\x1bOR",
  f4: "\x1bOS",
  f5: "\x1b[15~",
  f6: "\x1b[17~",
  f7: "\x1b[18~",
  f8: "\x1b[19~",
  f9: "\x1b[20~",
  f10: "\x1b[21~",
  f11: "\x1b[23~",
  f12: "\x1b[24~",
}

const ARROWS: Readonly<Record<string, string>> = {
  up: "A",
  down: "B",
  right: "C",
  left: "D",
  home: "H",
  end: "F",
}

const TILDE: Readonly<Record<string, number>> = {
  insert: 2,
  delete: 3,
  pageup: 5,
  pagedown: 6,
}

const CTRL_SYMBOLS: Readonly<Record<string, string>> = {
  "@": "\x00",
  " ": "\x00",
  "[": "\x1b",
  "\\": "\x1c",
  "]": "\x1d",
  "^": "\x1e",
  _: "\x1f",
  "?": "\x7f",
}

export const KEY_NAMES = [...Object.keys(NAMED), "ctrl+a to ctrl+z", "ctrl+up", "ctrl+left", "alt+x", "shift+tab"]

export function keyBytes(chord: string): string | null {
  const parts = chord.split("+")
  const original = parts.pop() ?? ""
  const name = original.toLowerCase()
  if (!name) return null
  const mods = parts.map((part) => part.toLowerCase())
  if (new Set(mods).size !== mods.length) return null
  if (mods.some((mod) => !["ctrl", "control", "alt", "shift"].includes(mod))) return null
  const ctrl = mods.includes("ctrl") || mods.includes("control")
  const alt = mods.includes("alt")
  const shift = mods.includes("shift")
  const base = modifierKey(name, ctrl, shift) ?? plainKey(name, original, shift)
  if (base === null) return null
  return alt ? `\x1b${base}` : base
}

function modifierKey(name: string, ctrl: boolean, shift: boolean): string | null {
  if (ctrl) {
    const arrow = ARROWS[name]
    if (arrow) return `\x1b[1;5${arrow}`
    const tilde = TILDE[name]
    if (tilde) return `\x1b[${tilde};5~`
    if (/^[a-z]$/.test(name)) return String.fromCharCode(name.charCodeAt(0) & 0x1f)
    if (CTRL_SYMBOLS[name] !== undefined) return CTRL_SYMBOLS[name]
    return null
  }
  if (shift && name === "tab") return "\x1b[Z"
  if (shift && /^[a-z]$/.test(name)) return name.toUpperCase()
  return null
}

function plainKey(name: string, original: string, shift: boolean): string | null {
  if (shift && name === "tab") return "\x1b[Z"
  if (NAMED[name] !== undefined) return NAMED[name]
  if (original.length === 1) return original
  return null
}
