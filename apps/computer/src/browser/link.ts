import type { FromDaemon, Holder, ToDaemon } from "@kiko/computer/wire"
import { Deadline } from "../deadline"
import type { Driver } from "../driver"
import { createBrowserLive } from "./live"

const CDP_TIMEOUT_MS = 10_000

type Open = Extract<ToDaemon, { t: "browser" }>
type Input = Extract<ToDaemon, { t: "browserInput" }>
type Ack = Extract<ToDaemon, { t: "browserAck" }>

export type BrowserLink = {
  open(frame: Open): void
  input(frame: Input): void
  ack(frame: Ack): void
  close(): void
}

function cdpUrlOf(value: unknown): string {
  const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  const url = record.cdpUrl ?? record.url
  if (typeof url !== "string" || !url) throw new Error("the kiko app did not name a devtools socket")
  return url
}

export function createBrowserLink(deps: {
  driver(): Driver | null
  holder(): Holder
  send(frame: FromDaemon): void
  sendBinary(bytes: Uint8Array<ArrayBuffer>): void
  warn(message: string): void
}): BrowserLink {
  const live = createBrowserLive({
    cdpUrl: async () => {
      const driver = deps.driver()
      if (!driver) throw new Error("the kiko app is not running on this machine")
      return cdpUrlOf(await driver.call({ method: "browser.cdp" }, new Deadline(CDP_TIMEOUT_MS)))
    },
    holder: deps.holder,
    send: deps.send,
    sendBinary: deps.sendBinary,
    warn: deps.warn,
  })
  return {
    open: (frame) => live.open(frame),
    input: (frame) => live.input(frame),
    ack: (frame) => live.ack(frame),
    close: () => live.close(),
  }
}
