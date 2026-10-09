import { expect, test } from "bun:test"
import type { ExtensionInfo, ExtensionProposal } from "@yuki/protocol"
import { applyUserEvent, overlayExtensions, type UserData } from "./user-store"

const manifest = { yuki: 1 as const, name: "tally", version: "1.0.0", description: "counts", secrets: { KEY: { hosts: ["api.example.com"] } }, egress: ["api.example.com"] }
const installed: ExtensionInfo = {
  name: "tally", version: "1.0.0", description: "counts", hash: "h1", enabled: true, agents: null, source: "catalog",
  manifest, secrets: [{ name: "KEY", set: true }], installedAt: 1, updatedAt: 1,
}
const update: ExtensionProposal = { id: "xp_1", name: "tally", version: "1.1.0", hash: "h2", source: "agent", by: "ada" as never, bundle: { manifest: { ...manifest, version: "1.1.0" }, files: {} }, replaces: "h1", createdAt: 2 }

test("a switch, a scope, and a removal show before the server answers", () => {
  const data = { extensions: [installed], proposals: [] }
  expect(overlayExtensions(data, [{ reqId: "a", op: { op: "enable", name: "tally", enabled: false } }], 5).extensions[0]!.enabled).toBe(false)
  expect(overlayExtensions(data, [{ reqId: "a", op: { op: "agents", name: "tally", agents: ["ada" as never] } }], 5).extensions[0]!.agents).toEqual(["ada" as never])
  expect(overlayExtensions(data, [{ reqId: "a", op: { op: "uninstall", name: "tally" } }], 5).extensions).toEqual([])
})

test("an install moves the proposal into the list and keeps the switches and secrets of the old version", () => {
  const data = { extensions: [{ ...installed, enabled: false }], proposals: [update] }
  const out = overlayExtensions(data, [{ reqId: "a", op: { op: "install", id: "xp_1" } }], 9)
  expect(out.proposals).toEqual([])
  expect(out.extensions).toHaveLength(1)
  expect(out.extensions[0]).toMatchObject({ version: "1.1.0", hash: "h2", enabled: false, by: "ada", secrets: [{ name: "KEY", set: true }], updatedAt: 9 })
})

test("extension events replace by name and by id, and a replayed event is skipped", () => {
  const data: UserData = { seq: 0, chats: [], agents: [], home: { files: [], folders: [] }, extensions: [], proposals: [] }
  applyUserEvent(data, { seq: 1, at: 1, t: "extension", extension: installed })
  applyUserEvent(data, { seq: 2, at: 2, t: "extension", extension: { ...installed, version: "1.0.1" } })
  applyUserEvent(data, { seq: 3, at: 3, t: "extension_proposal", proposal: update })
  expect(data.extensions.map((x) => x.version)).toEqual(["1.0.1"])
  expect(data.proposals.map((p) => p.id)).toEqual(["xp_1"])
  expect(applyUserEvent(data, { seq: 2, at: 2, t: "extension_removed", name: "tally" })).toBe(false)
  applyUserEvent(data, { seq: 4, at: 4, t: "extension_proposal_removed", id: "xp_1" })
  applyUserEvent(data, { seq: 5, at: 5, t: "extension_removed", name: "tally" })
  expect(data).toMatchObject({ extensions: [], proposals: [] })
})
