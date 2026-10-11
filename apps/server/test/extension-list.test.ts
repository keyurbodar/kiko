import { expect, test } from "bun:test"
import type { ExtensionInfo } from "@yuki/protocol"
import { extensionLine } from "../src/agent/extensions/builder"

const info = (enabled: boolean) =>
  ({ name: "tally", version: "1.0.0", enabled, description: "keep counts", manifest: { yuki: 1, name: "tally", version: "1.0.0", description: "keep counts" }, secrets: [] }) as unknown as ExtensionInfo

test("an extension that is switched off reads as installed and off, never as missing", () => {
  const line = extensionLine(info(false))
  expect(line).toContain("tally 1.0.0 off")
  expect(line).toContain("installed but switched off")
  expect(line).toContain("switch it on in Settings → extensions")
  expect(line).toContain("Do not offer to install it again")
})

test("an extension that is on says on", () => {
  const line = extensionLine(info(true))
  expect(line).toContain("tally 1.0.0 on:")
  expect(line).not.toContain("switch it on")
})
