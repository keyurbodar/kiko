import type { Machine } from "../../types"
import { check, type Check } from "../helpers"
import { browserState } from "./support"

export const BROWSER_OS = ["linux", "macos"] as const
export const LONG_LIMITS = { turns: 60, seconds: 1200 } as const
export const SHORT_LIMITS = { turns: 30, seconds: 300 } as const

const answerValue = async (m: Machine): Promise<string | undefined> => {
  const state = await browserState(m)
  return (state?.answer as { value?: string } | undefined)?.value
}

export const answerCheck = async (m: Machine, expected: string): Promise<Check> => {
  const actual = await answerValue(m)
  return check("answer", actual === expected, `answer = ${JSON.stringify(actual)}, wanted ${expected}`)
}

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item as Record<string, unknown>)
            .sort()
            .map((key) => [key, (item as Record<string, unknown>)[key]]),
        )
      : item,
  )

export const sameJson = (name: string, actual: unknown, expected: unknown): Check =>
  check(name, stable(actual) === stable(expected), `${name} = ${JSON.stringify(actual)}`)

export const sorted = (values: readonly string[]): string[] => [...values].sort()
