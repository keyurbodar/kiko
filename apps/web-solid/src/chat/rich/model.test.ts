import { describe, expect, test } from "bun:test"
import type { Block } from "@kiko/protocol"
import { richText } from "@kiko/protocol/fixtures"
import { block, richNodes, type RichNode } from "./model"

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Serializes the way the DOM would: text is escaped, code blocks stay opaque. */
function html(node: RichNode): string {
  if (node.kind === "text") return esc(node.text)
  if (node.kind === "code") return `<code-block lang="${node.lang ?? ""}">${esc(node.text)}</code-block>`
  if (node.kind === "mention") return `<mention slug="${node.slug}">`
  if (node.kind === "masked") return `<masked href="${node.href}">${node.children.map(html).join("")}</masked>`
  if (node.kind === "file") return `<file path="${node.file.path}"${node.file.line ? ` line="${node.file.line}"` : ""}>${esc(node.label)}</file>`
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${v}"`).join("")
  return `<${node.tag}${attrs}>${node.children.map(html).join("")}</${node.tag}>`
}

const t = (text: string) => ({ t: "text", text }) as const
const p = (text: string): Block => ({ t: "paragraph", children: [t(text)] })

const cases: [string, Block, string][] = [
  ["paragraph", p("hi"), "<p>hi</p>"],
  ["a hard break is a br and a soft break stays text", { t: "paragraph", children: [t("a\nb"), t("\n"), t("c")] }, "<p>a\nb<br></br>c</p>"],
  ["heading level", { t: "heading", level: 3, children: [t("x")] }, "<h3>x</h3>"],
  [
    "nested inline",
    { t: "paragraph", children: [{ t: "bold", children: [t("a"), { t: "italic", children: [t("b")] }] }, { t: "strike", children: [t("c")] }] },
    "<p><strong>a<em>b</em></strong><s>c</s></p>",
  ],
  ["inline code is text", { t: "paragraph", children: [{ t: "code", text: "<b>" }] }, '<p><code class="rich-inline-code">&lt;b&gt;</code></p>'],
  [
    "link opens in a new tab safely",
    { t: "paragraph", children: [{ t: "link", href: "https://example.com", children: [t("go")] }] },
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer" class="rich-link">go</a></p>',
  ],
  [
    "unsafe href is not a link",
    { t: "paragraph", children: [{ t: "link", href: "javascript:alert(1)", children: [t("go")] }] },
    "<p><span>go</span></p>",
  ],
  ["inline code that is a path is a file chip", { t: "paragraph", children: [{ t: "code", text: "/plan/route.md" }] }, '<p><file path="plan/route.md">route.md</file></p>'],
  ["inline code that is a bare file name is a file the chat may resolve", { t: "paragraph", children: [{ t: "code", text: "notes.md" }] }, '<p><file path="notes.md">notes.md</file></p>'],
  [
    "a file link named by its file is the chip alone",
    { t: "paragraph", children: [{ t: "link", href: "/plan/route.md:3", children: [t("route.md")] }] },
    '<p><file path="plan/route.md" line="3">route.md · L3</file></p>',
  ],
  [
    "a file link with its own words keeps them before the chip",
    { t: "paragraph", children: [{ t: "link", href: "/plan/route.md:3", children: [t("the plan")] }] },
    '<p><span>the plan <file path="plan/route.md" line="3">route.md · L3</file></span></p>',
  ],
  [
    "a route link is plain text",
    { t: "paragraph", children: [{ t: "link", href: "/chat/settings", children: [t("settings")] }] },
    "<p><span>settings</span></p>",
  ],
  [
    "a link whose text names another host is masked",
    { t: "paragraph", children: [{ t: "link", href: "https://evil.example/x", children: [t("docs.example.com")] }] },
    '<p><masked href="https://evil.example/x">docs.example.com</masked></p>',
  ],
  [
    "a link whose sentence names another host by its address is masked",
    { t: "paragraph", children: [{ t: "link", href: "https://evil.example/x", children: [t("see https://github.com/acme for docs")] }] },
    '<p><masked href="https://evil.example/x">see https://github.com/acme for docs</masked></p>',
  ],
  [
    "a link whose text names its own host is a link",
    { t: "paragraph", children: [{ t: "link", href: "https://www.example.com/a", children: [t("example.com")] }] },
    '<p><a href="https://www.example.com/a" target="_blank" rel="noopener noreferrer" class="rich-link">example.com</a></p>',
  ],
  [
    "a link whose text is a sentence is a link",
    { t: "paragraph", children: [{ t: "link", href: "https://example.com", children: [t("read this, then go")] }] },
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer" class="rich-link">read this, then go</a></p>',
  ],
  ["mention", { t: "paragraph", children: [{ t: "mention", slug: "bob" as never }] }, '<p><mention slug="bob"></p>'],
  ["unordered list", { t: "list", items: [[p("a")], [p("b")]] }, "<ul><li><p>a</p></li><li><p>b</p></li></ul>"],
  ["ordered list from 1", { t: "list", start: 1, items: [[p("a")]] }, "<ol><li><p>a</p></li></ol>"],
  ["ordered list from 3", { t: "list", start: 3, items: [[p("a")]] }, '<ol start="3"><li><p>a</p></li></ol>'],
  [
    "nested list",
    { t: "list", items: [[p("a"), { t: "list", items: [[p("b")]] }]] },
    "<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>",
  ],
  ["quote", { t: "quote", children: [p("q")] }, "<blockquote><p>q</p></blockquote>"],
  ["code block", { t: "code_block", lang: "ts", text: "a < b" }, '<code-block lang="ts">a &lt; b</code-block>'],
  ["raw html stays text", { t: "code_block", text: "<b>x</b>" }, '<code-block lang="">&lt;b&gt;x&lt;/b&gt;</code-block>'],
  [
    "table in a scroller; alignment is left whatever the source says, as t3code's cell rule sets it",
    { t: "table", align: ["right", null], head: [[t("a")], [t("b")]], rows: [[[t("1")], []]] },
    '<div class="rich-table-scroll"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td></td></tr></tbody></table></div>',
  ],
]

describe("rich text tree to DOM", () => {

  test.each(cases)("%s", (_name, node, expected) => {
    expect(html(block(node))).toBe(expected)
  })

  test("two chips that share a name show their folders, and a fenced block is never a chip", () => {
    const out = richNodes([
      { t: "paragraph", children: [{ t: "code", text: "a/x/index.ts" }, t(" "), { t: "code", text: "b/x/index.ts" }, t(" "), { t: "code", text: "c/y.ts" }] },
      { t: "code_block", text: "a/x/index.ts" },
    ])
      .map(html)
      .join("")
    expect(out).toBe(
      '<p><file path="a/x/index.ts">index.ts · a/x</file> <file path="b/x/index.ts">index.ts · b/x</file> <file path="c/y.ts">y.ts</file></p><code-block lang="">a/x/index.ts</code-block>',
    )
  })

  test("the protocol fixture renders every node type", () => {
    const out = richNodes(richText).map(html).join("")
    for (const tag of ["<h2>", "<strong>", "<em>", "<s>", "<ol>", "<ul>", "<blockquote>", "<table>", "<code-block", "<mention"]) {
      expect(out).toContain(tag)
    }
    expect(out).not.toContain("<b>")
  })
})

describe("inline code that may name a chat file", () => {
  const code = (text: string) => richNodes([{ t: "paragraph", children: [{ t: "code", text }] }] as unknown as Block[])[0]

  test("a bare name becomes a file that stays code unless the chat has it", () => {
    expect(code("panel.tsx")).toEqual({ kind: "el", tag: "p", attrs: {}, children: [{ kind: "file", file: { path: "panel.tsx" }, label: "panel.tsx", bare: true }] })
  })

  test("a name with spaces and punctuation keeps every character", () => {
    const node = code("mv6kqxbw-504-WFS Question Bank (Unit 1 to 4).pdf") as { children: RichNode[] }
    expect(node.children[0]).toMatchObject({ kind: "file", file: { path: "mv6kqxbw-504-WFS Question Bank (Unit 1 to 4).pdf" }, bare: true })
  })

  test("an identifier that is not a file name stays inline code", () => {
    const node = code("Promise.all") as { children: RichNode[] }
    expect(node.children[0]).toMatchObject({ kind: "file", bare: true })
    expect(code("bun run test")).toEqual({ kind: "el", tag: "p", attrs: {}, children: [{ kind: "el", tag: "code", attrs: { class: "rich-inline-code" }, children: [{ kind: "text", text: "bun run test" }] }] })
  })
})

describe("task list items", () => {
  test("a task item's list item is marked, and a plain item is not", () => {
    const task = block({ t: "list", items: [[{ t: "paragraph", children: [{ t: "text", text: "☑ " }, { t: "text", text: "done" }] }]] })
    const plain = block({ t: "list", items: [[{ t: "paragraph", children: [{ t: "text", text: "done" }] }]] })
    expect(task.kind === "el" && task.children[0]?.kind === "el" && task.children[0].attrs.class).toBe("task-list-item")
    expect(plain.kind === "el" && plain.children[0]?.kind === "el" && plain.children[0].attrs.class).toBeUndefined()
  })
})

describe("loose lists", () => {
  test("a loose list carries the class that gives its paragraphs the block gap; a tight one does not", () => {
    const loose = block({ t: "list", loose: true, items: [[p("a")], [p("b")]] })
    const tight = block({ t: "list", items: [[p("a")], [p("b")]] })
    expect(loose.kind === "el" && loose.attrs.class).toBe("rich-loose")
    expect(tight.kind === "el" && tight.attrs.class).toBeUndefined()
  })
})

describe("table copy", () => {
  // The source cells keep their marks: bold, code and a link, plus a pipe that must be escaped.
  const table = (): Extract<Block, { t: "table" }> => ({
    t: "table",
    align: ["left", "right"],
    head: [[t("name")], [t("value")]],
    rows: [
      [[{ t: "bold", children: [t("bold")] }], [{ t: "code", text: "a|b" }]],
      [[{ t: "link", href: "https://example.com", children: [t("site")] }], [t('say "hi", now')]],
    ],
  })

  test("Copy as Markdown writes the cells with their marks, escaped pipes and the alignment row", () => {
    const node = block(table())
    expect(node.kind === "el" && node.copy?.markdown).toBe(
      ["| name | value |", "| --- | ---: |", "| **bold** | `a\\|b` |", "| [site](https://example.com) | say \"hi\", now |"].join("\n"),
    )
  })

  test("Copy as CSV writes plain cell text, quoted where a comma or quote needs it", () => {
    const node = block(table())
    expect(node.kind === "el" && node.copy?.csv).toBe(["name,value", "bold,a|b", "site,\"say \"\"hi\"\", now\""].join("\n"))
  })
})
