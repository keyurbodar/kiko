import { describe, expect, it } from "vitest"
import { columnLabel, filePreviewDelimiter, parseDelimited, parseDelimitedRows } from "./delimited"

const limits = { maxRows: 100, maxColumns: 3, maxCellLength: 5 }

describe("parseDelimited", () => {
  it("reads quoted fields with commas, doubled quotes and newlines", () => {
    const { rows, cut } = parseDelimited('name,note\n"Ada, A.","said ""hi""\nagain"\n', ",")
    expect(rows).toEqual([
      ["name", "note"],
      ["Ada, A.", 'said "hi"\nagain'],
    ])
    expect(cut).toBe(false)
  })

  it("keeps a trailing field and strips a byte order mark", () => {
    expect(parseDelimited("﻿a\tb\t", "\t").rows).toEqual([["a", "b", ""]])
  })

  it("reports a cut when it stops at the row limit", () => {
    const { rows, cut } = parseDelimited(`a\nb\nc\n`, ",", 2)
    expect(rows).toEqual([["a"], ["b"]])
    expect(cut).toBe(true)
  })
})

describe("parseDelimitedRows", () => {
  it("caps the columns and the cell length", () => {
    const { rows, cut } = parseDelimitedRows("a,b,c,d\nlonger than five,2,3\n", ",", limits)
    expect(rows[0]).toEqual(["a", "b", "c"])
    expect(rows[1]).toEqual(["longe", "2", "3"])
    expect(cut).toBe(true)
  })

  it("treats an unterminated quote as a cut preview", () => {
    expect(parseDelimitedRows('"open', ",", limits)).toEqual({ rows: [["open"]], cut: true })
  })

  it("reads tab separated rows and ignores blank trailing rows", () => {
    expect(parseDelimitedRows("a\tb\r\n1\t2\r\n", "\t", limits).rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })
})

describe("filePreviewDelimiter", () => {
  it("trusts a table type before the name", () => {
    expect(filePreviewDelimiter({ name: "data.txt", type: "text/csv" })).toBe(",")
    expect(filePreviewDelimiter({ name: "data.csv", type: "text/tab-separated-values" })).toBe("\t")
  })

  it("falls back to the extension", () => {
    expect(filePreviewDelimiter({ name: "data.csv", type: "" })).toBe(",")
    expect(filePreviewDelimiter({ name: "data.TSV", type: "application/octet-stream" })).toBe("\t")
    expect(filePreviewDelimiter({ name: "data.csv", type: "text/html" })).toBeNull()
    expect(filePreviewDelimiter({ name: "notes.md", type: "text/plain" })).toBeNull()
  })
})

describe("columnLabel", () => {
  it("names spreadsheet columns the way sheets do", () => {
    expect([0, 1, 25, 26, 27, 701].map(columnLabel)).toEqual(["A", "B", "Z", "AA", "AB", "ZZ"])
  })
})
