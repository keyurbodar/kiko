import { Fail } from "../log"

export type Chord = { mods: string[]; code: string; key: string }

const MODS = new Map<string, string>([
  ["cmd", "MetaLeft"],
  ["command", "MetaLeft"],
  ["meta", "MetaLeft"],
  ["super", "MetaLeft"],
  ["win", "MetaLeft"],
  ["ctrl", "ControlLeft"],
  ["control", "ControlLeft"],
  ["alt", "AltLeft"],
  ["option", "AltLeft"],
  ["opt", "AltLeft"],
  ["shift", "ShiftLeft"],
])

const PUNCT = new Map<string, readonly [string, string]>([
  ["-", ["Minus", "-"]],
  ["=", ["Equal", "="]],
  ["[", ["BracketLeft", "["]],
  ["]", ["BracketRight", "]"]],
  ["\\", ["Backslash", "\\"]],
  [";", ["Semicolon", ";"]],
  ["'", ["Quote", "'"]],
  ["`", ["Backquote", "`"]],
  [",", ["Comma", ","]],
  [".", ["Period", "."]],
  ["/", ["Slash", "/"]],
])

const NAMED = new Map<string, readonly [string, string]>([
  ["enter", ["Enter", "Enter"]],
  ["return", ["Enter", "Enter"]],
  ["esc", ["Escape", "Escape"]],
  ["escape", ["Escape", "Escape"]],
  ["tab", ["Tab", "Tab"]],
  ["space", ["Space", " "]],
  ["backspace", ["Backspace", "Backspace"]],
  ["delete", ["Delete", "Delete"]],
  ["del", ["Delete", "Delete"]],
  ["up", ["ArrowUp", "ArrowUp"]],
  ["arrowup", ["ArrowUp", "ArrowUp"]],
  ["down", ["ArrowDown", "ArrowDown"]],
  ["arrowdown", ["ArrowDown", "ArrowDown"]],
  ["left", ["ArrowLeft", "ArrowLeft"]],
  ["arrowleft", ["ArrowLeft", "ArrowLeft"]],
  ["right", ["ArrowRight", "ArrowRight"]],
  ["arrowright", ["ArrowRight", "ArrowRight"]],
  ["home", ["Home", "Home"]],
  ["end", ["End", "End"]],
  ["pageup", ["PageUp", "PageUp"]],
  ["pagedown", ["PageDown", "PageDown"]],
  ["insert", ["Insert", "Insert"]],
])

for (let n = 1; n <= 24; n += 1) NAMED.set(`f${n}`, [`F${n}`, `F${n}`])

function unknown(name: string): Fail {
  return new Fail({
    code: "failed",
    message: `unknown key ${name}; use names like cmd+l, ctrl+shift+t, enter, pagedown`,
  })
}

function keyOf(name: string): { code: string; key: string } | null {
  const named = NAMED.get(name)
  if (named) return { code: named[0], key: named[1] }
  if (/^[a-z]$/.test(name)) return { code: `Key${name.toUpperCase()}`, key: name }
  if (/^[0-9]$/.test(name)) return { code: `Digit${name}`, key: name }
  const punct = PUNCT.get(name)
  if (punct) return { code: punct[0], key: punct[1] }
  return null
}

function withShift(mods: readonly string[]): string[] {
  return mods.includes("ShiftLeft") ? [...mods] : [...mods, "ShiftLeft"]
}

function plus(mods: readonly string[]): Chord {
  return { mods: withShift(mods), code: "Equal", key: "+" }
}

function parseChord(token: string): Chord {
  if (token === "+" || token.toLowerCase() === "plus") return plus([])
  const parts = token
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  const last = parts.at(-1)
  if (!last) throw unknown(token)
  const mods: string[] = []
  for (const part of parts.slice(0, -1)) {
    const mod = MODS.get(part)
    if (!mod) throw unknown(part)
    mods.push(mod)
  }
  if (last === "plus") return plus(mods)
  const key = keyOf(last)
  if (!key) throw unknown(last)
  return { mods, code: key.code, key: key.key }
}

export function parseKeys(keys: string): Chord[] {
  const tokens = keys.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) throw unknown("")
  return tokens.map(parseChord)
}
