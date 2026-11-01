import { describe, expect, it } from "@effect/vitest"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createFeed } from "./feed"

function place(): { state: string; agent: string } {
  const dir = mkdtempSync(join(tmpdir(), "kiko-feed-"))
  return { state: join(dir, "state.json"), agent: join(dir, "agent.json") }
}

describe("menu feed", () => {
  it("writes the daemon state the kiko app reads", async () => {
    const paths = place()
    const feed = createFeed(paths)
    await feed.connected("work laptop")
    expect(JSON.parse(readFileSync(paths.state, "utf8"))).toEqual({ connected: true, name: "work laptop" })
    await feed.connected(null)
    expect(JSON.parse(readFileSync(paths.state, "utf8"))).toEqual({ connected: false })
  })

  it("writes the app the agent is working in and removes it when the agent is idle", async () => {
    const paths = place()
    const feed = createFeed(paths)
    await feed.working("Slack")
    expect(JSON.parse(readFileSync(paths.agent, "utf8"))).toEqual({ app: "Slack" })
    await feed.working(null)
    expect(existsSync(paths.agent)).toBe(false)
  })

  it("drops a repeat that changes nothing", async () => {
    const paths = place()
    const feed = createFeed(paths)
    writeFileSync(paths.agent, "keep")
    await feed.working(null)
    expect(readFileSync(paths.agent, "utf8")).toBe("keep")
    await feed.connected("box")
    await feed.connected("box")
    expect(JSON.parse(readFileSync(paths.state, "utf8"))).toEqual({ connected: true, name: "box" })
  })

  it("serializes writes so the app never reads a half written file", async () => {
    const paths = place()
    const feed = createFeed(paths)
    await Promise.all([feed.working("Slack"), feed.working("Chrome"), feed.connected("box"), feed.working(null)])
    expect(JSON.parse(readFileSync(paths.state, "utf8"))).toEqual({ connected: true, name: "box" })
    expect(existsSync(paths.agent)).toBe(false)
    expect(existsSync(`${paths.agent}.part`)).toBe(false)
  })
})
