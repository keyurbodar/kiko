import { describe, expect, test } from "bun:test"
import type { Approval } from "@yuki/protocol"
import { title } from "./ApprovalCard"

const card = (tool: string, grantMs?: number): Approval =>
  ({ id: "a1", slug: "ada", tool, summary: "", state: "pending", expiresAt: 0, ...(grantMs ? { grantMs } : {}) }) as Approval

describe("approval card line", () => {
  test("a grant says it covers every outside tool, not only the first", () =>
    expect(title(card("web_fetch", 30 * 60_000))).toBe("ada wants to act outside yuki for 30 minutes, starting with web fetch"))
  test("a grant that starts in executor names the connected apps", () =>
    expect(title(card("executor_gmail_send", 30 * 60_000))).toBe("ada wants to act outside yuki for 30 minutes, starting with your connected apps"))
  test("a one-off card names its tool", () => expect(title(card("web_fetch"))).toBe("ada wants to use web fetch"))
})
