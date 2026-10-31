import { describe, expect, it } from "vitest"
import { withDraft2020Tools } from "./tool-schema"

const parameters = {
  type: "object",
  properties: {
    path: { type: "string", description: "the path" },
    nested: { $ref: "#/$defs/Nested" },
  },
  required: ["path"],
  $defs: {
    Nested: { type: "object", properties: { count: { type: "number" } } },
  },
  unsupported: "drop me",
}

const cleaned = {
  type: "object",
  properties: {
    path: { type: "string", description: "the path" },
    nested: { type: "object", properties: { count: { type: "number" } } },
  },
  required: ["path"],
}

const context = (tools: { name: string; parameters: unknown }[]) =>
  ({ tools, messages: [] }) as unknown as Parameters<typeof withDraft2020Tools>[0]

describe("withDraft2020Tools", () => {
  it("clears a schema of what draft 2020-12 rejects", () => {
    const result = withDraft2020Tools(context([{ name: "read", parameters }]))
    expect(result.tools?.[0].parameters).toEqual(cleaned)
  })

  it("cleans a schema once per parameters object", () => {
    const tool = { name: "read", parameters }
    const first = withDraft2020Tools(context([tool]))
    const second = withDraft2020Tools(context([tool]))
    expect(second.tools?.[0].parameters).toBe(first.tools?.[0].parameters)
  })

  it("keeps the schemas of different tools apart", () => {
    const other = { name: "write", parameters: { ...parameters } }
    const result = withDraft2020Tools(context([{ name: "read", parameters }, other]))
    expect(result.tools?.[0].parameters).toEqual(cleaned)
    expect(result.tools?.[1].parameters).toEqual(cleaned)
    expect(result.tools?.[1].parameters).not.toBe(result.tools?.[0].parameters)
  })

  it("cleans the tools a message added", () => {
    const added = { name: "read", parameters }
    const message = { role: "user", content: [], toolsAdded: [added] } as unknown as {
      role: string
      content: unknown[]
      toolsAdded: { name: string; parameters: unknown }[]
    }
    const result = withDraft2020Tools({
      messages: [message],
    } as unknown as Parameters<typeof withDraft2020Tools>[0])
    const toolsAdded = (result.messages[0] as { toolsAdded: { parameters: unknown }[] }).toolsAdded
    expect(toolsAdded[0].parameters).toEqual(cleaned)
  })

  it("gives a tool without a schema an empty object", () => {
    const result = withDraft2020Tools(context([{ name: "read", parameters: undefined }]))
    expect(result.tools?.[0].parameters).toEqual({ type: "object", properties: {} })
  })
})
