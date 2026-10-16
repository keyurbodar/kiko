import { expect, test } from "bun:test"
import { Schema } from "@tiptap/pm/model"
import { chipFragment } from "./insert"

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
    fileRef: { group: "inline", inline: true, atom: true, attrs: { path: { default: "" } } },
  },
})
const names = (before: string | undefined) =>
  chipFragment(schema, [{ type: "fileRef", attrs: { path: "a.ts" } }, { type: "fileRef", attrs: { path: "b.ts" } }], before).content.map((n) => (n.isText ? JSON.stringify(n.text) : n.attrs.path))

test("a chip dropped at the start or after a space gets no extra space, and each chip is followed by one", () => {
  expect(names(undefined)).toEqual(["a.ts", '" "', "b.ts", '" "'])
  expect(names(" ")).toEqual(["a.ts", '" "', "b.ts", '" "'])
  expect(names("\n")).toEqual(["a.ts", '" "', "b.ts", '" "'])
})

test("a chip dropped against a word gets a space in front, so it does not glue to the word", () => {
  expect(names("d")).toEqual(['" "', "a.ts", '" "', "b.ts", '" "'])
})
