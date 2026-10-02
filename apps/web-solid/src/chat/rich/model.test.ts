import { describe, expect, test } from "bun:test"
import type { Block } from "@kiko/protocol"
import { richText } from "@kiko/protocol/fixtures"
import { block, richNodes, type RichNode } from "./model"

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Serializes the way the DOM would: text is escaped, code blocks stay opaque. */
function html(node: RichNode): string {
  if (node.kind === "text") return esc(node.text)
  if (node.kind === "code") return `<code-block lang="${node.lang ?? ""}">${esc(node.text)}</code-block>`
  const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${v}"`).join("")
  return `<${node.tag}${attrs}>${node.children.map(html).join("")}</${node.tag}>`
}

const t = (text: string) => ({ t: "text", text }) as const
const p = (text: string): Block => ({ t: "paragraph", children: [t(text)] })

const cases: [string, Block, string][] = [
  ["paragraph", p("hi"), "<p>hi</p>"],
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
  ["mention", { t: "paragraph", children: [{ t: "mention", slug: "bob" as never }] }, '<p><span class="rich-mention">@bob</span></p>'],
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

  test("the protocol fixture renders every node type", () => {
    const out = richNodes(richText).map(html).join("")
    for (const tag of ["<h2>", "<strong>", "<em>", "<s>", "<ol>", "<ul>", "<blockquote>", "<table>", "<code-block", "rich-mention"]) {
      expect(out).toContain(tag)
    }
    expect(out).not.toContain("<b>")
  })
})
