import { expect, test } from "bun:test"
import { guardStall, orStall, StallError, TooSlowError } from "../src/agent/stall"
import { classifyRunError } from "../src/agent/run-error"

const never = <T>() => new Promise<T>(() => {})

test("a request that never answers fails as a provider timeout", async () => {
  const error = await orStall(never<void>(), 20).catch((e) => e)
  expect(error).toBeInstanceOf(StallError)
  expect(classifyRunError((error as Error).message)).toBe("timeout")
})

test("a quick answer passes through", async () => {
  expect(await orStall(Promise.resolve(7), 50)).toBe(7)
})

test("a body that goes quiet mid-stream errors, but the chunks before it arrive", async () => {
  const enc = new TextEncoder()
  const source = new ReadableStream<Uint8Array>({
    start: (c) => c.enqueue(enc.encode("data: hi\n")),
    pull: () => never<void>(),
  })
  const reader = guardStall(new Response(source), 30).body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: hi\n")
  expect(await reader.read().catch((e) => e)).toBeInstanceOf(StallError)
})

test("a body that keeps flowing and ends is untouched", async () => {
  const response = guardStall(new Response("one two three"), 30)
  expect(await response.text()).toBe("one two three")
})

test("a body that keeps sending chunks past the total limit is stopped, with its own words", async () => {
  let t = 0
  const source = new ReadableStream<Uint8Array>({ pull: async (c) => void c.enqueue(new Uint8Array([1])) })
  const reader = guardStall(new Response(source), 1_000, 100, () => (t += 30)).body!.getReader()
  let error: unknown
  for (let i = 0; i < 20 && !error; i++) error = await reader.read().then(() => undefined, (e) => e)
  expect(error).toBeInstanceOf(TooSlowError)
  expect(classifyRunError((error as Error).message)).toBe("too_slow")
})
