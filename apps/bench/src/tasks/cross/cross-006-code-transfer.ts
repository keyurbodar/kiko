import type { Task } from "../../types"
import { bun, check, LIMITS, mulberry32, readText, verdict, writeJson, writeText } from "../helpers"
import { crossAppState, launchCrossApp, runCrossAppOracle } from "./support"

const hex = (rng: () => number, length: number): string =>
  Array.from({ length }, () => Math.floor(rng() * 16).toString(16)).join("")

const plan = (seed: number): { code: string; value: string; vault: Record<string, string> } => {
  const rng = mulberry32(seed)
  const code = `TRX-${hex(rng, 10)}`
  const value = `vault-${hex(rng, 12)}`
  const vault: Record<string, string> = { [`vault/${code}.txt`]: `${value}\n` }
  for (let index = 0; index < 10; index += 1) {
    vault[`vault/TRX-${hex(rng, 10)}.txt`] = `vault-${hex(rng, 12)}\n`
  }
  return { code, value, vault }
}

export const codeTransfer: Task = {
  id: "cross-006-code-transfer",
  track: "cross",
  os: ["linux"],
  needs: ["display"],
  heldOut: false,
  kind: "edge",
  prompt:
    "The Transfer Console window shows a one-time code. Find the matching file in vault/ and enter its value in the window, then save.",
  limits: LIMITS,
  setup: async (m, seed) => {
    const { code, vault } = plan(seed)
    await writeJson(m, "request.json", { app: "Transfer Console" })
    for (const [path, text] of Object.entries(vault)) await writeText(m, path, text)
    await launchCrossApp(m, "transfer", { code })
  },
  oracle: async (m, seed) => {
    const { value } = plan(seed)
    const state = await crossAppState(m)
    const code = String(state?.code ?? "")
    const fromVault = (await readText(m, `vault/${code}.txt`))?.trim()
    if (fromVault !== value) throw new Error(`vault held ${JSON.stringify(fromVault)}`)
    await bun(m, `await Bun.write("oracle-value.txt", ${JSON.stringify(value)})`)
    await runCrossAppOracle(m, "transfer")
  },
  check: async (m, seed) => {
    const { value, vault } = plan(seed)
    const state = await crossAppState(m)
    const intact = await Promise.all(
      Object.entries(vault).map(async ([path, text]) => ({ path, ok: (await readText(m, path)) === text })),
    )
    return verdict([
      check("value saved", state?.value === value, `app state was ${JSON.stringify(state?.value)}`),
      check(
        "vault untouched",
        intact.every((entry) => entry.ok),
        `changed vault files: ${JSON.stringify(intact.filter((entry) => !entry.ok).map((entry) => entry.path))}`,
      ),
    ])
  },
}
