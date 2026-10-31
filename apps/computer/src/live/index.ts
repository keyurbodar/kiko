import type { Display, FromDaemon, Holder, ToDaemon } from "@kiko/computer/wire"
import type { Logger } from "../log"
import { createLive } from "./daemon"
import type { PeerModule } from "./rtc-link"
import type { LivePolicy } from "./types"

export type LiveFrames = {
  rtc(frame: Extract<ToDaemon, { t: "rtc" }>): void
  live(frame: Extract<ToDaemon, { t: "live" }>): void
  input(frame: Extract<ToDaemon, { t: "input" }>): void
  control(frame: Extract<ToDaemon, { t: "control" }>): void
  ack(frame: Extract<ToDaemon, { t: "ack" }>): void
}

export type LiveHooks = {
  logger: Logger
  setHolder(holder: Holder): void
  send(frame: FromDaemon): void
  sendBinary(bytes: Uint8Array<ArrayBuffer>): void
  policy: LivePolicy
  display: () => Display | undefined
  configDir: string
}

export type Live = {
  live: boolean
  input: boolean
  frames: LiveFrames
  agentCursor(x: number, y: number): void
  close(): Promise<void>
}

async function loadPeer(logger: Logger): Promise<PeerModule | null> {
  try {
    return await import("node-datachannel")
  } catch (error) {
    logger.warn(`webrtc is unavailable on this machine: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

export async function startLive(hooks: LiveHooks): Promise<Live> {
  const rtc = await loadPeer(hooks.logger)
  if (!rtc) return emptyLive(hooks)
  const live = createLive({
    send: hooks.send,
    sendBinary: hooks.sendBinary,
    warn: (message) => hooks.logger.warn(message),
    policy: hooks.policy,
    rtc,
    configDir: hooks.configDir,
    ...(hooks.display() ? { display: hooks.display() } : {}),
  })
  return {
    live: hooks.policy.live,
    input: hooks.policy.input,
    frames: {
      rtc: (frame) => live.onRtc(frame.session, frame.signal, frame.iceServers),
      live: (frame) => live.onLive(frame),
      input: (frame) => live.onInput(frame.events),
      control: (frame) => {
        hooks.setHolder(frame.holder)
        live.onControl(frame.holder)
      },
      ack: (frame) => live.onAck(frame.seq),
    },
    agentCursor: (x, y) => live.agentCursor(x, y),
    close: async () => live.close(),
  }
}

export function emptyLive(hooks: Pick<LiveHooks, "logger" | "setHolder">): Live {
  const ignore = (kind: string) => hooks.logger.warn(`${kind} arrived but this build has no live view`)
  return {
    live: false,
    input: false,
    frames: {
      rtc: () => ignore("an rtc frame"),
      live: () => ignore("a live frame"),
      input: () => ignore("an input frame"),
      control: (frame) => hooks.setHolder(frame.holder),
      ack: () => undefined,
    },
    agentCursor: () => undefined,
    close: () => Promise.resolve(),
  }
}
