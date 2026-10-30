import { describe, expect, it } from "vitest"
import type { ClockPort } from "@kiko/durable/clock-port"
import type { Env } from "../index"
import { type KernelClient, KernelError } from "../integrations/kernel/client"
import type { KernelStore, LeaseRow } from "../integrations/kernel/store"
import type { OwnerServices } from "../owner/services"
import { KernelWiring } from "./kernel-wiring"

const ROOM = "01ARZ3NDEKTSV4RRFFQ69G5FAV"

function headlessLease(): LeaseRow {
  return {
    sessionId: "s1",
    mode: "headless",
    createdAt: 0,
    lastUse: 0,
    tabs: {},
    takeover: false,
    watchUntil: 0,
    dead: false,
  }
}

function fakeStore(row: LeaseRow) {
  const state = { takeover: row.takeover, watchUntil: row.watchUntil }
  const store = {
    connected: () => true,
    lease: () => ({ ...row, ...state }),
    patchLease: (patch: { takeover?: boolean; watchUntil?: number }) => {
      if (patch.takeover !== undefined) state.takeover = patch.takeover
      if (patch.watchUntil !== undefined) state.watchUntil = patch.watchUntil
    },
    key: async () => "kernel-key",
    urls: async () => ({ cdpUrl: "wss://cdp.example", liveUrl: "https://live.example" }),
    deleteLease: () => {},
    control: () => undefined,
    setControl: () => {},
  } as unknown as KernelStore
  return { store, state }
}

const client = {
  deleteBrowser: async () => {
    throw new KernelError({ kind: "failed", message: "Kernel could not switch" })
  },
  listActive: async () => [],
  alive: async () => true,
  createBrowser: async () => ({ sessionId: "s2", cdpUrl: "wss://s2.example" }),
  createProfile: async () => {},
} as KernelClient

describe("kernel live link", () => {
  it("does not hold the browser when switching to headful fails", async () => {
    const { store, state } = fakeStore(headlessLease())
    const wiring = new KernelWiring({
      ctx: { getWebSockets: () => [] } as unknown as DurableObjectState,
      sql: {} as SqlStorage,
      env: {} as Env,
      services: {} as OwnerServices,
      alarms: { setWakeup: async () => {}, clearWakeup: async () => {} } as unknown as ClockPort,
      userId: () => "owner",
      store,
      clientFor: () => client,
    })

    await expect(wiring.liveLink("worker", ROOM, "control")).resolves.toEqual({
      ok: false,
      error: "Kernel could not switch",
    })
    expect(state.takeover).toBe(false)
  })
})
