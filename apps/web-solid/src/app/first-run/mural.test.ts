import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { MURAL_FILE, muralFile } from "../../../scripts/gen-mural"

test("the welcome mural is drawn from the current avatar (run bun scripts/gen-mural.ts)", () => {
  expect(readFileSync(MURAL_FILE, "utf8")).toBe(muralFile())
})
