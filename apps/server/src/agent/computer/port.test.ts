import { describe, expect, it } from "vitest"
import { type UserComputerRpc, userComputer } from "./port"
import type { ComputerSummary } from "./types"

const pc = (id: string, name: string, online = true): ComputerSummary => ({
  id,
  name,
  os: "macos",
  online,
  caps: { shell: true, files: true, desktop: false, live: false, input: false },
  holder: "agent",
  displays: [],
  background: false,
  browsers: [],
})

const port = (all: readonly ComputerSummary[]) =>
  userComputer(() => ({ computerList: () => [...all] }) as unknown as UserComputerRpc, "room:agent", "room")

async function refusal(which: string | undefined, all: readonly ComputerSummary[]) {
  try {
    await port(all).resolve(which)
    return null
  } catch (error) {
    return error as { _tag: string; reason: string; message: string }
  }
}

describe("resolve", () => {
  it("uses the only computer when pc is left out", async () => {
    const one = pc("pc-1", "mac")
    await expect(port([one]).resolve()).resolves.toEqual(one)
  })

  it("refuses a name two computers share and lists their ids", async () => {
    const all = [pc("pc-1", "mac"), pc("pc-2", "MAC"), pc("pc-3", "box")]
    const error = await refusal("mac", all)
    expect(error?.reason).toBe("ambiguous")
    expect(error?.message).toContain("mac (pc-1), MAC (pc-2)")
    expect(error?.message).toContain("pass the id")
  })

  it("still finds a computer by its id when its name is shared", async () => {
    const all = [pc("pc-1", "mac"), pc("pc-2", "mac")]
    const found = await port(all).resolve("pc-2")
    expect(found.id).toBe("pc-2")
  })

  it("matches one unique name regardless of case", async () => {
    const all = [pc("pc-1", "mac"), pc("pc-2", "box")]
    await expect(port(all).resolve("BOX")).resolves.toEqual(all[1])
  })

  it("names every computer when pc matches none", async () => {
    const error = await refusal("crate", [pc("pc-1", "mac", false)])
    expect(error?.reason).toBe("unknown")
    expect(error?.message).toContain("mac (macos, offline)")
  })
})
