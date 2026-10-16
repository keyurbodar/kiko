import { describe, expect, test } from "bun:test"
import { ComposioError, REJECTED } from "../src/integrations/composio/client"
import { KernelError } from "../src/integrations/kernel/client"
import { composioFailure, kernelFailure } from "../src/user/user-errors"

describe("composioFailure", () => {
  test("a rejected key asks the human to check it", () => {
    expect(composioFailure(new ComposioError(REJECTED, 401))).toMatchObject({ code: "composio_rejected", action: "open_integrations" })
  })
  test("a server error or a network failure says Composio is down, with no action", () => {
    expect(composioFailure(new ComposioError("Composio answered 503", 503))).toEqual({ code: "composio_down", message: "Composio is not answering. Your apps are unavailable for now." })
    expect(composioFailure(new TypeError("fetch failed: https://x/?key=ak_secretsecretsecret"))?.code).toBe("composio_down")
  })
  test("a tool that failed on its own arguments is the agent's to handle", () => {
    expect(composioFailure(new ComposioError("Composio refused the request: bad slug"))).toBeNull()
  })
  test("no message carries provider text or a key", () => {
    const error = composioFailure(new TypeError("boom ak_secretsecretsecret"))
    expect(JSON.stringify(error)).not.toContain("ak_")
  })
})

describe("kernelFailure", () => {
  test("a rejected key", () => expect(kernelFailure(new KernelError("unauthorized", "x"))).toMatchObject({ code: "kernel_rejected", action: "open_integrations" }))
  test("no key", () => expect(kernelFailure(new KernelError("failed", "Kernel is not connected"))).toMatchObject({ code: "kernel_missing" }))
  test("capacity", () => expect(kernelFailure(new KernelError("capacity", "Kernel is out of capacity"))?.code).toBe("kernel_down"))
  test("a missing session is not the human's to fix", () => expect(kernelFailure(new KernelError("not_found", "x"))).toBeNull())
})
