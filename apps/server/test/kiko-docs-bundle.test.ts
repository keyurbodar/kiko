import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { generated } from "../scripts/gen-kiko-docs"

test("the bundled /kiko/ docs match apps/server/src/agent/kiko-docs", () => {
  expect(readFileSync(new URL("../src/agent/kiko-docs.gen.ts", import.meta.url), "utf8")).toBe(generated)
})
