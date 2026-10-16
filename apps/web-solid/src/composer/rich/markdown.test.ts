import { describe, expect, test } from "bun:test"
import type { RichText } from "@kiko/protocol"
import { parseRichText } from "../../../../server/src/room/rich-text"
import { docToMarkdown, markdownToDoc, nextOrderedMarker, type Json } from "./markdown"

const t = (text: string, ...marks: string[]): Json => ({ type: "text", text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) })
const p = (...content: Json[]): Json => ({ type: "paragraph", content })
const doc = (...content: Json[]): Json => ({ type: "doc", content })
const text = (value: string) => ({ t: "text", text: value }) as const
const para = (...children: object[]) => ({ t: "paragraph", children })

const cases: { name: string; doc: Json; markdown: string; rich: RichText }[] = [
  { name: "paragraph", doc: doc(p(t("hello there"))), markdown: "hello there", rich: [para(text("hello there"))] as RichText },
  { name: "heading", doc: doc({ type: "heading", attrs: { level: 2 }, content: [t("Title")] }), markdown: "## Title", rich: [{ t: "heading", level: 2, children: [text("Title")] }] as RichText },
  { name: "rule between paragraphs", doc: doc(p(t("a")), { type: "horizontalRule" }, p(t("b"))), markdown: "a\n\n---\n\nb", rich: [para(text("a")), { t: "rule" }, para(text("b"))] as RichText },
  { name: "two paragraphs", doc: doc(p(t("a")), p(t("b"))), markdown: "a\n\nb", rich: [para(text("a")), para(text("b"))] as RichText },
  { name: "hard break", doc: doc(p(t("a"), { type: "hardBreak" }, t("b"))), markdown: "a\nb", rich: [para(text("a"), text("\n"), text("b"))] as RichText },
  { name: "bold", doc: doc(p(t("bold", "bold"))), markdown: "**bold**", rich: [para({ t: "bold", children: [text("bold")] })] as RichText },
  { name: "italic", doc: doc(p(t("it", "italic"))), markdown: "*it*", rich: [para({ t: "italic", children: [text("it")] })] as RichText },
  { name: "strike", doc: doc(p(t("gone", "strike"))), markdown: "~~gone~~", rich: [para({ t: "strike", children: [text("gone")] })] as RichText },
  { name: "inline code", doc: doc(p(t("x = 1", "code"))), markdown: "`x = 1`", rich: [para({ t: "code", text: "x = 1" })] as RichText },
  {
    name: "link",
    doc: doc(p({ type: "text", text: "site", marks: [{ type: "link", attrs: { href: "https://example.com/a" } }] })),
    markdown: "[site](https://example.com/a)",
    rich: [para({ t: "link", href: "https://example.com/a", children: [text("site")] })] as RichText,
  },
  {
    name: "bold and italic",
    doc: doc(p(t("both", "bold", "italic"))),
    markdown: "***both***",
    rich: [para({ t: "italic", children: [{ t: "bold", children: [text("both")] }] })] as RichText,
  },
  {
    name: "marks around plain text",
    doc: doc(p(t("a "), t("b", "bold"), t(" c"))),
    markdown: "a **b** c",
    rich: [para(text("a "), { t: "bold", children: [text("b")] }, text(" c"))] as RichText,
  },
  {
    name: "whitespace stays outside a mark",
    doc: doc(p(t("a "), t("b ", "bold"), t("c"))),
    markdown: "a **b** c",
    rich: [para(text("a "), { t: "bold", children: [text("b")] }, text(" c"))] as RichText,
  },
  { name: "mention", doc: doc(p(t("hi "), { type: "mention", attrs: { slug: "ada" } })), markdown: "hi @ada", rich: [para(text("hi "), { t: "mention", slug: "ada" })] as RichText },
  {
    name: "bullet list",
    doc: doc({ type: "bulletList", content: [{ type: "listItem", attrs: { marker: "-" }, content: [p(t("one"))] }, { type: "listItem", attrs: { marker: "-" }, content: [p(t("two"))] }] }),
    markdown: "- one\n- two",
    rich: [{ t: "list", items: [[para(text("one"))], [para(text("two"))]] }] as RichText,
  },
  {
    name: "ordered list",
    doc: doc({ type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", attrs: { marker: "3." }, content: [p(t("x"))] }, { type: "listItem", attrs: { marker: "4." }, content: [p(t("y"))] }] }),
    markdown: "3. x\n4. y",
    rich: [{ t: "list", start: 3, items: [[para(text("x"))], [para(text("y"))]] }] as RichText,
  },
  {
    name: "nested list",
    doc: doc({
      type: "bulletList",
      content: [{ type: "listItem", attrs: { marker: "-" }, content: [p(t("a")), { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", attrs: { marker: "1." }, content: [p(t("b"))] }] }] }],
    }),
    markdown: "- a\n  1. b",
    rich: [{ t: "list", items: [[para(text("a")), { t: "list", start: 1, items: [[para(text("b"))]] }]] }] as RichText,
  },
  { name: "quote", doc: doc({ type: "blockquote", content: [p(t("said"))] }), markdown: "> said", rich: [{ t: "quote", children: [para(text("said"))] }] as RichText },
  {
    name: "quote of two lines",
    doc: doc({ type: "blockquote", content: [p(t("a"), { type: "hardBreak" }, t("b"))] }),
    markdown: "> a\n> b",
    rich: [{ t: "quote", children: [para(text("a"), text("\n"), text("b"))] }] as RichText,
  },
  {
    name: "code block",
    doc: doc({ type: "codeBlock", attrs: { language: "ts", fence: "```", close: "\n```" }, content: [t("const a = 1\n\nlet b")] }),
    markdown: "```ts\nconst a = 1\n\nlet b\n```",
    rich: [{ t: "code_block", lang: "ts", text: "const a = 1\n\nlet b" }] as RichText,
  },
  {
    name: "file reference",
    doc: doc(p(t("read "), { type: "fileRef", attrs: { path: "src/app.ts" } }, t(" please"))),
    markdown: "read [app.ts](/src/app.ts) please",
    rich: [para(text("read "), { t: "link", href: "/src/app.ts", children: [text("app.ts")] }, text(" please"))] as RichText,
  },
  {
    name: "file reference with a space and a parenthesis",
    doc: doc(p({ type: "fileRef", attrs: { path: "notes/Plan (v2).md" } })),
    markdown: "[Plan (v2).md](</notes/Plan (v2).md>)",
    rich: [para({ t: "link", href: "/notes/Plan (v2).md", children: [text("Plan (v2).md")] })] as RichText,
  },
  { name: "code block with fence inside", doc: doc({ type: "codeBlock", attrs: { language: "", fence: "````", close: "\n````" }, content: [t("```\nx\n```")] }), markdown: "````\n```\nx\n```\n````", rich: [{ t: "code_block", text: "```\nx\n```" }] as RichText },
]

describe("serializer", () => {
  for (const c of cases) {
    test(`${c.name}: markdown and the server's tree`, () => {
      const markdown = docToMarkdown(c.doc)
      expect(markdown).toBe(c.markdown)
      expect(parseRichText(markdown)).toEqual(c.rich)
    })
  }

  test("an empty document is empty text", () => {
    expect(docToMarkdown(doc(p()))).toBe("")
  })
})

describe("parser", () => {
  const known = (slug: string) => slug === "ada"
  for (const c of cases.filter((x) => x.name !== "whitespace stays outside a mark")) {
    test(`${c.name}: markdown back to the same document`, () => {
      const back = markdownToDoc(c.markdown, { isMention: known })
      expect(docToMarkdown(back)).toBe(c.markdown)
      expect(back).toEqual(normalize(c.doc))
    })
  }

  test("an unknown mention stays text", () => {
    expect(markdownToDoc("hi @nobody", { isMention: known })).toEqual(doc(p(t("hi @nobody"))))
  })

  test("text typed before this composer existed loads as it was", () => {
    for (const text of ["snake_case_name", "2 * 3 * 4", "a ~ b", "100% sure (really)", "# heading text", "path/to/file.ts:12"]) {
      expect(docToMarkdown(markdownToDoc(text))).toBe(text)
    }
  })

  test("a blank draft is one empty paragraph", () => {
    expect(markdownToDoc("")).toEqual(doc({ type: "paragraph" }))
  })
})

function normalize(value: Json): Json {
  const content = value.content?.map(normalize)
  const { marks, ...rest } = value
  return { ...rest, ...(content ? { content } : {}), ...(marks ? { marks: marks.map((m) => ({ type: m.type, ...(m.attrs ? { attrs: m.attrs } : {}) })) } : {}) }
}

describe("task lists", () => {
  const tasks = doc({
    type: "taskList",
    content: [
      { type: "taskItem", attrs: { checked: false }, content: [p(t("todo"))] },
      { type: "taskItem", attrs: { checked: true }, content: [p(t("done"))] },
    ],
  })

  test("a task list is written with its boxes", () => {
    expect(docToMarkdown(tasks)).toBe("- [ ] todo\n- [x] done")
  })

  test("the boxes read back as a task list", () => {
    expect(markdownToDoc("- [ ] todo\n- [x] done")).toEqual(tasks)
  })

  test("a list that mixes tasks and plain items stays a plain list", () => {
    const parsed = markdownToDoc("- [ ] todo\n- plain")
    expect(parsed.content?.[0]?.type).toBe("bulletList")
    expect(docToMarkdown(parsed)).toBe("- [ ] todo\n- plain")
  })

  test("a dash line is a rule, and a heading ends the paragraph above it", () => {
    expect(markdownToDoc("text\n# Head").content?.map((node) => node.type)).toEqual(["paragraph", "heading"])
    expect(markdownToDoc("---").content?.[0]?.type).toBe("horizontalRule")
  })
})

describe("list markers", () => {
  test("an ordered item keeps the delimiter and the number it was typed with", () => {
    expect(docToMarkdown(markdownToDoc("3) a\n4) b"))).toBe("3) a\n4) b")
  })

  test("repeated numbers are not recounted", () => {
    expect(docToMarkdown(markdownToDoc("1. a\n1. b\n1. c"))).toBe("1. a\n1. b\n1. c")
  })

  test("a bullet keeps its own marker", () => {
    expect(docToMarkdown(markdownToDoc("* a\n* b"))).toBe("* a\n* b")
  })

  test("the next ordered marker counts on, keeping the delimiter and padding", () => {
    expect(nextOrderedMarker("3)")).toBe("4)")
    expect(nextOrderedMarker("09.")).toBe("10.")
    expect(nextOrderedMarker("9.")).toBe("10.")
  })
})

test("an attachment chip survives a trip through markdown, so a restored draft keeps it", () => {
  const text = "see [notes.pdf](attachment:a1) and [site](https://example.com)"
  const doc = markdownToDoc(text)
  expect(doc.content?.[0]?.content?.[1]).toEqual({ type: "attachment", attrs: { id: "a1", name: "notes.pdf" } })
  expect(docToMarkdown(doc)).toBe(text)
})

test("a web link to another site and a protocol-relative link are not file references", () => {
  expect(markdownToDoc("[a](https://x.com/a) [b](//x.com/b)").content?.[0]?.content?.some((n) => n.type === "fileRef")).toBe(false)
})
