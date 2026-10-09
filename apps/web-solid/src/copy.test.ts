import { expect, test } from "bun:test"
import { dict } from "@yuki/ui/i18n/en"

// Placeholders such as {{count}} name a parameter, so their case is not copy.
const withoutParams = (text: string) => text.replace(/\{\{[^}]*\}\}/g, "").trim()

// A string that opens with a parameter, a digit, a symbol, or an @slug has no first word to capitalize.
const opensWithWord = (text: string) => /^[A-Za-z]/.test(text.trimStart())

// Words that are rightly all capitals.
const ACRONYMS = new Set(["AI", "API", "ID", "JSON", "MCP", "OS", "PDF", "URL"])

test("every interface string in the dictionary is sentence case", () => {
  const lower = Object.entries(dict)
    .filter(([, text]) => opensWithWord(text) && !/^[A-Z]/.test(text.trimStart()))
    .map(([key, text]) => `${key}: ${text}`)
  expect(lower).toEqual([])
})

test("no interface string in the dictionary shouts", () => {
  const loud = Object.entries(dict)
    .filter(([, text]) => {
      const bare = withoutParams(text)
      return /[A-Z]{2}/.test(bare) && bare === bare.toUpperCase() && !ACRONYMS.has(bare)
    })
    .map(([key, text]) => `${key}: ${text}`)
  expect(loud).toEqual([])
})

test("the dictionary is not empty", () => {
  expect(Object.keys(dict).length).toBeGreaterThan(100)
})
