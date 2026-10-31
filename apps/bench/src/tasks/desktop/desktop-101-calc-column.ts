import type { Task } from "../../types"
import { check, int, mulberry32, sample, verdict } from "../helpers"
import { buildOds, closeTo, HARD_LIMITS, launchCalc, odsNumber, readOds, round2 } from "./hard-support"

const ITEMS = ["Tea", "Coffee", "Sugar", "Milk", "Bread", "Butter", "Cheese", "Apples", "Oranges", "Rice"]
const RATE = 0.15

const budget = (seed: number) => {
  const rng = mulberry32(seed)
  return sample(rng, ITEMS, int(rng, 5, 8)).map((item) => ({ item, cost: round2(2 + rng() * 38) }))
}

export const desktopCalcColumn: Task = {
  id: "desktop-101-calc-column",
  track: "desktop",
  kind: "real",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  prompt:
    "budget.ods is open in LibreOffice Calc. The Cost column is before tax. In column C, put each item's cost plus 15% tax, and in the row after the last item put the total of column C.",
  limits: HARD_LIMITS,
  setup: async (m, seed) => {
    const rows = budget(seed)
    await buildOds(
      m,
      { sheets: [{ name: "Budget", rows: [["Item", "Cost"], ...rows.map((row) => [row.item, row.cost])] }] },
      "budget.ods",
    )
    await launchCalc(m, "budget.ods")
  },
  oracle: async (m, seed) => {
    const rows = budget(seed)
    const taxed = rows.map((row) => round2(row.cost * (1 + RATE)))
    const total = round2(taxed.reduce((sum, value) => sum + value, 0))
    const last = rows.length + 1
    await buildOds(
      m,
      {
        sheets: [
          {
            name: "Budget",
            rows: [
              ["Item", "Cost", "With tax"],
              ...rows.map((row, index) => [row.item, row.cost, taxed[index]]),
              ["Total", null, { formula: `of:=SUM([.C2:.C${last}])`, value: total }],
            ],
          },
        ],
      },
      "budget.ods",
    )
  },
  check: async (m, seed) => {
    const rows = budget(seed)
    const sheet = (await readOds(m, "budget.ods")).sheets[0]
    const taxed = rows.map((row) => round2(row.cost * (1 + RATE)))
    const total = round2(taxed.reduce((sum, value) => sum + value, 0))
    const rowChecks = rows.map((row, index) => {
      const line = sheet?.rows[index + 1] ?? []
      return check(
        `taxed ${row.item}`,
        closeTo(odsNumber(line[2]), taxed[index] ?? 0),
        `C${index + 2} was ${JSON.stringify(line[2])}, expected ${taxed[index]}`,
      )
    })
    const totalRow = sheet?.rows[rows.length + 1] ?? []
    const totalCell = totalRow[2]
    return verdict([
      check(
        "kept the items",
        rows.every((row, index) => (sheet?.rows[index + 1]?.[0]?.text ?? "") === row.item),
        "item column changed",
      ),
      ...rowChecks,
      check(
        "total formula",
        Boolean(totalCell?.formula?.toUpperCase().includes("SUM")),
        `C${rows.length + 2} formula was ${JSON.stringify(totalCell?.formula)}`,
      ),
      check(
        "total value",
        closeTo(odsNumber(totalCell), total),
        `C${rows.length + 2} was ${JSON.stringify(totalCell?.value)}, expected ${total}`,
      ),
    ])
  },
}
