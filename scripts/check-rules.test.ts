import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { RULES, scan } from "./check-rules.ts"

const devGuard = RULES.filter((rule) => rule.id === "dev-guard")

test("the tree has no NODE_ENV read outside the dev guard module", () => {
  expect(scan(devGuard).map((f) => f.at)).toEqual([])
})

test("a NODE_ENV read in a route module is reported", () => {
  const read = (path: string) =>
    path.endsWith("apps/server/src/router.ts") ? 'const dev = process.env.NODE_ENV === "development"' : readFileSync(path, "utf8")
  expect(scan(devGuard, read).map((f) => f.at)).toEqual(["apps/server/src/router.ts:1"])
})

test("the dev guard module itself may read NODE_ENV", () => {
  const read = (path: string) =>
    path.endsWith("apps/server/src/lib/dev-guard.ts") ? 'export const DEV = process.env.NODE_ENV === "development"' : readFileSync(path, "utf8")
  expect(scan(devGuard, read).map((f) => f.at)).toEqual([])
})
