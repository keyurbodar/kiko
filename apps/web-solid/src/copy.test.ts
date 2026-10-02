import { expect, test } from "bun:test"
import { dict } from "@kiko/ui/i18n/en"

// Placeholders such as {{count}} name a parameter, so their case is not copy.
const withoutParams = (text: string) => text.replace(/\{\{[^}]*\}\}/g, "")

test("every interface string in the dictionary is lowercase", () => {
  const loud = Object.entries(dict)
    .filter(([, text]) => withoutParams(text) !== withoutParams(text).toLowerCase())
    .map(([key, text]) => `${key}: ${text}`)
  expect(loud).toEqual([])
})

test("the dictionary is not empty", () => {
  expect(Object.keys(dict).length).toBeGreaterThan(100)
})
