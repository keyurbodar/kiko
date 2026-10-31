import type { Task } from "../../types"
import { check, int, mulberry32, pick, verdict, writeJson } from "../helpers"
import { BROWSER_OS, sameJson, SHORT_LIMITS } from "./browser-1xx-common"
import { browserState, openPage, runBrowserOracle } from "./support"

const TIMEZONES = ["Europe/Berlin", "America/New_York", "Asia/Tokyo"]
const WORDS = ["harbor", "meadow", "cobalt", "summit", "orchid", "pepper"]

const scenario = (seed: number) => {
  const rng = mulberry32(seed)
  const current = {
    email: `owner.${int(rng, 100, 999)}@old.example.com`,
    timezone: "UTC",
    digest: "off",
  }
  const next = {
    email: `owner.${int(rng, 100, 999)}@new.example.com`,
    timezone: pick(rng, TIMEZONES),
    digest: "on",
  }
  const password = `kiko-${int(rng, 1000, 9999)}-${pick(rng, WORDS)}`
  return { current, next, password }
}

export const reauthSettings: Task = {
  id: "browser-102-reauth-settings",
  track: "browser",
  kind: "real",
  os: [...BROWSER_OS],
  needs: ["chrome"],
  heldOut: false,
  prompt:
    "Update the account settings on the page in url.txt to the new email address, timezone and weekly digest in request.json. The site will ask you to confirm the change; the password you need is in request.json too.",
  limits: SHORT_LIMITS,
  setup: async (m, seed) => {
    const data = scenario(seed)
    await writeJson(m, "request.json", { ...data.next, password: data.password })
    await openPage(m, "browser-102-reauth-settings", { current: data.current, password: data.password }, "/settings")
  },
  oracle: (m) => runBrowserOracle(m, "browser-102-reauth-settings"),
  check: async (m, seed) => {
    const expected = scenario(seed)
    const state = await browserState(m)
    const settings = state?.settings as Record<string, unknown> | undefined
    return verdict([
      check(
        "re-authenticated",
        state?.reauthRequired === true,
        `reauthRequired = ${JSON.stringify(state?.reauthRequired)}`,
      ),
      sameJson("settings", settings, expected.next),
      check(
        "password not saved",
        settings !== undefined && !("password" in settings),
        `settings = ${JSON.stringify(settings)}`,
      ),
    ])
  },
}
