import type { Task } from "../../types"
import { check, int, mulberry32, pick, verdict, writeJson, writeText } from "../helpers"
import { applicantLines, pdfDocument, type Applicant } from "../../../fixtures/browser/tasks/1xx-pdf"
import { BROWSER_OS, sameJson, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const FIRST = ["Ada", "Grace", "Linus", "Mira", "Omar", "Priya", "Ruth", "Sven", "Tomas", "Yuki"]
const LAST = ["Lovelace", "Hopper", "Torvalds", "Chen", "Haddad", "Nair", "Ginsburg", "Berg", "Novak", "Sato"]
const STREETS = ["Harbor Road", "Mill Lane", "Cedar Street", "Orchard Way", "Summit Drive"]
const CITIES = ["Springfield", "Riverton", "Fairview", "Lakeside"]
const COUNTRIES = ["Canada", "Portugal", "Japan", "Kenya"]
const OCCUPATIONS = ["teacher", "nurse", "carpenter", "analyst", "mechanic"]
const EMPLOYERS = ["Northwind School", "Harbor Clinic", "Cedar Works", "Summit Labs", "Mill Garage"]
const INCOMES = ["48000", "62000", "75000", "91000"]
const MARITAL = ["single", "married", "divorced"]

const scenario = (seed: number): { applicant: Applicant } => {
  const rng = mulberry32(seed)
  const first = pick(rng, FIRST)
  const last = pick(rng, LAST)
  return {
    applicant: {
      fullName: `${first} ${last}`,
      dob: `19${int(rng, 60, 99)}-${String(int(rng, 1, 12)).padStart(2, "0")}-${String(int(rng, 1, 28)).padStart(2, "0")}`,
      address: `${int(rng, 10, 980)} ${pick(rng, STREETS)}`,
      city: pick(rng, CITIES),
      postal: String(int(rng, 10000, 99999)),
      country: pick(rng, COUNTRIES),
      phone: `+1 555 ${int(rng, 100, 999)} ${int(rng, 1000, 9999)}`,
      occupation: pick(rng, OCCUPATIONS),
      employer: pick(rng, EMPLOYERS),
      annualIncome: pick(rng, INCOMES),
      dependents: String(int(rng, 0, 3)),
      maritalStatus: pick(rng, MARITAL),
    },
  }
}

export const formFromPdf: Task = {
  id: "browser-104-form-from-pdf",
  track: "browser",
  kind: "real",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Submit the residency application on the page in url.txt. Every value the form needs is in the PDF in the working directory, application.pdf.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    const { applicant } = scenario(seed)
    await writeJson(m, "request.json", {})
    await writeText(m, "application.pdf", pdfDocument(applicantLines(applicant)))
    await openPage(m, "browser-104-form-from-pdf", { applicant }, "/apply")
  },
  oracle: (m) => runBrowserOracle(m, "browser-104-form-from-pdf"),
  check: async (m, seed) => {
    const expected = scenario(seed).applicant
    const state = await browserState(m)
    return verdict([
      check("submitted", state?.application !== undefined, `application = ${JSON.stringify(state?.application)}`),
      sameJson("application", state?.application, expected),
    ])
  },
}
