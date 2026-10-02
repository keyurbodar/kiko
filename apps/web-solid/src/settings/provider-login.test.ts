import { expect, test } from "bun:test"
import { reduceSignIn, started } from "./provider-login"

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
