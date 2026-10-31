import { describe, expect, it } from "@effect/vitest"
import type { Context } from "@earendil-works/chord"
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable"
import type { Op } from "@kiko/computer/wire"
import type { ComputerPort } from "./port"
import { terminalTools } from "./terminal"
import type { ComputerCallOutcome, ComputerSummary } from "./types"

type Answer = (op: Op, args: Record<string, unknown>) => ComputerCallOutcome

const TERMINAL = {
  id: "t-1",
  name: "repl",
  cwd: "/home/owner",
  shell: "/bin/bash",
  cols: 120,
  rows: 30,
  status: "running" as const,
  exitCode: null,
}

function summary(extra: Partial<ComputerSummary> = {}): ComputerSummary {
  return {
    id: "pc-1",
    name: "Mac",
    os: "macos",
    online: true,
    caps: {
      shell: true,
      files: true,
      desktop: true,
      live: true,
      input: true,
      background: true,
      browser: true,
      terminal: true,
    },
    holder: "agent",
    displays: [],
    background: true,
    browsers: [],
    ...extra,
  }
}

function harness(pc: ComputerSummary, answer: Answer) {
  const calls: { pcId: string; op: Op; args: Record<string, unknown> }[] = []
  const port: ComputerPort = {
    list: async () => [pc],
    resolve: async () => pc,
    call: async (pcId, op, args) => {
      calls.push({ pcId, op, args: args as Record<string, unknown> })
      return answer(op, args as Record<string, unknown>)
    },
    link: async () => ({ ok: true }),
    desktopTools: async () => [],
  }
  const tools: ToolRegistration[] = terminalTools({ port: () => port, acceptsImages: () => false, desktop: [] })
  const tool = (name: string) => {
    const found = tools.find((entry) => entry.name === name)
    if (!found) throw new Error(`no ${name} tool`)
    return found
  }
  return { calls, tool }
}

const api = {
  conversationId: 0,
  agent: async () => ({ model: undefined }),
  env: undefined,
} as unknown as ToolExecutionApi

const context = {} as Context

const textOf = (out: { output?: readonly { type: string; text?: string }[] }) =>
  (out.output ?? []).map((part) => part.text ?? "").join("")

const reply = (value: unknown): ComputerCallOutcome => ({ ok: true, value })

describe("terminal_open", () => {
  it("opens a terminal and says how to use it", async () => {
    const { calls, tool } = harness(summary(), () => reply(TERMINAL))

    const out = await tool("terminal_open").execute({ cwd: "~/work", name: "repl" }, api, context)

    expect(calls[0]).toMatchObject({ pcId: "pc-1", op: "terminal_open", args: { cwd: "~/work", name: "repl" } })
    expect(textOf(out)).toContain("opened repl (t-1) running /bin/bash in /home/owner, 120x30")
    expect(textOf(out)).toContain("terminal_send")
  })

  it("tells the owner to update an app without terminals", async () => {
    const pc = summary({ caps: { shell: true, files: true, desktop: true, live: true, input: true } })
    const { calls, tool } = harness(pc, () => reply(TERMINAL))

    const out = await tool("terminal_open").execute({}, api, context)

    expect(calls).toHaveLength(0)
    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("update the app on it")
  })

  it("explains when policy blocks terminals", async () => {
    const pc = summary({ caps: { ...summary().caps, terminal: false } })
    const { tool } = harness(pc, () => reply(TERMINAL))

    const out = await tool("terminal_open").execute({}, api, context)

    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("blocks opening terminals")
  })

  it("reports a refused call", async () => {
    const { tool } = harness(summary(), () => ({ ok: false, code: "denied", message: "policy.json" }))

    const out = await tool("terminal_open").execute({}, api, context)

    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("The owner's policy on Mac blocks this.")
  })
})

describe("terminal_send", () => {
  it("types text and keys", async () => {
    const { calls, tool } = harness(summary(), () => reply({ id: "t-1", bytes: 4 }))

    const out = await tool("terminal_send").execute({ id: "t-1", text: "ls", keys: ["enter"] }, api, context)

    expect(calls[0]).toMatchObject({ op: "terminal_send", args: { id: "t-1", text: "ls", keys: ["enter"] } })
    expect(textOf(out)).toContain("sent 4 bytes to t-1 on Mac")
  })

  it("needs text or keys", async () => {
    const { calls, tool } = harness(summary(), () => reply({ id: "t-1", bytes: 0 }))

    const out = await tool("terminal_send").execute({ id: "t-1" }, api, context)

    expect(calls).toHaveLength(0)
    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("needs text or keys")
  })

  it("sends and waits in one call when until is given", async () => {
    const { calls, tool } = harness(summary(), () =>
      reply({ id: "t-1", bytes: 5, matched: true, timedOut: false, exited: false, text: "done\n" }),
    )

    const out = await tool("terminal_send").execute(
      { id: "t-1", text: "make", keys: ["enter"], until: "done" },
      api,
      context,
    )

    expect(calls[0]).toMatchObject({
      op: "terminal_send",
      args: { id: "t-1", text: "make", keys: ["enter"], until: "done", timeoutMs: 30_000 },
    })
    expect(textOf(out)).toContain('sent 5 bytes to t-1 on Mac and found "done"')
    expect(textOf(out)).toContain("done")
  })

  it("says when the send waited and timed out", async () => {
    const { tool } = harness(summary(), () =>
      reply({ id: "t-1", bytes: 1, matched: false, timedOut: true, exited: false, text: "partial" }),
    )

    const out = await tool("terminal_send").execute(
      { id: "t-1", text: "x", until: "done", timeoutMs: 5_000 },
      api,
      context,
    )

    expect(textOf(out)).toContain('waited 5 s and did not see "done"')
    expect(textOf(out)).toContain("partial")
  })

  it("says when the computer's app cannot wait yet", async () => {
    const { tool } = harness(summary(), () => reply({ id: "t-1", bytes: 4 }))

    const out = await tool("terminal_send").execute({ id: "t-1", text: "make", until: "done" }, api, context)

    expect(textOf(out)).toContain("cannot wait yet")
  })

  it("refuses an empty until", async () => {
    const { calls, tool } = harness(summary(), () => reply({ id: "t-1", bytes: 1 }))

    const out = await tool("terminal_send").execute({ id: "t-1", text: "x", until: "  " }, api, context)

    expect(calls).toHaveLength(0)
    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("until needs some text")
  })
})

describe("terminal_read", () => {
  it("reads the screen", async () => {
    const { calls, tool } = harness(summary(), () =>
      reply({ ...TERMINAL, mode: "screen", text: ">>> print(6*7)\n42", truncated: false }),
    )

    const out = await tool("terminal_read").execute({ id: "t-1", mode: "screen" }, api, context)

    expect(calls[0]).toMatchObject({ op: "terminal_read", args: { id: "t-1", mode: "screen" } })
    expect(textOf(out)).toContain("t-1 on Mac, 120x30, running")
    expect(textOf(out)).toContain("42")
  })

  it("states when the tail was cut", async () => {
    const { tool } = harness(summary(), () =>
      reply({ ...TERMINAL, mode: "tail", text: "three\nfour", truncated: true }),
    )

    const out = await tool("terminal_read").execute({ id: "t-1", mode: "tail", lines: 2 }, api, context)

    expect(textOf(out)).toContain("older output was cut")
    expect(textOf(out)).toContain("three\nfour")
  })

  it("reports an exited terminal", async () => {
    const { tool } = harness(summary(), () =>
      reply({ ...TERMINAL, mode: "tail", text: "", truncated: false, status: "exited", exitCode: 2 }),
    )

    const out = await tool("terminal_read").execute({ id: "t-1", mode: "tail" }, api, context)

    expect(textOf(out)).toContain("exited with code 2")
    expect(textOf(out)).toContain("(no output)")
  })
})

describe("terminal_wait", () => {
  it("waits with the requested timeout and deadline", async () => {
    const { calls, tool } = harness(summary(), () =>
      reply({ id: "t-1", matched: true, timedOut: false, exited: false, text: ">>> " }),
    )

    const out = await tool("terminal_wait").execute({ id: "t-1", until: ">>>", timeoutMs: 20_000 }, api, context)

    expect(calls[0]).toMatchObject({ op: "terminal_wait", args: { id: "t-1", until: ">>>", timeoutMs: 20_000 } })
    expect(textOf(out)).toContain('found ">>>" in t-1 on Mac')
  })

  it("needs some text to look for", async () => {
    const { calls, tool } = harness(summary(), () =>
      reply({ id: "t-1", matched: false, timedOut: true, exited: false, text: "" }),
    )

    const out = await tool("terminal_wait").execute({ id: "t-1", until: "  " }, api, context)

    expect(calls).toHaveLength(0)
    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("needs some text to look for")
  })

  it("says when the wait timed out", async () => {
    const { tool } = harness(summary(), () =>
      reply({ id: "t-1", matched: false, timedOut: true, exited: false, text: "partial" }),
    )

    const out = await tool("terminal_wait").execute({ id: "t-1", until: "done" }, api, context)

    expect(textOf(out)).toContain('waited 30 s and did not see "done"')
  })

  it("says when the terminal exited first", async () => {
    const { tool } = harness(summary(), () =>
      reply({ id: "t-1", matched: false, timedOut: false, exited: true, text: "bye" }),
    )

    const out = await tool("terminal_wait").execute({ id: "t-1", until: "done" }, api, context)

    expect(textOf(out)).toContain('exited while waiting for "done"')
  })
})

describe("terminal_list", () => {
  it("lists open terminals", async () => {
    const { tool } = harness(summary(), () => reply({ terminals: [TERMINAL] }))

    const out = await tool("terminal_list").execute({}, api, context)

    expect(textOf(out)).toContain("1 terminal session(s) on Mac:")
    expect(textOf(out)).toContain('t-1 "repl" /home/owner 120x30 running')
  })

  it("says when none are open", async () => {
    const { tool } = harness(summary(), () => reply({ terminals: [] }))

    const out = await tool("terminal_list").execute({}, api, context)

    expect(textOf(out)).toContain("no terminal sessions are open on Mac")
  })
})

describe("terminal_close", () => {
  it("closes a terminal", async () => {
    const { calls, tool } = harness(summary(), () => reply({ id: "t-1", closed: true }))

    const out = await tool("terminal_close").execute({ id: "t-1" }, api, context)

    expect(calls[0]).toMatchObject({ op: "terminal_close", args: { id: "t-1" } })
    expect(textOf(out)).toContain("closed t-1 on Mac")
  })

  it("reports an unknown id", async () => {
    const { tool } = harness(summary(), () => ({
      ok: false,
      code: "failed",
      message: "there is no terminal t-9; terminal_list shows the open ones",
    }))

    const out = await tool("terminal_close").execute({ id: "t-9" }, api, context)

    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("there is no terminal t-9")
  })
})
