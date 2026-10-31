import type { Task } from "../../types"
import { check, int, mulberry32, sample, verdict } from "../helpers"
import { buildOds, closeTo, LONG_LIMITS, launchCalcBlank, odsNumber, readOds } from "./hard-support"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const SKUS = ["K-100", "K-220", "K-340", "K-410", "K-520", "K-630", "K-740", "K-850"]

const report = (seed: number) => {
  const rng = mulberry32(seed)
  const months = sample(rng, MONTHS, 6).sort((left, right) => MONTHS.indexOf(left) - MONTHS.indexOf(right))
  const sales = months.map((month) => ({ month, revenue: int(rng, 100, 900) }))
  const stock = sample(rng, SKUS, 5).map((sku) => ({ sku, units: int(rng, 10, 200) }))
  const totalRevenue = sales.reduce((sum, row) => sum + row.revenue, 0)
  const totalUnits = stock.reduce((sum, row) => sum + row.units, 0)
  return { sales, stock, totalRevenue, totalUnits }
}

const csv = (header: readonly string[], rows: readonly (readonly (string | number)[])[]): string =>
  [header.join(","), ...rows.map((row) => row.join(","))].join("\n") + "\n"

const hasRow = (rows: readonly (readonly any[])[], first: string, second: number): boolean =>
  rows.some((row) => (row[0]?.text ?? "") === first && closeTo(odsNumber(row[1]), second))

const hasNumber = (rows: readonly (readonly any[])[], expected: number): boolean =>
  rows.some((row) => row.some((cell) => closeTo(odsNumber(cell), expected)))

export const desktopReport: Task = {
  id: "desktop-105-report-chart",
  track: "desktop",
  kind: "long",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  prompt:
    "sales.csv and stock.csv are in the work folder. Build report.ods with three sheets named Sales, Stock and Summary. Put each CSV into its own sheet. In Summary show the total revenue and the total units, and add a chart of revenue by month.",
  limits: LONG_LIMITS,
  setup: async (m, seed) => {
    const data = report(seed)
    await m.writeText(
      `${m.workdir}/sales.csv`,
      csv(
        ["Month", "Revenue"],
        data.sales.map((row) => [row.month, row.revenue]),
      ),
    )
    await m.writeText(
      `${m.workdir}/stock.csv`,
      csv(
        ["SKU", "Units"],
        data.stock.map((row) => [row.sku, row.units]),
      ),
    )
    await launchCalcBlank(m)
  },
  oracle: async (m, seed) => {
    const data = report(seed)
    await buildOds(
      m,
      {
        sheets: [
          { name: "Sales", rows: [["Month", "Revenue"], ...data.sales.map((row) => [row.month, row.revenue])] },
          { name: "Stock", rows: [["SKU", "Units"], ...data.stock.map((row) => [row.sku, row.units])] },
          {
            name: "Summary",
            rows: [
              ["Metric", "Value"],
              ["Total revenue", data.totalRevenue],
              ["Total units", data.totalUnits],
              [{ chart: { title: "Revenue by month", range: "Sales.B2:B7" } }],
            ],
          },
        ],
      },
      "report.ods",
    )
  },
  check: async (m, seed) => {
    const data = report(seed)
    const ods = await readOds(m, "report.ods")
    const find = (name: string) => ods.sheets.find((sheet) => sheet.name.toLowerCase() === name.toLowerCase())
    const sales = find("Sales")
    const stock = find("Stock")
    const summary = find("Summary")
    const summaryRows = summary?.rows ?? []
    return verdict([
      check("three sheets", Boolean(sales && stock && summary), `sheets: ${ods.sheets.map((s) => s.name).join(", ")}`),
      check(
        "sales rows",
        data.sales.every((row) => hasRow(sales?.rows ?? [], row.month, row.revenue)),
        "Sales is missing a month or a revenue value",
      ),
      check(
        "stock rows",
        data.stock.every((row) => hasRow(stock?.rows ?? [], row.sku, row.units)),
        "Stock is missing a SKU or a units value",
      ),
      check("total revenue", hasNumber(summaryRows, data.totalRevenue), `expected ${data.totalRevenue} in Summary`),
      check("total units", hasNumber(summaryRows, data.totalUnits), `expected ${data.totalUnits} in Summary`),
      check("chart", ods.charts >= 1, `found ${ods.charts} charts`),
    ])
  },
}
