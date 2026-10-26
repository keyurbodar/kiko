import { BUILTIN_SKILLS } from "./builtin.gen"
import { parseSkill, type Skill } from "./registry"

const SKILL_FILE = /^([^/]+)\/SKILL\.md$/

let parsed: Skill[] | undefined

export const builtinSkills = (): Skill[] =>
  (parsed ??= BUILTIN_SKILLS.flatMap(([path, content]) => {
    const folder = SKILL_FILE.exec(path)?.[1]
    if (!folder) return []
    const s = parseSkill(content, folder, `/kiko/skills/${path}`)
    if ("warning" in s) {
      console.warn(s.warning)
      return []
    }
    return [s]
  }))
