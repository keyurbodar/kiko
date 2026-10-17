import { describe, expect, test } from "bun:test"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { createModels } from "@earendil-works/pi-ai/models"
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { defineExtension, Harness, MemoryStorage, wrapSection } from "@earendil-works/pi-durable"
import { BASE, type BuildAgentInput, buildAgent } from "../src/agent/factory"
import { WORK, WORK_STEPS } from "../src/agent/extensions/work"
import type { Workers } from "@kiko/agent/workers"
import { WEB } from "../src/agent/extensions/web"
import { SKILLS } from "../src/agent/extensions/skills"
import { SECTION_ORDER } from "../src/agent/prompt"

const context = BACKGROUND_CONTEXT
const FAUX = { provider: "faux", modelId: "faux-1" }
const work = {} as Workers

async function firstRequest(input: BuildAgentInput, extra: Parameters<typeof defineExtension>[0][] = []) {
  const built = buildAgent(input)
  for (const extension of extra) built.registry.install(defineExtension(extension))
  const extensions = [...((built.agent.extensions as readonly { name: string }[]) ?? []), ...extra]
  const faux = fauxProvider()
  let system = ""
  faux.setResponses([
    (request) => {
      // pi-ai's system message: `content`, then the named sections, which the provider renders in key order.
      type System = { role: string; content?: string; sections?: Record<string, string | null> }
      const messages = (request as unknown as { messages: System[] }).messages
      system = messages
        .filter((m) => m.role === "system")
        .flatMap((m) => [m.content ?? "", ...Object.values(m.sections ?? {}).map((s) => s ?? "")])
        .join("\n")
      return fauxAssistantMessage("ok")
    },
  ])
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(new MemoryStorage(), { models, registry: built.registry }, context)
  const agent = extra.length ? { ...built.agent, extensions: extensions as never } : built.agent
  const root = await harness.root(context, { agent })
  const settled = await (await root.submit({ type: "input", content: "hi" }, context)).wait(context)
  expect(settled.status).toBe("done")
  const selected = (await root.agent(context)).extensions.map((e) => e.name)
  await harness.close(context)
  return { system, selected }
}

const at = (text: string, key: string) => text.indexOf(`<${key}>`)

async function reasoningSeen(thinkingLevel?: BuildAgentInput["thinkingLevel"]) {
  const built = buildAgent({ role: "", lead: true, model: FAUX, ...(thinkingLevel ? { thinkingLevel } : {}) })
  const faux = fauxProvider({ models: [{ id: "faux-1", reasoning: true }] })
  let seen: unknown = "unset"
  faux.setResponses([
    (_request, options) => {
      seen = options?.reasoning
      return fauxAssistantMessage("ok")
    },
  ])
  const models = createModels()
  models.setProvider(faux.provider)
  const harness = await Harness.open(new MemoryStorage(), { models, registry: built.registry }, context)
  const root = await harness.root(context, { agent: built.agent })
  await (await root.submit({ type: "input", content: "hi" }, context)).wait(context)
  await harness.close(context)
  return seen
}

describe("reasoning level", () => {
  test("the level an agent was given reaches the model request", async () => {
    expect(await reasoningSeen("high")).toBe("high")
  })
  test("a level of off sends no reasoning", async () => {
    expect(await reasoningSeen("off")).toBeUndefined()
  })
})

describe("buildAgent", () => {
  test("the system prompt has the base sections in a fixed order", async () => {
    const { system } = await firstRequest({ role: "you plan trips.", lead: true, model: FAUX })
    for (const key of ["voice", "reactions", "role"]) expect(at(system, key)).toBeGreaterThanOrEqual(0)
    expect(at(system, "role")).toBeLessThan(at(system, "kiko"))
    expect(at(system, "kiko")).toBeLessThan(at(system, "tools"))
    expect(at(system, "tools")).toBeLessThan(at(system, "pacing"))
    expect(at(system, "pacing")).toBeLessThan(at(system, "voice"))
    expect(at(system, "voice")).toBeLessThan(at(system, "reactions"))
    expect(system).toContain("[react:👍]")
    expect(system).toContain("Your job here: you plan trips.")
    expect(at(system, "skills")).toBeGreaterThan(at(system, "role"))
    expect(system).toContain("<name>haiku</name>")
    expect(at(system, "profile")).toBe(-1)
  })

  test("a later extension fills the slots without changing the order", async () => {
    const fill = {
      name: "fill",
      wraps: [
        wrapSection("skills", (s) => ({ ...s, render: () => "<available_skills>short answers</available_skills>" })),
        wrapSection("chat", (s) => ({ ...s, render: () => "/chat.md:\n# trip" })),
        wrapSection("soul", (s) => ({ ...s, render: () => "# ada\nsharp and dry" })),
        wrapSection("work", (s) => ({ ...s, render: () => "- use start_work" })),
      ],
    }
    const { system } = await firstRequest({ role: "", lead: false, model: FAUX }, [fill])
    const positions = SECTION_ORDER.map((key) => at(system, key))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(system).toContain("short answers")
  })

  test("every built agent selects the same base extensions, in the same order", async () => {
    const inputs: BuildAgentInput[] = [
      { role: "you plan trips.", lead: true, model: FAUX, work },
      { role: "you check facts.", lead: false, model: FAUX, work },
      { role: "", lead: false, model: { provider: "opencode-go", modelId: "deepseek-v4.1-flash" }, work },
    ]
    const lists = inputs.map((input) => (buildAgent(input).agent.extensions as readonly { name: string }[]).map((e) => e.name))
    for (const list of lists) {
      expect(list).toEqual(lists[0])
      expect(list[0]).toBe(BASE)
      expect(list.slice(-2)).toEqual([WORK, WORK_STEPS])
    }
    for (const input of inputs) {
      const built = buildAgent(input)
      expect(Array.isArray(built.agent.extensions)).toBe(true)
      expect(built.registry.snapshot().installed().map((e) => e.name).filter((n) => n !== WEB)).toEqual(lists[0])
    }
    const { selected } = await firstRequest(inputs[0])
    expect(selected).toEqual(lists[0])
  })

  test("test extensions come after the built-ins", () => {
    const extra = defineExtension({ name: "extra" })
    for (const lead of [true, false]) {
      const names = (buildAgent({ role: "", lead, model: FAUX, work, testExtensions: [extra] }).agent.extensions as readonly { name: string }[]).map((e) => e.name)
      expect(names).toEqual([BASE, SKILLS, WORK, WORK_STEPS, "extra"])
    }
  })

  test("the role section says whether the agent leads", async () => {
    const lead = (await firstRequest({ role: "", lead: true, model: FAUX })).system
    const member = (await firstRequest({ role: "", lead: false, model: FAUX })).system
    expect(lead).toContain("You lead this chat")
    expect(member).toContain("You are not the lead")
  })

})
