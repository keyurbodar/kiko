import type { ComposioResult, KernelResult } from "@kiko/protocol"
import { call, owner } from "../state/runtime"
import { onUserSignal } from "../state/user"

type ComposioAsk = { t: "connectComposio"; apiKey: string } | { t: "disconnectComposio" }
type KernelAsk = { t: "connectKernel"; apiKey: string } | { t: "disconnectKernel" }

export type RequestClient<Ask, R> = {
  request(frame: Ask): Promise<R>
  onPush(fn: (result: R) => void): () => void
  close(): void
}

export type ComposioClient = RequestClient<ComposioAsk, ComposioResult>
export type KernelClient = RequestClient<KernelAsk, KernelResult>

async function settle<R>(pending: Promise<R>): Promise<R> {
  try {
    return await pending
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Kiko did not answer." } as R
  }
}

function composioRequest(ask: ComposioAsk): Promise<ComposioResult> {
  if (ask.t === "connectComposio") return settle(call(owner.commands.composioConnect, { apiKey: ask.apiKey }))
  return settle(call(owner.commands.composioDisconnect, {}))
}

function kernelRequest(ask: KernelAsk): Promise<KernelResult> {
  if (ask.t === "connectKernel") return settle(call(owner.commands.kernelConnect, { apiKey: ask.apiKey }))
  return settle(call(owner.commands.kernelDisconnect, {}))
}

function createClient<Ask, R>(type: "composio" | "kernel", request: (ask: Ask) => Promise<R>): RequestClient<Ask, R> {
  const offs: (() => void)[] = []
  return {
    request,
    onPush(fn) {
      const off = onUserSignal(type, (signal) => {
        if (signal.reqId === undefined) fn(signal.result as R)
      })
      offs.push(off)
      return off
    },
    close() {
      for (const off of offs.splice(0)) off()
    },
  }
}

export const createComposioClient = (): ComposioClient => createClient("composio", composioRequest)
export const createKernelClient = (): KernelClient => createClient("kernel", kernelRequest)
