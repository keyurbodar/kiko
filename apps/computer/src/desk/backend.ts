import type { Native } from "../live/native/contract"

export type Area = { width: number; height: number; originX: number; originY: number }

export type Shot = { bytes: Uint8Array<ArrayBuffer> }

export type Access = { screen: boolean; input: boolean }

export type Backend = {
  native: Native
  area(): Area | null
  shoot(area: Area, signal: AbortSignal): Promise<Shot>
  access(): Access
  requestAccess(): void
  open(target: string, signal: AbortSignal): Promise<void>
  close(): void
}
