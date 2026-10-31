export type Native = {
  move(x: number, y: number): void
  button(slot: number, down: boolean, x: number, y: number): void
  wheel(pixels: number, horizontal: boolean): void
  key(code: string, key: string, down: boolean): void
  chord(code: string, mods: number): void
  text(value: string): void
  cursor(): { x: number; y: number } | null
  screen(): { width: number; height: number } | null
  release(): void
}

export function keyOf(code: string): string {
  return code.startsWith("Key") ? code.slice(3).toLowerCase() : code
}
