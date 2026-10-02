import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { generated } from "../scripts/gen-skills"
import { formatSkills, parseSkill, resolveSkills } from "../src/skills/registry"

const md = (front: string, body = "do the thing") => `---\n${front}\n---\n${body}`

test("a skill with no description is skipped with a warning, as in pi", () => {
  expect(parseSkill(md("name: haiku"), "haiku", "builtin")).toEqual({ warning: "skill haiku: description is required, skipped" })
})

test("the name defaults to the directory, and disable-model-invocation hides it from the prompt", () => {
  const s = parseSkill(md("description: secret\ndisable-model-invocation: true"), "quiet-one", "room")
  expect("warning" in s ? null : [s.name, s.disableModelInvocation]).toEqual(["quiet-one", true])
  expect(formatSkills(["warning" in s ? [] : [s]].flat())).toBeUndefined()
})

test("a room skill wins over a built-in one of the same name, and the list is escaped", () => {
  const room = parseSkill(md('name: haiku\ndescription: "room <haiku> & more"', "room body"), "haiku", "room")
  const builtin = parseSkill(md("name: haiku\ndescription: built in", "builtin body"), "haiku", "builtin")
  const all = resolveSkills(["warning" in room ? [] : [room]].flat(), ["warning" in builtin ? [] : [builtin]].flat())
  expect(all.map((s) => [s.source, s.body])).toEqual([["room", "room body"]])
  expect(formatSkills(all)).toContain("<description>room &lt;haiku&gt; &amp; more</description>")
})

test("the bundled built-in skills match apps/server/skills", () => {
  expect(readFileSync(new URL("../src/skills/builtin.gen.ts", import.meta.url), "utf8")).toBe(generated)
})
