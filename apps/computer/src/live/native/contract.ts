export type Native = {
  move(x: number, y: number): void
  button(slot: number, down: boolean, x: number, y: number): void
  wheel(steps: number, horizontal: boolean): void
  key(code: string, key: string, down: boolean): void
  text(value: string): void
  cursor(): { x: number; y: number } | null
  screen(): { width: number; height: number } | null
  release(): void
}
