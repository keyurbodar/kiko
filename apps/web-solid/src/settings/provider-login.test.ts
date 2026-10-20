import { expect, test } from "bun:test"
import { reduceSignIn, started, startSignIn } from "./provider-login"

import { createUserChannel } from "../sync/socket"
import type { ClientToOwner } from "@kiko/protocol"

const id = "l1"

test("a device code, a prompt, then done", () => {
  let s = reduceSignIn(started, {
    t: "login.notify",
    loginId: id,
    event: { type: "device_code", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" },
  })
  expect(s.code?.userCode).toBe("ABCD-1234")
  s = reduceSignIn(s, { t: "login.notify", loginId: id, event: { type: "progress", message: "Waiting" } })
  expect(s.note).toBe("Waiting")
  s = reduceSignIn(s, { t: "login.prompt", loginId: id, promptId: "1", prompt: { type: "manual_code", message: "code" } })
  expect(s.prompt?.promptId).toBe("1")
  s = reduceSignIn(s, { t: "login.done", loginId: id, provider: { provider: "x", kind: "oauth", last4: "" } })
  expect(s.status).toBe("done")
  expect(s.prompt).toBeNull()
})

test("an error shows its message, a cancel shows none", () => {
  const failed = reduceSignIn(started, { t: "login.error", loginId: id, reason: "disabled", message: "subscription sign-in is off" })
  expect([failed.status, failed.error]).toEqual(["error", "subscription sign-in is off"])
  const cancelled = reduceSignIn(started, { t: "login.error", loginId: id, reason: "cancelled", message: "sign-in cancelled" })
  expect([cancelled.status, cancelled.error]).toEqual(["error", null])
})


test("provider sign-in shares the channel and routes answers and cancellation by login id", () => {
  const channel = createUserChannel()
  const sent: ClientToOwner[] = []
  channel.attach((frame) => { sent.push(frame); return true })
  const states: string[] = []
  const login = startSignIn("example", (state) => states.push(state.status), channel)
  const first = sent[0]
  if (first?.t !== "login.start") throw new Error("missing login start")
  channel.deliver({ t: "login.error", loginId: "other", reason: "cancelled", message: "cancelled" })
  expect(states).toEqual(["running"])
  login.answer("prompt", "code")
  expect(sent.at(-1)).toEqual({ t: "login.answer", loginId: first.loginId, promptId: "prompt", value: "code" })
  login.cancel()
  login.cancel()
  expect(sent.filter((f) => f.t === "login.cancel")).toEqual([{ t: "login.cancel", loginId: first.loginId }])
  channel.deliver({ t: "login.error", loginId: first.loginId, reason: "cancelled", message: "cancelled" })
  expect(states).toEqual(["running", "running"])
  expect(channel.send({ t: "hello", lastSeq: 0 })).toBe(true)
})

test("provider sign-in waits for the shared connection and fails when its connection drops", () => {
  const channel = createUserChannel()
  const sent: ClientToOwner[] = []
  const states: string[] = []
  const login = startSignIn("example", (state) => states.push(state.status), channel)
  expect(sent).toHaveLength(0)
  channel.attach((frame) => { sent.push(frame); return true })
  channel.opened()
  expect(sent[0]?.t).toBe("login.start")
  channel.status("closed")
  expect(states).toEqual(["running", "error"])
  channel.opened()
  login.cancel()
  expect(sent).toHaveLength(1)
})
