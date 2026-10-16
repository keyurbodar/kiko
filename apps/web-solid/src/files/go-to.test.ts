import { describe, expect, test } from "bun:test"
import { fileHits, listFiles, rankFiles } from "./go-to"

const hits = fileHits(["src/app/route.ts", "docs/routes.md", "notes/todo.md", "readme.md", "src/rota/x.ts"], ["a/route-notes.md", "todo.txt"])
const paths = (list: { path: string }[]) => list.map((h) => h.path)

describe("rankFiles", () => {
  test("a name hit outranks a path hit", () => {
    expect(paths(rankFiles(hits, "route", []))).toEqual(["src/app/route.ts", "docs/routes.md", "home/a/route-notes.md"])
    expect(paths(rankFiles(hits, "app", []))).toEqual(["src/app/route.ts"])
    const mixed = fileHits(["route/a.ts", "b/route.ts"], [])
    expect(paths(rankFiles(mixed, "route", []))).toEqual(["b/route.ts", "route/a.ts"])
  })

  test("an exact name beats a prefix beats a substring", () => {
    const list = fileHits(["x/my-todo.md", "x/todo.md", "x/todo-list.md"], [])
    expect(paths(rankFiles(list, "todo.md", []))).toEqual(["x/todo.md", "x/my-todo.md", "x/todo-list.md"])
    expect(paths(rankFiles(list, "todo", []))).toEqual(["x/todo.md", "x/todo-list.md", "x/my-todo.md"])
  })

  test("letters in order find a file, after the real hits", () => {
    expect(paths(rankFiles(hits, "rdme", []))).toEqual(["readme.md"])
    expect(paths(rankFiles(hits, "zzz", []))).toEqual([])
  })

  test("every word of the query must hit", () => {
    expect(paths(rankFiles(hits, "notes md", []))).toEqual(["home/a/route-notes.md", "notes/todo.md"])
  })

  test("a home file matches on the path the person sees, not the home prefix", () => {
    expect(paths(rankFiles(hits, "home", []))).toEqual([])
    expect(paths(rankFiles(hits, "a/route", []))[0]).toBe("home/a/route-notes.md")
  })

  test("an empty query lists recent files first, newest first, then the rest by path", () => {
    const got = paths(rankFiles(hits, "", ["home/todo.txt", "readme.md"]))
    expect(got.slice(0, 2)).toEqual(["home/todo.txt", "readme.md"])
    expect(got.slice(2)).toEqual(["home/a/route-notes.md", "docs/routes.md", "notes/todo.md", "src/app/route.ts", "src/rota/x.ts"])
  })

  test("it returns at most the limit", () => {
    const many = fileHits(Array.from({ length: 200 }, (_, i) => `f${i}.md`), [])
    expect(rankFiles(many, "", [])).toHaveLength(50)
    expect(rankFiles(many, "f1", [], 5)).toHaveLength(5)
  })
})

describe("listFiles", () => {
  test("recent files lead under Recent when the query is empty", () => {
    const rows = listFiles(hits, "", ["home/todo.txt"])
    expect(rows[0]).toMatchObject({ group: "Recent", hit: { path: "home/todo.txt" } })
    expect(rows.slice(1).map((r) => r.group)).toEqual(["This chat", "This chat", "This chat", "This chat", "This chat", "Home"])
  })

  test("with a query a heading appears once, the best match's heading first", () => {
    const rows = listFiles(hits, "notes", [])
    expect(rows.map((r) => [r.group, r.hit.path])).toEqual([
      ["Home", "home/a/route-notes.md"],
      ["This chat", "notes/todo.md"],
    ])
    const flipped = listFiles(fileHits(["x/a-notes.md", "notes.md"], ["z-notes.md"]), "notes.md", [])
    expect(flipped.map((r) => r.group)).toEqual(["This chat", "This chat", "Home"])
    const interleaved = listFiles(fileHits(["x/a-notes.md"], ["notes.md"]), "notes.md", [])
    expect(interleaved.map((r) => r.group)).toEqual(["Home", "This chat"])
  })
})
