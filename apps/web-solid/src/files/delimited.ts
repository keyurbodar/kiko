export const CELL_LIMIT = 2000

export type Delimited = { rows: string[][]; cut: boolean }

export function parseDelimited(text: string, separator: "," | "\t", limit = 1000): Delimited {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  let cut = false
  const add = (c: string) => {
    if (field.length < CELL_LIMIT) field += c
    else cut = true
  }
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        add('"')
        i++
      } else if (c === '"') quoted = false
      else add(c)
    } else if (c === '"' && field === "") quoted = true
    else if (c === separator) {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      if (rows.length >= limit) return { rows, cut }
    } else add(c)
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return { rows, cut }
}
