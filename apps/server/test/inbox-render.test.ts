import { expect, test } from "bun:test"
import type { Envelope } from "@yuki/agent/envelope"
import { renderInput } from "@yuki/agent/inbox"

const envelope = (from: Envelope["from"], work?: Envelope["work"]): Envelope => ({ id: "system:1", from, body: "body", hop: 0, rootId: "root", seq: 1, work })

test("a quote in a system reason cannot close its attribute", () => {
  const out = renderInput({ envelopes: [envelope({ kind: "system", reason: 'run "x" <y>' })], briefs: [] })
  expect(out).toContain('<system-event reason="run &quot;x&quot; &lt;y&gt;">')
})

test("a quote in an agent slug cannot close its attribute", () => {
  const out = renderInput({ envelopes: [envelope({ kind: "agent", slug: 'a"b' })], briefs: [] })
  expect(out).toContain('<agent-message from="a&quot;b" hop="0">')
})

test("a quote in a work id or status cannot close its attribute", () => {
  const out = renderInput({ envelopes: [envelope({ kind: "system", reason: "work" }, { id: 'w"1', status: 'done"' })], briefs: [] })
  expect(out).toContain('<work id="w&quot;1" status="done&quot;">')
})
