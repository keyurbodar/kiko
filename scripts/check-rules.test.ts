import { expect, test } from "bun:test"
import { RULES, scan } from "./check-rules.ts"

// One row per rule: the forms the matcher must catch, including the ones review F found missing.
// Add a row when a rule grows. SAMPLE_FILE is a real path inside every rule's roots.
const SAMPLE_FILE = "apps/server/src/router.ts"
const SAMPLES: Record<string, readonly string[]> = {
  "no-timer-in-do": ["setTimeout(work, 1)", "globalThis.setTimeout(work, 1)", "setTimeout (work, 1)", "setInterval (work, 1)"],
  "do-names": ['env.ROOM.idFromName("room")', 'env.ROOM.idFromString("id")', 'env.ROOM.getByName("room")'],
  "dev-guard": ['const dev = process.env.NODE_ENV === "development"', 'const dev = process.env["NODE_ENV"] === "development"', "const { NODE_ENV } = process.env"],
  egress: ["return fetch(url)", "return globalThis.fetch(url)", "return fetch (url)"],
  "live-server-data": ["const [data] = createResource(load)", "const [data] = createResource<Row[]>(() => id(), load)"],
  "sql-list-binds": ['ids.map(() => "?")', 'Array.from({ length: n }, () => "?")', '"?, ".repeat(n)', 'values.fill("?")'],
}

// The client rule scans the client's roots, so its samples stand in for a real client file.
const CLIENT_SAMPLE_FILE = "apps/web-solid/src/lib/api.ts"
const sampleFileFor = (ruleId: string) => (ruleId === "live-server-data" ? CLIENT_SAMPLE_FILE : SAMPLE_FILE)
// The reader stands in for the file the sample claims to be, so no real file is opened.
const read = (body: string, file = SAMPLE_FILE) => (path: string) => (path.endsWith(file) ? body : "")

for (const rule of RULES) {
  const samples = SAMPLES[rule.id] ?? []
  const file = sampleFileFor(rule.id)
  test(`${rule.id} has sample violations to check`, () => expect(samples.length).toBeGreaterThan(0))
  for (const [i, sample] of samples.entries()) {
    test(`${rule.id} reports sample ${i + 1}: ${sample}`, () => {
      expect(scan([rule], read(sample, file)).map((f) => f.at)).toEqual([`${file}:1`])
    })
    test(`${rule.id} accepts a reasoned allow on sample ${i + 1}`, () => {
      expect(scan([rule], read(`// check-rules: allow ${rule.id} this reason says why\n${sample}`, file))).toEqual([])
    })
    test(`${rule.id} refuses an empty reason on sample ${i + 1}`, () => {
      expect(scan([rule], read(`// check-rules: allow ${rule.id}\n${sample}`, file)).map((f) => f.at)).toEqual([`${file}:2`])
    })
  }
}
