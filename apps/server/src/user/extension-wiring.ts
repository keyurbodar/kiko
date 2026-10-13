import type { ExtensionOp, ExtensionResult } from "@kiko/protocol"
import type { Env } from "../index"
import { roomStub } from "../lib/names"
import { EXTENSION_CATALOG } from "./catalog.gen"
import { type ExtensionStore, ExtensionError } from "./extensions"

export type ExtensionHost = { room: Env["ROOM"]; userId: string; waitUntil: (work: Promise<unknown>) => void }

async function extensionResult(run: () => Promise<Omit<Extract<ExtensionResult, { ok: true }>, "ok">>): Promise<ExtensionResult> {
  try {
    return { ok: true, ...(await run()) }
  } catch (e) {
    if (e instanceof ExtensionError) return { ok: false, error: e.message, ...(e.problems ? { problems: e.problems } : {}) }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function proposeExtension(x: ExtensionStore, input: { bundle: unknown; by: string; room: string }): Promise<ExtensionResult> {
  return extensionResult(async () => ({ proposal: await x.propose({ bundle: input.bundle, source: "agent", by: input.by, room: input.room }) }))
}

export function extensionOp(x: ExtensionStore, op: ExtensionOp, host: ExtensionHost): Promise<ExtensionResult> {
  return extensionResult(async () => {
    switch (op.op) {
      case "propose":
        return { proposal: await x.propose({ bundle: op.bundle, source: "human", ...(op.room ? { room: op.room } : {}) }) }
      case "catalog":
        return { catalog: EXTENSION_CATALOG }
      case "propose_catalog":
        return { proposal: await x.proposeCatalog(op.name) }
      case "install": {
        const extension = await x.install(op.id)
        if (extension.room && extension.by) {
          const room = roomStub(host.room, host.userId, extension.room)
          host.waitUntil(Promise.resolve(room.homeNotice(extension.by, `The ${extension.name} extension is installed. Its tools work from the next message.`)).catch(() => {}))
        }
        return { extension }
      }
      case "decline":
        x.decline(op.id)
        return {}
      case "enable":
        return { extension: await x.setEnabled(op.name, op.enabled) }
      case "agents":
        return { extension: x.setAgents(op.name, op.agents) }
      case "secret":
        return { extension: await x.setSecret(op.name, op.secret, op.value) }
      case "uninstall":
        await x.uninstall(op.name)
        return {}
      case "source":
        return { bundle: x.source(op.name) }
    }
  })
}
