import { deepStrictEqual, ok, strictEqual } from "node:assert/strict"

export const assertions: { ok: typeof ok; strictEqual: typeof strictEqual; deepEqual: typeof deepStrictEqual } = { ok, strictEqual, deepEqual: deepStrictEqual }
