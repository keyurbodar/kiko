const CELL_LIMIT = 2000
const DEFAULT_ROWS = 1000

export type Delimited = { rows: string[][]; cut: boolean }
export type DelimitedLimits = { maxRows: number; maxColumns: number; maxCellLength: number }

export function filePreviewDelimiter(file: { name: string; type: string }): "," | "\t" | null {
  const type = file.type.split(";", 1)[0]?.trim().toLowerCase()
  if (type === "text/csv") return ","
  if (type === "text/tab-separated-values") return "\t"
  if (type && type !== "text/plain" && type !== "application/octet-stream") return null
  if (/\.csv$/i.test(file.name)) return ","
  if (/\.tsv$/i.test(file.name)) return "\t"
  return null
}

export function parseDelimitedRows(
  text: string,
  separator: string,
  limits: DelimitedLimits = { maxRows: DEFAULT_ROWS, maxColumns: Number.POSITIVE_INFINITY, maxCellLength: CELL_LIMIT },
): Delimited {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  let cut = false
  const add = (c: string) => {
    if (field.length < limits.maxCellLength) field += c
    else cut = true
  }
  const endField = () => {
    if (row.length < limits.maxColumns) row.push(field)
    else cut = true
    field = ""
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
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
    else if (c === separator) endField()
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      endRow()
      if (rows.length >= limits.maxRows) return { rows, cut: cut || i < text.length - 1 }
    } else add(c)
  }
  if (field || row.length) endRow()
  return { rows, cut: cut || quoted }
}

export function parseDelimited(text: string, separator: "," | "\t", limit = DEFAULT_ROWS): Delimited {
  return parseDelimitedRows(text, separator, {
    maxRows: limit,
    maxColumns: Number.POSITIVE_INFINITY,
    maxCellLength: CELL_LIMIT,
  })
}

export function columnLabel(index: number): string {
  let label = ""
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label
  return label
}
