import { expect, test } from "bun:test"
import { reviewChange } from "./review-diff"

const line = (text: string, level: "info" | "notice" | "warning" = "notice") => ({ text, level })

test("shows only the powers an update adds or drops", () => {
  const before = [line("adds tool flip_coin: reads"), line("keeps its own notes per chat", "info")]
  const after = [line("adds tool flip_coin: reads"), line("adds tool roll_die: reads"), line("can read from example.com", "warning")]
  expect(reviewChange(before, after)).toEqual({
    added: [line("adds tool roll_die: reads"), line("can read from example.com", "warning")],
    removed: [line("keeps its own notes per chat", "info")],
    unchanged: 1,
  })
})

test("an update with the same powers has nothing new", () => {
  const same = [line("adds tool flip_coin: reads")]
  expect(reviewChange(same, same)).toEqual({ added: [], removed: [], unchanged: 1 })
})
