import type { Display, FromDaemon, Holder, IceServer, InputEvent, RtcSignal } from "@kiko/computer/wire"
import type { PeerModule } from "./rtc-link"

export type LivePolicy = { live: boolean; input: boolean }

export type LiveDeps = {
  send(frame: FromDaemon): void
  sendBinary(bytes: Uint8Array<ArrayBuffer>): void
  warn(message: string): void
  policy: LivePolicy
  rtc: PeerModule
  display?: Display
  configDir?: string
  encoders?: readonly string[]
  now?: () => number
}

export type LiveFrame = { on: boolean; fps?: number; maxWidth?: number; quality?: number }

export type Live = {
  onRtc(session: string, signal: RtcSignal, iceServers?: readonly IceServer[]): void
  onLive(frame: LiveFrame): void
  onInput(events: readonly InputEvent[]): void
  onControl(holder: Holder): void
  onAck(seq: number): void
  agentCursor(x: number, y: number): void
  close(): void
}
