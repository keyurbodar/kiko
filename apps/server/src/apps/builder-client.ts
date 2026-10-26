import type { Builder, BuildResult } from "./service"

export type BuilderEnv = { BUILDER?: Fetcher; BUILDER_URL?: string; BUILDER_SECRET?: string }

export function builderFrom(env: BuilderEnv): Builder | null {
  if (!env.BUILDER_SECRET) return null
  const send = env.BUILDER
    ? (init: RequestInit) => env.BUILDER?.fetch("https://builder/build", init) as Promise<Response>
    : env.BUILDER_URL
      ? (init: RequestInit) => fetch(`${env.BUILDER_URL}/build`, init)
      : null
  if (!send) return null
  const secret = env.BUILDER_SECRET
  return async (files, target) => {
    const response = await send({
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ files, target }),
    })
    if (!response.ok) throw new Error(`the app builder answered ${response.status}`)
    return (await response.json()) as BuildResult
  }
}
