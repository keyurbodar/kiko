import type { KikoError } from "@kiko/protocol"
import { ComposioError, REJECTED as COMPOSIO_REJECTED_TEXT } from "../integrations/composio/client"
import { KernelError } from "../integrations/kernel/client"
import { CredentialError } from "./credentials"

// The words a human sees when a connected service fails. Each row is a sentence they can act on. No
// stack, no provider text, and no key ever reaches these: only the error's kind picks the row.
const COMPOSIO_MISSING: KikoError = { code: "composio_missing", message: "Composio is not connected. Add your key in integrations.", action: "open_integrations" }
const COMPOSIO_REJECTED: KikoError = { code: "composio_rejected", message: "Composio did not accept your key. Check it in integrations.", action: "open_integrations" }
const COMPOSIO_DOWN: KikoError = { code: "composio_down", message: "Composio is not answering. Your apps are unavailable for now." }
const KERNEL_MISSING: KikoError = { code: "kernel_missing", message: "The browser needs a Kernel key. Add one in integrations.", action: "open_integrations" }
const KERNEL_REJECTED: KikoError = { code: "kernel_rejected", message: "Kernel did not accept your key. Check it in integrations.", action: "open_integrations" }
const KERNEL_DOWN: KikoError = { code: "kernel_down", message: "The browser could not start. Kernel is busy or not answering." }

/** Null for an error the agent should handle itself, such as a tool that failed on its own arguments. */
export function composioFailure(e: unknown): KikoError | null {
  if (e instanceof ComposioError) {
    if (e.message === COMPOSIO_REJECTED_TEXT || e.status === 401 || e.status === 403) return COMPOSIO_REJECTED
    if (e.message === "Composio is not connected") return COMPOSIO_MISSING
    if (e.status !== undefined && e.status >= 500) return COMPOSIO_DOWN
    return e.status === undefined && e.message.startsWith("Composio sent no") ? COMPOSIO_DOWN : null
  }
  if (e instanceof CredentialError) return COMPOSIO_MISSING
  return COMPOSIO_DOWN
}

export function kernelFailure(e: unknown): KikoError | null {
  if (e instanceof KernelError) {
    if (e.kind === "unauthorized") return KERNEL_REJECTED
    if (e.message === "Kernel is not connected") return KERNEL_MISSING
    return e.kind === "failed" || e.kind === "capacity" || e.kind === "rate_limited" ? KERNEL_DOWN : null
  }
  return e instanceof CredentialError ? KERNEL_MISSING : KERNEL_DOWN
}

