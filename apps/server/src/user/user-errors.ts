import { IntegrationError, type NoticeError } from "@kiko/protocol"
import { ComposioError, REJECTED as COMPOSIO_REJECTED_TEXT } from "../integrations/composio/client"
import { KernelError } from "../integrations/kernel/client"
import { CredentialError } from "./credentials"

const COMPOSIO_MISSING = new IntegrationError({
  integration: "composio",
  reason: "missing",
  message: "Composio is not connected. Add your key in integrations.",
  action: "open_integrations",
})
const COMPOSIO_REJECTED = new IntegrationError({
  integration: "composio",
  reason: "rejected",
  message: "Composio did not accept your key. Check it in integrations.",
  action: "open_integrations",
})
const COMPOSIO_DOWN = new IntegrationError({
  integration: "composio",
  reason: "down",
  message: "Composio is not answering. Your apps are unavailable for now.",
})
const KERNEL_MISSING = new IntegrationError({
  integration: "kernel",
  reason: "missing",
  message: "The browser needs a Kernel key. Add one in integrations.",
  action: "open_integrations",
})
const KERNEL_REJECTED = new IntegrationError({
  integration: "kernel",
  reason: "rejected",
  message: "Kernel did not accept your key. Check it in integrations.",
  action: "open_integrations",
})
const KERNEL_DOWN = new IntegrationError({
  integration: "kernel",
  reason: "down",
  message: "The browser could not start. Kernel is busy or not answering.",
})

export function composioFailure(e: unknown): NoticeError | null {
  if (e instanceof ComposioError) {
    if (e.message === COMPOSIO_REJECTED_TEXT || e.status === 401 || e.status === 403) return COMPOSIO_REJECTED
    if (e.message === "Composio is not connected") return COMPOSIO_MISSING
    if (e.status !== undefined && e.status >= 500) return COMPOSIO_DOWN
    return e.status === undefined && e.message.startsWith("Composio sent no") ? COMPOSIO_DOWN : null
  }
  if (e instanceof CredentialError) return COMPOSIO_MISSING
  return COMPOSIO_DOWN
}

export function kernelFailure(e: unknown): NoticeError | null {
  if (e instanceof KernelError) {
    if (e.kind === "unauthorized") return KERNEL_REJECTED
    if (e.message === "Kernel is not connected") return KERNEL_MISSING
    return e.kind === "failed" || e.kind === "capacity" || e.kind === "rate_limited" ? KERNEL_DOWN : null
  }
  return e instanceof CredentialError ? KERNEL_MISSING : KERNEL_DOWN
}
