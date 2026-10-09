import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, wrapSection } from "@earendil-works/pi-durable"
import { BUILTIN_SKILLS } from "../../skills/builtin.gen"
import { formatSkills, parseSkill, resolveSkills, type Skill } from "../../skills/registry"
import { declareEffect } from "@yuki/agent/effects"
import type { RoomFs } from "../../files/room-fs"
import { perRun } from "./self"

export const SKILLS = "skills"
const ROOM_PREFIX = "skills"
const MAX_SKILL_BYTES = 64 * 1024

let parsed: Skill[] | undefined
const builtin = (): Skill[] =>
  (parsed ??= BUILTIN_SKILLS.flatMap(([dir, content]) => {
    const s = parseSkill(content, dir, "builtin")
    return "warning" in s ? (console.warn(s.warning), []) : [s]
  }))

async function roomSkills(fs: RoomFs | undefined): Promise<Skill[]> {
  if (!fs) return []
  const listed = await fs.list(ROOM_PREFIX, true)
  if (!listed.ok) return []
  const out: Skill[] = []
  for (const f of listed.value) {
    const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(f.path)
    if (!m || f.kind !== "file") continue
    const bytes = await fs.bytesOf(f, MAX_SKILL_BYTES).catch(() => null)
    if (!bytes) continue
    const s = parseSkill(new TextDecoder().decode(bytes), m[1]!, "room")
    if ("warning" in s) console.warn(s.warning)
    else out.push(s)
  }
  return out
}

export function skillsExtension(files?: RoomFs, stamp?: () => number): Extension {
  const all = async () => resolveSkills(await roomSkills(files), builtin())
  const listed = perRun(async () => formatSkills(await all()), stamp)
  return defineExtension({
    name: SKILLS,
    wraps: [wrapSection("skills", (slot) => ({ ...slot, render: listed }))],
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
