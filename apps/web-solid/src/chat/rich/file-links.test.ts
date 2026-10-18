import { describe, expect, test } from "bun:test"
import { bareFileName, chipLabel, hrefFile, inlineCodeFile, isFileLabel, parentSuffixes, resolveFile, type FileTarget } from "./file-links"

describe("inline code that names a file", () => {
  const cases: [string, FileTarget | null][] = [
    ["/plan/route.md", { path: "plan/route.md" }],
    ["plan/route.md", { path: "plan/route.md" }],
    ["./notes.md", { path: "notes.md" }],
    ["../a/b.ts", { path: "a/b.ts" }],
    ["src/app.ts:42", { path: "src/app.ts", line: 42 }],
    ["src/app.ts:42:7", { path: "src/app.ts", line: 42, column: 7 }],
    ["notes.md:3", { path: "notes.md", line: 3 }],
    ["/scripts/run", { path: "scripts/run" }],
    ["data.pl:3", { path: "data.pl", line: 3 }],
    // No slash and no line: an identifier, not a path.
    ["notes.md", null],
    ["node.meta", null],
    ["origin/main", null],
    ["example.com/docs", null],
    ["localhost:3000", null],
    ["127.0.0.1:8080", null],
    ["models/glm-5.3", null],
    ["bun run test", null],
    ["", null],
  ]
  test.each(cases)("%p", (code, expected) => {
    expect(inlineCodeFile(code)).toEqual(expected)
  })
})

describe("a link href that names a file", () => {
  const cases: [string, FileTarget | null][] = [
    ["/plan/route.md", { path: "plan/route.md" }],
    ["/plan/route.md:3", { path: "plan/route.md", line: 3 }],
    ["plan/route.md:3:9", { path: "plan/route.md", line: 3, column: 9 }],
    ["notes.md", { path: "notes.md" }],
    ["notes.md:12", { path: "notes.md", line: 12 }],
    ["./a/b.md#L4", { path: "a/b.md", line: 4 }],
    ["file:///plan/a%20b.md#L4C2", { path: "plan/a b.md", line: 4, column: 2 }],
    ["<my notes.md>", { path: "my notes.md" }],
    ["run", { path: "run" }],
    ["Gemfile", { path: "Gemfile" }],
    ["notes/todo", { path: "notes/todo" }],
    ["/chat/settings", null],
    // A folder link: the form the app's own file chips write, and the one an agent is told to use.
    ["/src/", { path: "src" }],
    ["/home/recipes/", { path: "home/recipes" }],
    ["/etc", null],
    ["https://example.com/a.md", null],
    ["mailto:a@b.co", null],
    ["javascript:alert(1)", null],
    ["//evil.com/a.md", null],
    ["#top", null],
  ]
  test.each(cases)("%p", (href, expected) => {
    expect(hrefFile(href)).toEqual(expected)
  })
})

describe("a link's words that are only its file", () => {
  const cases: [string, FileTarget, boolean][] = [
    ["route.md", { path: "plan/route.md" }, true],
    ["plan/route.md", { path: "plan/route.md" }, true],
    ["/plan/route.md", { path: "plan/route.md" }, true],
    ["route.md:3", { path: "plan/route.md", line: 3 }, true],
    ["route.md:4", { path: "plan/route.md", line: 3 }, false],
    ["the plan", { path: "plan/route.md" }, false],
    ["oute.md", { path: "plan/route.md" }, false],
  ]
  test.each(cases)("%p", (label, file, expected) => {
    expect(isFileLabel(label, file)).toBe(expected)
  })
})

describe("chip labels", () => {
  test("a name used once has no suffix", () => {
    expect([...parentSuffixes(["a/x.md", "b/y.md"])]).toEqual([])
  })

  test("two files that share a name show their parents, two deep when there are two", () => {
    const s = parentSuffixes(["src/a/index.ts", "src/b/index.ts", "index.ts"])
    expect(s.get("src/a/index.ts")).toBe("src/a")
    expect(s.get("src/b/index.ts")).toBe("src/b")
    expect(s.has("index.ts")).toBe(false)
  })

  test("a deeper parent is used when the near one is shared", () => {
    const s = parentSuffixes(["x/lib/util.ts", "y/lib/util.ts", "z/util.ts"])
    expect(s.get("x/lib/util.ts")).toBe("x/lib")
    expect(s.get("y/lib/util.ts")).toBe("y/lib")
    expect(s.get("z/util.ts")).toBe("z")
  })

  test("name, suffix, and line", () => {
    expect(chipLabel({ path: "plan/route.md" })).toBe("route.md")
    expect(chipLabel({ path: "a/b/route.md", line: 3 }, "a/b")).toBe("route.md · a/b · L3")
    expect(chipLabel({ path: "route.md", line: 3, column: 2 })).toBe("route.md · L3:C2")
  })
})

describe("finding a named file in the chat", () => {
  const index = ["plan/route.md", "notes.md", "a/readme.md", "b/readme.md", "docs/plan/route.md"]
  const cases: [string, ReturnType<typeof resolveFile>][] = [
    ["plan/route.md", { kind: "file", path: "plan/route.md" }],
    ["notes.md", { kind: "file", path: "notes.md" }],
    ["route.md", { kind: "many" }],
    ["readme.md", { kind: "many" }],
    ["a/readme.md", { kind: "file", path: "a/readme.md" }],
    ["docs/plan/route.md", { kind: "file", path: "docs/plan/route.md" }],
    ["missing.md", { kind: "none" }],
    ["lan/route.md", { kind: "none" }],
  ]
  test.each(cases)("%p", (path, expected) => {
    expect(resolveFile(path, index)).toEqual(expected)
  })

  test("a bare name opens its one match in a folder", () => {
    expect(resolveFile("todo.md", ["work/todo.md"])).toEqual({ kind: "file", path: "work/todo.md" })
  })

  test("a folder resolves to the folder, not to a file that merely ends the same way", () => {
    const files = ["src/app.ts", "docs/guide.md"]
    // A path with anything below it is a folder, the rule the server's index uses.
    expect(resolveFile("src", files)).toEqual({ kind: "folder", path: "src" })
    expect(resolveFile("docs", files, ["docs"])).toEqual({ kind: "folder", path: "docs" })
    // An empty folder is only a folder when the room says so.
    expect(resolveFile("empty", files)).toEqual({ kind: "none" })
    expect(resolveFile("empty", files, ["empty"])).toEqual({ kind: "folder", path: "empty" })
  })
})

describe("inline code that is a bare file name", () => {
  const cases: [string, FileTarget | null][] = [
    ["panel.tsx", { path: "panel.tsx" }],
    ["mv6jrc7x-robinhood_*.csv", { path: "mv6jrc7x-robinhood_*.csv" }],
    ["mv6kqxbw-504-WFS Question Bank (Unit 1 to 4).pdf", { path: "mv6kqxbw-504-WFS Question Bank (Unit 1 to 4).pdf" }],
    ["mv6jrc7x-screenshot 1\u201313.png", { path: "mv6jrc7x-screenshot 1\u201313.png" }],
    ["panel.tsx:12", { path: "panel.tsx", line: 12 }],
    // A call, a property read or a path is code or a path, never a bare name.
    ["Promise.all", { path: "Promise.all" }],
    ["src/panel.tsx", null],
    [".env", null],
    ["bun run test", null],
    ["", null],
  ]
  test.each(cases)("%p", (code, expected) => {
    const found = bareFileName(code)
    if (expected === null) expect(found).toBeNull()
    else expect(found).toEqual(expected)
  })
})

describe("links and code that are not files", () => {
  test("a URL in inline code is not a file", () => {
    expect(inlineCodeFile("https://example.com/docs/index.html")).toBeNull()
  })

  test("a bare web address is not a file, but a file name still is", () => {
    expect(hrefFile("example.com")).toBeNull()
    expect(hrefFile("www.example.com/page")).toBeNull()
    expect(hrefFile("notes.md")).toEqual({ path: "notes.md" })
  })
})
