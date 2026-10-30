export const PAGE_ROWS = 32
export const MAX_BYTES = 32 * 1024 * 1024
export const MAX_ROWS = 500_000
export const MAX_COLUMNS = 1024
export const MAX_CELL_CHARS = 16 * 1024

export type TextRequest =
  | { type: "open"; src: string; size: number; delimiter: "," | "\t" | null }
  | { type: "page"; index: number }

export type TextResult =
  | { type: "meta"; count: number; columns: number; complete: boolean; size: number }
  | { type: "page"; index: number; rows: string[][] }
  | { type: "error"; message: string }

export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n")
}
