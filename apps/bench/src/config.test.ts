import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { inShard, planJobs, readConfig } from "./config"
import type { Os, Task } from "./types"

const task = (id: string, track: Task["track"], os: readonly Os[]): Task => ({
  id,
  track,
  kind: "real",
  os,
  needs: [],
  heldOut: false,
  prompt: id,
  limits: { turns: 1, seconds: 1 },
  setup: async () => undefined,
  oracle: async () => undefined,
  check: async () => ({ pass: true, checks: [] }),
})

async function configFile(body: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bench-config-"))
  const path = join(dir, "config.json")
  await writeFile(path, JSON.stringify(body), "utf8")
  return path
}

const BASELINE = {
  reps: 3,
  seed: 7,
  conditions: ["foreground"],
  maxTrialsPerJob: 2,
  validate: { runs: 5 },
  envs: [
    { id: "ubuntu", os: "linux", runner: "ubuntu-24.04", machine: "gha-ubuntu-24.04-x11", kind: "host", display: "x11" },
    {
      id: "debian",
      os: "linux",
      runner: "ubuntu-24.04",
      machine: "debian-13",
      kind: "container",
      display: "x11",
      image: "debian:trixie",
    },
    { id: "macos", os: "macos", runner: "macos-15", machine: "macos-15", kind: "host", display: "aqua" },
  ],
  tracks: [
    {
      track: "desktop",
      os: ["linux"],
      contenders: [{ name: "cua-driver", models: ["beam-free", "muse-spark-1.3-contributor"] }],
    },
    { track: "terminal", os: ["linux", "macos"], contenders: ["kiko"] },
  ],
}

describe("readConfig", () => {
  it("reads a per-track config and keeps every contender's own models", async () => {
    const config = readConfig(await configFile(BASELINE))
    expect(config.reps).toBe(3)
    expect(config.seed).toBe(7)
    expect(config.validateRuns).toBe(5)
    expect(config.maxTrialsPerJob).toBe(2)
    expect(config.tracks[0]?.contenders).toEqual([
      { name: "cua-driver", models: ["beam-free", "muse-spark-1.3-contributor"] },
    ])
    expect(config.tracks[1]?.contenders).toEqual([{ name: "kiko", models: ["beam-free"] }])
    expect(config.envs.map((env) => env.id)).toEqual(["ubuntu", "debian", "macos"])
    expect(config.envs[1]).toMatchObject({ kind: "container", display: "x11", image: "debian:trixie" })
  })

  it("reads the flat ci.json shape as one contender list for every track", async () => {
    const config = readConfig(
      await configFile({
        tracks: ["terminal"],
        contenders: ["kiko", "baseline-shell"],
        models: ["beam-free"],
        conditions: ["foreground", "background"],
        pattern: "terminal-02[5-7]-*",
        validate: { runs: 2 },
      }),
    )
    expect(config.conditions).toEqual(["foreground", "background"])
    expect(config.pattern).toBe("terminal-02[5-7]-*")
    expect(config.validateRuns).toBe(2)
    expect(config.envs.map((env) => env.id)).toEqual(["ubuntu-24.04", "macos-15"])
    expect(config.tracks).toEqual([
      {
        track: "terminal",
        os: ["linux", "macos"],
        contenders: [
          { name: "kiko", models: ["beam-free"] },
          { name: "baseline-shell", models: ["beam-free"] },
        ],
      },
    ])
  })

  it("refuses a missing config file", () => {
    expect(() => readConfig("/nonexistent/bench.json")).toThrow(/no bench config/)
  })

  it("refuses an unknown track name", async () => {
    const path = await configFile({ tracks: [{ track: "cooking", contenders: ["kiko"] }] })
    expect(() => readConfig(path)).toThrow(/to be one of terminal, browser, desktop, mixed/)
  })

  it("refuses a container without an image", async () => {
    const path = await configFile({
      envs: [{ id: "debian", os: "linux", runner: "ubuntu-24.04", machine: "debian-13", kind: "container" }],
      tracks: ["terminal"],
    })
    expect(() => readConfig(path)).toThrow(/the image of debian/)
  })
})

describe("planJobs", () => {
  it("runs every track on every environment whose os it lists", async () => {
    const tasks = [
      task("desktop-001", "desktop", ["linux"]),
      task("desktop-002", "desktop", ["linux"]),
      task("terminal-001", "terminal", ["linux", "macos"]),
    ]
    const jobs = planJobs(readConfig(await configFile(BASELINE)), tasks)
    const desktop = jobs.filter((job) => job.track === "desktop" && job.model === "beam-free")
    expect(desktop.map((job) => job.env)).toEqual(["ubuntu", "ubuntu", "ubuntu", "debian", "debian", "debian"])
    expect(desktop.map((job) => job.shard)).toEqual(["1/3", "2/3", "3/3", "1/3", "2/3", "3/3"])
    expect(jobs.filter((job) => job.track === "desktop")).toHaveLength(12)
    expect(desktop[0]).toMatchObject({
      machine: "gha-ubuntu-24.04-x11",
      runner: "ubuntu-24.04",
      kind: "host",
      display: "x11",
    })
    expect(desktop[3]).toMatchObject({ machine: "debian-13", kind: "container", image: "debian:trixie" })
    const terminal = jobs.filter((job) => job.track === "terminal")
    expect(terminal.map((job) => `${job.env}:${job.shard}`)).toEqual([
      "ubuntu:1/2",
      "ubuntu:2/2",
      "debian:1/2",
      "debian:2/2",
      "macos:1/2",
      "macos:2/2",
    ])
    expect(jobs.every((job) => job.trials <= 2)).toBe(true)
  })

  it("lets a track name the environments it runs on", async () => {
    const path = await configFile({
      ...BASELINE,
      tracks: [{ track: "terminal", os: ["linux"], envs: ["debian"], contenders: ["kiko"] }],
    })
    const jobs = planJobs(readConfig(path), [task("terminal-001", "terminal", ["linux"])])
    expect(jobs.map((job) => job.env)).toEqual(["debian", "debian"])
  })
})

describe("inShard", () => {
  it("keeps one task in every n and covers every task across the shards", () => {
    const picks = [0, 1, 2, 3, 4].map((index) => [1, 2, 3].map((shard) => inShard(index, `${shard}/3`)))
    expect(picks).toEqual([
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [true, false, false],
      [false, true, false],
    ])
  })

  it("refuses a shard that is not written as a fraction", () => {
    expect(() => inShard(0, "1")).toThrow(/a shard is written 1\/3/)
    expect(() => inShard(0, "4/3")).toThrow(/a shard is written 1\/3/)
  })
})
