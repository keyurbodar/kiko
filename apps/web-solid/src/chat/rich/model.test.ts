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
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer" title="https://example.com" class="rich-link">go</a></p>',
  ],
  [
    "unsafe href is not a link",
    { t: "paragraph", children: [{ t: "link", href: "javascript:alert(1)", children: [t("go")] }] },
    "<p><span>go</span></p>",
  ],
  ["inline code that is a path is a file chip", { t: "paragraph", children: [{ t: "code", text: "/plan/route.md" }] }, '<p><file path="plan/route.md">route.md</file></p>'],
  ["inline code that is a name alone stays code", { t: "paragraph", children: [{ t: "code", text: "notes.md" }] }, '<p><code class="rich-inline-code">notes.md</code></p>'],
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
    '<p><a href="https://www.example.com/a" target="_blank" rel="noopener noreferrer" title="https://www.example.com/a" class="rich-link">example.com</a></p>',
  ],
  [
    "a link whose text is a sentence is a link",
    { t: "paragraph", children: [{ t: "link", href: "https://example.com", children: [t("read this, then go")] }] },
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer" title="https://example.com" class="rich-link">read this, then go</a></p>',
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
    "table in a scroller with alignment",
    { t: "table", align: ["right", null], head: [[t("a")], [t("b")]], rows: [[[t("1")], []]] },
    '<div class="rich-table-scroll"><table><thead><tr><th style="text-align:right">a</th><th>b</th></tr></thead><tbody><tr><td style="text-align:right">1</td><td></td></tr></tbody></table></div>',
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
