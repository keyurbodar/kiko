import { expect, test } from "bun:test"
import { parseRichText } from "../src/room/rich-text"

const text = (s: string) => ({ t: "text", text: s })
const p = (...children: unknown[]) => ({ t: "paragraph", children })

const cases: [string, string, unknown][] = [
	["paragraph", "hello world", [p(text("hello world"))]],
	["marks", "**b** *i* ~~s~~ `c`", [p({ t: "bold", children: [text("b")] }, text(" "), { t: "italic", children: [text("i")] }, text(" "), { t: "strike", children: [text("s")] }, text(" "), { t: "code", text: "c" })]],
	["heading", "## hi", [{ t: "heading", level: 2, children: [text("hi")] }]],
	["bullets", "- a\n- b", [{ t: "list", items: [[p(text("a"))], [p(text("b"))]] }]],
	["ordered start", "3. a\n4. b", [{ t: "list", start: 3, items: [[p(text("a"))], [p(text("b"))]] }]],
	["nested list", "- a\n  - b", [{ t: "list", items: [[p(text("a")), { t: "list", items: [[p(text("b"))]] }]] }]],
	["quote", "> hi", [{ t: "quote", children: [p(text("hi"))] }]],
	["code with lang", "```ts\nlet x = 1\n```", [{ t: "code_block", lang: "ts", text: "let x = 1" }]],
	["code no lang", "```\nx\n```", [{ t: "code_block", text: "x" }]],
	["table", "| a | b |\n|:-|-:|\n| 1 | **2** |", [{ t: "table", align: ["left", "right"], head: [[text("a")], [text("b")]], rows: [[[text("1")], [{ t: "bold", children: [text("2")] }]]] }]],
	["https link", "[x](https://a.com)", [p({ t: "link", href: "https://a.com", children: [text("x")] })]],
	["mailto link", "[x](mailto:a@b.co)", [p({ t: "link", href: "mailto:a@b.co", children: [text("x")] })]],
	["javascript link drops href", "[x](javascript:alert(1))", [p(text("x"))]],
	["data link drops href", "[x](data:text/html,hi)", [p(text("x"))]],
	["relative link drops href", "[x](/etc)", [p(text("x"))]],
	["mention", "hey @coder and @all!", [p(text("hey "), { t: "mention", slug: "coder" }, text(" and "), { t: "mention", slug: "all" }, text("!"))]],
	["email autolinks, not a mention", "a@b.co", [p({ t: "link", href: "mailto:a@b.co", children: [text("a@b.co")] })]],
	["mention not in code", "`@coder`", [p({ t: "code", text: "@coder" })]],
	["raw html block", '<div onclick="x()">hi</div>', [p(text('<div onclick="x()">hi</div>'))]],
	["raw html inline", "a <b>x</b> b", [p(text("a "), text("<b>"), text("x"), text("</b>"), text(" b"))]],
	["image becomes alt text", "![cat](https://a.com/c.png)", [p(text("cat"))]],
	["hr dropped", "a\n\n---\n\nb", [p(text("a")), p(text("b"))]],
	["empty", "", []],
]

test.each(cases)("%s", (_name, input, expected) => {
	expect(parseRichText(input) as unknown).toEqual(expected)
})

const NODE_TYPES = new Set(["paragraph", "heading", "list", "quote", "code_block", "table", "text", "bold", "italic", "strike", "code", "link", "mention"])

test("no input yields a node type outside the protocol", () => {
	const seen = new Set<string>()
	const walk = (n: unknown): void => {
		if (Array.isArray(n)) return n.forEach(walk)
		if (n && typeof n === "object") {
			const o = n as Record<string, unknown>
			if (typeof o.t === "string") seen.add(o.t)
			Object.values(o).forEach(walk)
		}
	}
	for (const [, input] of cases) walk(parseRichText(input))
	for (const t of seen) expect(NODE_TYPES.has(t)).toBe(true)
	expect(seen.has("html")).toBe(false)
})
