import type { Display, FromDaemon, Holder, IceServer, InputEvent, RtcSignal } from "@kiko/computer/wire"
import type { Screen } from "./capture"
import type { Clipboard } from "./clipboard"
import type { Gate, Injected } from "./input"
import type { PeerModule } from "./rtc-link"
import type { Tools } from "./tools"

export type LivePolicy = { live: boolean; input: boolean }

export type LiveDeps = {
  send(frame: FromDaemon): void
  sendBinary(bytes: Uint8Array<ArrayBuffer>): void
  warn(message: string): void
  policy: () => LivePolicy
  rtc: PeerModule
  display?: Display
  displays?: () => readonly Display[]
  tools?: () => Tools | null
  clipboard?: Clipboard
  every?: (ms: number, run: () => void) => () => void
  configDir?: string
  encoders?: readonly string[]
  openInput?: (area: () => Screen | null, gate: Gate) => Injected | null
  find?: (name: string) => string | null
  now?: () => number
}

export type LiveFrame = { on: boolean; fps?: number; maxWidth?: number; quality?: number }

export type Control = { holder: Holder; epoch?: number; session?: string }

export type Live = {
  onRtc(session: string, signal: RtcSignal, iceServers?: readonly IceServer[]): void
  onLive(frame: LiveFrame): void
  onInput(events: readonly InputEvent[]): void
  onControl(control: Control): void
  onScreen(id: string): void
  onAck(seq: number): void
  agentCursor(x: number, y: number): void
  idle(): Promise<void>
  close(): void
}
