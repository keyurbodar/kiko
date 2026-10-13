import { BUILTIN_SKILLS } from "./builtin.gen"
import { parseSkill, type Skill } from "./registry"

let parsed: Skill[] | undefined

export const builtinSkills = (): Skill[] =>
  (parsed ??= BUILTIN_SKILLS.flatMap(([dir, content]) => {
    const s = parseSkill(content, dir, "builtin")
    if ("warning" in s) {
      console.warn(s.warning)
      return []
    }
    return [s]
  }))
