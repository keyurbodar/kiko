import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { type AgentChange, type Extension, Harness, MemoryStorage } from "@earendil-works/pi-durable"
import { describe, expect, it } from "vitest"
import { fakeSetup } from "./dev-fake"
import type { RoleInput } from "./prompt"
import { forRole } from "./roles"
import { skillsExtension } from "./extensions/skills"
import { type GroupsPort, groupsExtension } from "./extensions/chief"
import { codemodeExtension } from "./extensions/codemode"
import { KIKO } from "@kiko/protocol"
import { kikoDocsBackend } from "../files/kiko-docs"
import type { FsEntry, FsFail } from "../files/file-index"
import { type FilesBackend, RoomFs, withMount } from "../files/room-fs"

const context = BACKGROUND_CONTEXT

const encoder = new TextEncoder()

function homeBackend(files: Record<string, string>): FilesBackend {
  const entry = (path: string): FsEntry => ({
    kind: "file",
    path,
    id: path,
    size: encoder.encode(files[path] ?? "").length,
    type: "text/markdown",
    sha256: path,
    r2Key: `home:${path}`,
    at: 0,
  })
  const missing: FsFail = { ok: false, code: "not_found", message: "missing" }
  const refuse: FsFail = { ok: false, code: "invalid", message: "read-only" }
  return {
    stat: async (path) => (path in files ? entry(path) : null),
    list: async (dir) => {
      const inside = Object.keys(files).filter((path) => path.startsWith(`${dir}/`))
      return inside.length ? inside.map(entry) : missing
    },
    bytes: async (key) => {
      const text = files[key.slice("home:".length)]
      return text === undefined ? null : encoder.encode(text)
    },
    write: async () => refuse,
    move: async () => refuse,
    remove: async () => refuse,
    mkdir: async () => refuse,
    commit: async () => ({ ok: false, path: "", message: "read-only", conflict: false }),
  }
}

async function systemPrompt(role: RoleInput, worker = false, extra: Extension[] = []): Promise<string> {
  const setup = fakeSetup(role, undefined, undefined, { testExtensions: extra })
  const agent: AgentChange = worker
    ? { ...setup.agent, extensions: forRole(setup.registry.snapshot().installed(), "worker"), instructions: "work" }
    : setup.agent
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: setup.models, registry: setup.registry, settings: setup.settings },
    context,
  )
  harness.resume()
  const root = await harness.root(context, { agent })
  const submission = await root.submit({ type: "input", content: "hello" }, context)
  await submission.wait(context)
  const shown = new Map<string, string>()
  for (const message of (await root.context(context)).messages) {
    if (message.role !== "system" || !message.sections) continue
    for (const [key, value] of Object.entries(message.sections))
      if (value === null) shown.delete(key)
      else shown.set(key, value)
  }
  await harness.close(context)
  return [...shown.values()].join("\n")
}

describe("system prompt", () => {
  it("tells the lead it leads and how to react", async () => {
    const prompt = await systemPrompt({ role: "", lead: true })
    expect(prompt).toContain("You lead this chat")
    expect(prompt).toContain("[react:")
    expect(prompt).toContain("When a task reaches review")
  })

  it("tells a teammate it is not the lead and gives its job", async () => {
    const prompt = await systemPrompt({ role: "finds flights", lead: false })
    expect(prompt).toContain("You are not the lead")
    expect(prompt).toContain("Your job here: finds flights")
    expect(prompt).not.toContain("When a task reaches review")
  })

  it("leaves the team rules out of the chief's own chat", async () => {
    const port = (chief: boolean) => ({ chief }) as unknown as GroupsPort
    const own = await systemPrompt({ role: "", lead: true }, false, [groupsExtension(port(true))])
    const group = await systemPrompt({ role: "", lead: true }, false, [groupsExtension(port(false))])
    expect(own).not.toContain("<team>")
    expect(group).toContain("<team>")
  })

  it("tells every agent and worker where it runs", async () => {
    for (const worker of [false, true])
      expect(await systemPrompt({ role: "", lead: true }, worker)).toContain(
        "there is no node, python or other runtime",
      )
  })

  it("gives the codemode rules only to an agent that has codemode", async () => {
    const sandbox = async () => {
      throw new Error("not run")
    }
    const without = await systemPrompt({ role: "", lead: true })
    const withIt = await systemPrompt({ role: "", lead: true }, false, [codemodeExtension(sandbox)])
    expect(without).not.toContain("Use codemode")
    expect(withIt).toContain("Use codemode to batch independent tool calls")
  })

  it("gives a worker the shared rules without the chat voice, team, or lead", async () => {
    const prompt = await systemPrompt({ role: "", lead: true }, true)
    expect(prompt).toContain("never repeat a call unchanged")
    expect(prompt).toContain("/kiko/")
    expect(prompt).not.toMatch(/\blead\b/)
    expect(prompt).not.toContain("[react:")
    expect(prompt).not.toContain("[skip]")
    expect(prompt).not.toContain("<available_skills>")
  })

  it("lists skills with a location the agent can read, the human's own winning by name", async () => {
    const home = homeBackend({
      "skills/daily-weather/SKILL.md": "---\nname: daily-weather\ndescription: my own weather check\n---\nsteps",
      "skills/packing/SKILL.md": "---\ndescription: pack for a trip\n---\nsteps",
      "skills/broken/SKILL.md": "---\nname: other\ndescription: wrong folder\n---\n",
    })
    const fs = new RoomFs("room", withMount(withMount(homeBackend({}), "home", home), KIKO, kikoDocsBackend()))
    const recipes = {
      list: async () => [
        {
          name: "daily-weather",
          description: "Daily weather recipe",
          location: "/kiko/recipes/daily-weather/RECIPE.md",
        },
      ],
    }
    const prompt = await systemPrompt({ role: "", lead: true }, false, [skillsExtension(fs, undefined, recipes)])
    const locations = [...prompt.matchAll(/<location>([^<]+)<\/location>/g)].map((m) => m[1] ?? "")
    expect(locations).toEqual(["/home/skills/daily-weather/SKILL.md", "/home/skills/packing/SKILL.md"])
    expect(prompt).toContain("my own weather check")
    for (const location of locations) expect((await fs.readTextFile(location)).ok).toBe(true)
  })
})
