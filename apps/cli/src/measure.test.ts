import { expect, test } from "bun:test"
import { readTail } from "./commands/measure"

const event = (fields: object) => JSON.stringify({ truncated: false, ...fields }, null, 4)

test("readTail sums one run's object events and the worker request, and ignores other runs", () => {
  const text = [
    event({ executionModel: "stateless", cpuTime: 1, wallTime: 9000, event: { request: { url: "https://x/api/experiments/turn?name=a-1&id=a-1" } } }),
    event({ executionModel: "durableObject", durableObjectId: "obj1", cpuTime: 400, wallTime: 8000, event: { rpcMethod: "experimentTurn" } }),
    event({ executionModel: "durableObject", durableObjectId: "obj1", cpuTime: 0, wallTime: 60, outcome: "canceled", event: { scheduledTime: "t" } }),
    event({ executionModel: "durableObject", durableObjectId: "obj2", cpuTime: 999, wallTime: 5, event: { rpcMethod: "experimentTurn" } }),
    event({ executionModel: "stateless", cpuTime: 7, wallTime: 5, event: { request: { url: "https://x/api/experiments/turn?name=a-2&id=a-2" } } }),
  ].join("\n")
  expect(readTail(text, "obj1", "a-1")).toEqual({ requests: 3, cpuMs: 401, wallMs: 9000 })
})
