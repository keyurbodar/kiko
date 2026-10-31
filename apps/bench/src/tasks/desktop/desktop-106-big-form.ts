import type { Task } from "../../types"
import { check, int, mulberry32, pick, verdict } from "../helpers"
import { hardState, launchHard, LONG_LIMITS, runHardOracle } from "./hard-support"

const LABELS = [
  "Full name",
  "Email",
  "Phone",
  "Street",
  "City",
  "Postal code",
  "Country",
  "Company",
  "Job title",
  "Department",
  "Employee ID",
  "Start date",
  "Manager",
  "Cost centre",
  "Office",
  "Floor",
  "Desk",
  "Extension",
  "Mobile",
  "Emergency contact",
  "Emergency phone",
  "Bank account",
  "Tax ID",
  "Payroll group",
  "Work pattern",
  "Weekly hours",
  "Contract type",
  "Notice period",
  "Badge number",
  "Notes",
]

const WORDS = ["amber", "birch", "cedar", "delta", "ember", "flint", "grove", "harbor", "ivory", "juniper"]

const form = (seed: number) => {
  const rng = mulberry32(seed)
  return LABELS.map((label) => ({ label, value: `${pick(rng, WORDS)}-${int(rng, 100, 999)}` }))
}

export const desktopBigForm: Task = {
  id: "desktop-106-big-form",
  track: "desktop",
  kind: "long",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  prompt:
    "Fill every field of the employee form with the values in request.json and submit it. Do not leave any field empty.",
  limits: LONG_LIMITS,
  setup: async (m, seed) => {
    const fields = form(seed)
    await launchHard(m, "bigform", { fields }, { values: fields.map((field) => field.value) })
  },
  oracle: (m) => runHardOracle(m, "bigform"),
  check: async (m, seed) => {
    const expected = form(seed).map((field) => field.value)
    const submitted = (await hardState(m))?.submitted as string[] | undefined
    const checks = expected.map((value, index) =>
      check(
        `field ${index + 1}`,
        submitted?.[index] === value,
        `field ${index + 1} was ${JSON.stringify(submitted?.[index])}`,
      ),
    )
    return verdict([
      check("submitted", Array.isArray(submitted), `state.submitted = ${JSON.stringify(submitted)}`),
      ...checks,
    ])
  },
}
