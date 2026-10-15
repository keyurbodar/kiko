import { expect, test } from "bun:test"
import { humanAnswerText, humanQuestions } from "../src/human-input"
import type { HumanAsk } from "../src/room"
const ask = { id: "ask", from: "ada", text: "Where?", messageId: "m" } as HumanAsk

test("legacy questions stay answerable with plain text", () => {
  expect(humanQuestions(ask)[0]?.question).toBe("Where?")
  expect(humanAnswerText(ask, " the park ")).toBe("the park")
})

test("a batch requires every answer and preserves selected option values", () => {
  const batch: HumanAsk = { ...ask, questions: [
    { id: "place", header: "Place", question: "Where?", options: [{ label: "Park", value: " park " }], allowCustomAnswer: false },
    { id: "food", header: "Food", question: "Which?", multiSelect: true, options: [{ label: "Tea" }, { label: "Cake" }] },
  ] }
  expect(humanAnswerText(batch, "the park")).toBeNull()
  expect(humanAnswerText(batch, { place: " park " })).toBeNull()
  expect(humanAnswerText(batch, { place: " park ", food: ["Missing"] })).toBeNull()
  expect(humanAnswerText(batch, { place: " park ", food: ["Tea", "Tea"] })).toBeNull()
  expect(humanAnswerText(batch, { place: " park ", food: ["Tea", "Cake"] })).toBe("Place:  park \nFood: Tea, Cake")
})
