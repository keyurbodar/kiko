import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, wrapSection } from "@earendil-works/pi-durable"
import { BUILTIN_SKILLS } from "../../skills/builtin.gen"
import { formatSkills, parseSkill, resolveSkills, type Skill } from "../../skills/registry"
import { declareEffect } from "../effects"
import type { FilesPort } from "./files"

// Architecture section 15, P5-08. Skills load on demand, as in pi's coding agent: the prompt's
// skills slot lists each name and description, and read_skill returns the instructions. A room
// skill is a chat file at skills/<name>/SKILL.md and wins over a built-in skill of the same name.

export const SKILLS = "skills"
const ROOM_PREFIX = "skills/"
const MAX_SKILL_BYTES = 64 * 1024

const builtin = (): Skill[] =>
  BUILTIN_SKILLS.flatMap(([dir, content]) => {
    const s = parseSkill(content, dir, "builtin")
    return "warning" in s ? (console.warn(s.warning), []) : [s]
  })

async function roomSkills(files: FilesPort | undefined): Promise<Skill[]> {
  if (!files) return []
  const out: Skill[] = []
  for (const f of await files.list(ROOM_PREFIX).catch(() => [])) {
    const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(f.name)
    if (!m) continue
    const stored = await files.read(f.name, MAX_SKILL_BYTES).catch(() => null)
    if (!stored) continue
    const s = parseSkill(new TextDecoder().decode(stored.bytes), m[1]!, "room")
    if ("warning" in s) console.warn(s.warning)
    else out.push(s)
  }
  return out
}

export function skillsExtension(files?: FilesPort): Extension {
  const all = async () => resolveSkills(await roomSkills(files), builtin())
  return defineExtension({
    name: SKILLS,
    wraps: [wrapSection("skills", (slot) => ({ ...slot, render: async () => formatSkills(await all()) }))],
    tools: [
      declareEffect(
        "read",
        defineTool({
          name: "read_skill",
          description: "load a skill's instructions by its name from <available_skills>. follow them for the task.",
          parameters: Type.Object({ name: Type.String() }),
          replay: "safe",
          execute: async ({ name }) => {
            const skill = (await all()).find((s) => s.name === name.trim())
            if (!skill) return { content: [{ type: "text" as const, text: `no skill named ${name}` }], isError: true }
            return { content: [{ type: "text" as const, text: skill.body }] }
          },
        }),
      ),
    ],
  })
}
