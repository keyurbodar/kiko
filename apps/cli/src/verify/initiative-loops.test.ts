import { expect, test } from "bun:test"
import { humanLoop, type Loop } from "./suites/initiative"

const loop = (id: number, owner: string, text: string, status = "open"): Loop => ({ id, kind: "intention", certainty: "explicit", owner, status, text, due: null })

test("the initiative suite checks the human's loop, not the agent's promise with the same words", () => {
  const loops = [
    loop(2, "yuki", "I will remind you Monday at noon UTC to call the dentist."),
    loop(1, "human", "I have to call the dentist to move my appointment, by Monday at noon."),
    loop(3, "human", "pick up my new glasses", "dropped"),
  ]
  expect(humanLoop(loops, /dentist/i)?.id).toBe(1)
  expect(humanLoop(loops, /glasses/i)).toBeUndefined()
})
