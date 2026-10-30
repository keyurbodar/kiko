import { describe, expect, it } from "vitest"
import { parseNumbering, parseRelationships } from "./office-docx"
import { parseDocx } from "./office-docx"

const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Trip plan</w:t></w:r></w:p>
    <w:p><w:r><w:t>Two nights in </w:t></w:r><w:r><w:t>Lisbon</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Book hotel</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Pack bags</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>City</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Nights</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Lisbon</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:p><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p>
  </w:body>
</w:document>`

const relationshipsXml = `<Relationships>
  <Relationship Id="rId5" Target="media/photo.png" Type="image"/>
</Relationships>`

const numberingXml = `<w:numbering xmlns:w="w">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`

describe("parseDocx", () => {
  it("reads headings, paragraphs, lists, tables and images", () => {
    const blocks = parseDocx(documentXml, parseRelationships(relationshipsXml, "word/"), parseNumbering(numberingXml))
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "Trip plan" },
      { kind: "paragraph", text: "Two nights in Lisbon" },
      { kind: "list", ordered: true, items: ["Book hotel", "Pack bags"] },
      {
        kind: "table",
        rows: [
          ["City", "Nights"],
          ["Lisbon", "2"],
        ],
      },
      { kind: "image", path: "word/media/photo.png" },
    ])
  })

  it("keeps bullets unordered when the numbering says so", () => {
    const xml = `<w:document xmlns:w="w"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>One</w:t></w:r></w:p></w:body></w:document>`
    const numbering = parseNumbering(
      `<w:numbering><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    )
    expect(parseDocx(xml, new Map(), numbering)).toEqual([{ kind: "list", ordered: false, items: ["One"] }])
  })

  it("resolves relationship targets against the document folder", () => {
    expect(parseRelationships(relationshipsXml, "word/").get("rId5")).toBe("word/media/photo.png")
    expect(parseRelationships(`<Relationship Id="r1" Target="../media/x.gif"/>`, "word/").get("r1")).toBe("media/x.gif")
  })
})
