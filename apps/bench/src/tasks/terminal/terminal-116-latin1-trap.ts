import type { Task } from "../../types"
import { bun, check, LIMITS, mulberry32, pick, python, readText, run, verdict, writeJson } from "../helpers"

const FIRST = ["Zoë", "José", "Ångström", "Müller", "Nuñez", "Ada", "Sven", "Mira"]
const CITIES = ["München", "Malmö", "São Paulo", "Zürich", "Dublin", "Oslo", "Cádiz", "Porto"]

const plan = (seed: number): { text: string; nonAscii: number } => {
  const rng = mulberry32(seed)
  const rows = Array.from({ length: 12 }, (_, index) => {
    const first = index === 3 ? "Ada" : pick(rng, FIRST)
    return { id: index + 1, first, city: pick(rng, CITIES) }
  })
  const text = ["id,name,city", ...rows.map((row) => `${row.id},${row.first},${row.city}`)].join("\n") + "\n"
  const nonAscii = rows.filter((row) => [...row.first].some((character) => character.charCodeAt(0) > 127)).length
  return { text, nonAscii }
}

const WRITE_LATIN1 = (text: string): string =>
  `await Bun.write("customers.csv", Buffer.from(${JSON.stringify(text)}, "latin1"))`

const CONVERT = `import codecs

with open("customers.csv", "rb") as handle:
    text = handle.read().decode("latin-1")
with open("customers-utf8.csv", "w", encoding="utf-8", newline="") as handle:
    handle.write(text)
rows = text.strip().split("\\n")[1:]
count = sum(1 for row in rows if any(ord(character) > 127 for character in row.split(",")[1]))
with open("nonascii.txt", "w", encoding="utf-8") as handle:
    handle.write(str(count) + "\\n")
`

export const latin1Trap: Task = {
  id: "terminal-116-latin1-trap",
  track: "terminal",
  os: ["linux", "macos"],
  needs: [],
  heldOut: false,
  kind: "edge",
  prompt:
    "customers.csv was exported in Latin-1 (ISO-8859-1). Write customers-utf8.csv with the same rows converted to UTF-8, and write the number of customers whose name has a non-ASCII character to nonascii.txt.",
  limits: LIMITS,
  setup: async (m, seed) => {
    await writeJson(m, "request.json", { encoding: "iso-8859-1" })
    const result = await bun(m, WRITE_LATIN1(plan(seed).text))
    if (result.code !== 0) throw new Error(`could not write the fixture: ${result.stderr || result.stdout}`)
  },
  oracle: async (m) => {
    await m.writeText(`${m.workdir}/convert.py`, CONVERT)
    const result = await run(m, [python(m), "convert.py"])
    await run(m, [python(m), "-c", 'import os; os.remove("convert.py")'])
    if (result.code !== 0) throw new Error(`conversion failed: ${result.stderr || result.stdout}`)
  },
  check: async (m, seed) => {
    const { text, nonAscii } = plan(seed)
    const expected = Buffer.from(text, "utf8").toString("base64")
    const actual = await bun(
      m,
      `const data = await Bun.file("customers-utf8.csv").arrayBuffer()
console.log(Buffer.from(data).toString("base64"))`,
    )
    const count = (await readText(m, "nonascii.txt"))?.trim() ?? ""
    return verdict([
      check(
        "converted to utf-8",
        actual.stdout.trim() === expected,
        "customers-utf8.csv is not the expected UTF-8 bytes",
      ),
      check(
        "non-ascii count",
        count === String(nonAscii),
        `nonascii.txt was ${JSON.stringify(count)}, expected ${nonAscii}`,
      ),
    ])
  },
}
