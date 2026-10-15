import { expect, test } from "bun:test"
import type { HumanQuestion } from "@kiko/protocol"
import { buildPendingUserInputAnswers, carryDisplacedCustomAnswerIntoPrompt, derivePendingUserInputProgress, setPendingUserInputCustomAnswer, togglePendingUserInputOptionSelection } from "./question-model"

const one: HumanQuestion = { id: "place", header: "Place", question: "Where?", options: [{ label: "Café", value: "cafe", description: "Somewhere quiet" }] }
const many: HumanQuestion = { id: "food", header: "Food", question: "What should they serve?", multiSelect: true, options: [{ label: "Tea" }, { label: "Cake" }] }

test("T3 question progress keeps earlier answers and waits for every question", () => {
  const answers = { place: togglePendingUserInputOptionSelection(one, undefined, "cafe") }
  expect(derivePendingUserInputProgress([one, many], answers, 1)).toMatchObject({ questionIndex: 1, answeredQuestionCount: 1, isComplete: false, canAdvance: false })
  expect(buildPendingUserInputAnswers([one, many], answers)).toBeNull()
  expect(derivePendingUserInputProgress([one, many], answers, 0).selectedOptionValues).toEqual(["cafe"])
})

test("T3 multi-select toggles independently and submits an array", () => {
  let draft = togglePendingUserInputOptionSelection(many, undefined, "Tea")
  draft = togglePendingUserInputOptionSelection(many, draft, "Cake")
  expect(buildPendingUserInputAnswers([many], { food: draft })).toEqual({ food: ["Tea", "Cake"] })
  draft = togglePendingUserInputOptionSelection(many, draft, "Tea")
  expect(buildPendingUserInputAnswers([many], { food: draft })).toEqual({ food: ["Cake"] })
})

test("custom input replaces selection and displaced text returns to the ordinary draft", () => {
  const selected = togglePendingUserInputOptionSelection(one, undefined, "cafe")
  expect(setPendingUserInputCustomAnswer(selected, "a park")).toEqual({ customAnswer: "a park" })
  expect(carryDisplacedCustomAnswerIntoPrompt("later", "a park")).toBe("later\n\na park")
  expect(buildPendingUserInputAnswers([{ ...one, allowCustomAnswer: false }], { place: { customAnswer: "a park" } })).toBeNull()
  expect(buildPendingUserInputAnswers([one], { place: { selectedOptionValues: ["missing"] } })).toBeNull()
})
