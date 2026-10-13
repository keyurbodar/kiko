import { expect, test } from "bun:test"
import { sessionCookie } from "../src/auth/auth"
import type { Env } from "../src/index"
import { skillsRoute } from "../src/skills/route"
import { builtinSkills } from "../src/skills/builtin"

const SECRET = "test-secret-that-is-at-least-32-characters-long"
const env = { SESSION_SECRET: SECRET } as unknown as Env

test("the skills route lists the built-in skills to the signed-in owner", async () => {
  const cookie = await sessionCookie(SECRET, "owner", false)
  const request = new Request("http://localhost/api/skills", { headers: { cookie: cookie.split(";")[0]! } })
  const res = await skillsRoute(request, env)
  expect(res?.status).toBe(200)
  const body = (await res!.json()) as { skills: { name: string; source: string; description: string }[] }
  const builtin = builtinSkills().map((s) => s.name)
  expect(builtin.length).toBeGreaterThan(0)
  expect(body.skills.filter((s) => s.source === "builtin").map((s) => s.name)).toEqual(builtin)
  expect(body.skills.every((s) => s.description.length > 0)).toBe(true)
})

test("the skills route refuses a request with no session", async () => {
  const res = await skillsRoute(new Request("http://localhost/api/skills"), env)
  expect(res?.status).toBe(401)
})

test("the skills route only answers its own path", async () => {
  const cookie = await sessionCookie(SECRET, "owner", false)
  const res = await skillsRoute(new Request("http://localhost/api/other", { headers: { cookie: cookie.split(";")[0]! } }), env)
  expect(res).toBeNull()
})
