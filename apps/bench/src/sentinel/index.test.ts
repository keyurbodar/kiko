import { describe, expect, it } from "vitest"
import type { Exec, Machine, Os } from "../types"
import { startSentinel } from "./index"

class FakeMachine implements Machine {
  readonly os: Os = "linux"
  readonly id = "fake"
  readonly workdir = "/fake"
  readonly log = "/fake/sentinel.jsonl"
  readonly stopFile = "/fake/sentinel.stop"
  readonly spawned: string[][] = []
  readonly files = new Map<string, string>()

  constructor(private readonly initial: string) {}

  async exec(): Promise<Exec> {
    return { code: 0, stdout: "", stderr: "" }
  }

  async spawn(cmd: readonly string[]): Promise<{ pid: number; stop(): Promise<void> }> {
    this.spawned.push([...cmd])
    this.files.set(this.log, this.initial)
    return { pid: 7, stop: async () => {} }
  }

  async readText(path: string): Promise<string | undefined> {
    return this.files.get(path)
  }

  async writeText(path: string, text: string): Promise<void> {
    this.files.set(path, text)
    if (path === this.stopFile) {
      this.files.set(this.log, `${this.files.get(this.log) ?? ""}\n{"ev":"exit","t":9}`)
    }
  }
}

const events = [
  { ev: "ready", t: 0 },
  { ev: "sample", t: 100, front: "self", key: true, above: [], pointer: [500, 400] },
  { ev: "tick", t: 1000, received: true },
  { ev: "sample", t: 1100, front: "other", key: false, above: ["Other"], pointer: [520, 400] },
  { ev: "tick", t: 2000, received: false },
]
  .map((event) => JSON.stringify(event))
  .join("\n")

describe("startSentinel", () => {
  it("starts the platform command and reports the witnessed counters on stop", async () => {
    const machine = new FakeMachine(events)
    const sentinel = await startSentinel(machine)
    const background = await sentinel.stop()
    expect(background).toEqual({
      focusSteals: 1,
      pointerMoves: 1,
      keysSwallowed: 1,
      windowsRaised: 1,
    })
    expect(machine.spawned[0]?.slice(0, 3)).toEqual([
      "python3",
      "-u",
      expect.stringContaining("native/linux/sentinel.py"),
    ])
    expect(machine.files.get(machine.stopFile)).toBe("stop")
  })

  it("refuses to start when the sentinel reports an error", async () => {
    const machine = new FakeMachine('{"ev":"error","t":1,"message":"no focus"}')
    await expect(startSentinel(machine)).rejects.toThrow("no focus")
  })
})
