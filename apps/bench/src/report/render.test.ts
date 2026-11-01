import { describe, expect, it } from "vitest"
import { COLUMNS, type Column, type Row } from "../ledger"
import { renderReport } from "./render"

type Value = string | number | boolean

function makeRow(overrides: Partial<Record<Column, Value>>): Row {
  const base = Object.fromEntries(COLUMNS.map((column) => [column, ""])) as Record<Column, string>
  return { ...base, ...overrides } as Row
}

const ROWS: readonly Row[] = [
  makeRow({
    trial_id: "1",
    ts: "2026-10-01T10:00:00Z",
    commit: "aaaa1111",
    task: "open-app",
    track: "desktop",
    machine: "m1",
    contender: "cua",
    model: "model-a",
    condition: "foreground",
    rep: 1,
    outcome: "ok",
    pass: true,
    tokens_in: 1200,
    tokens_out: 300,
    cost_usd: 0.12,
    wall_ms: 12000,
  }),
  makeRow({
    trial_id: "2",
    ts: "2026-10-01T10:05:00Z",
    commit: "aaaa1111",
    task: "open-app",
    track: "desktop",
    machine: "m1",
    contender: "cua",
    model: "model-a",
    condition: "foreground",
    rep: 2,
    outcome: "ok",
    pass: true,
    tokens_in: 1100,
    tokens_out: 280,
    cost_usd: 0.15,
    wall_ms: 15000,
  }),
  makeRow({
    trial_id: "3",
    ts: "2026-10-02T10:00:00Z",
    commit: "bbbb2222",
    task: "open-app",
    track: "desktop",
    machine: "m2",
    contender: "cua",
    model: "model-a",
    condition: "foreground",
    rep: 1,
    outcome: "ok",
    pass: false,
    fail_class: "timeout",
    tokens_in: 2000,
    tokens_out: 400,
    cost_usd: 0.2,
    wall_ms: 30000,
  }),
  makeRow({
    trial_id: "4",
    ts: "2026-10-02T10:05:00Z",
    commit: "bbbb2222",
    task: "save-file",
    track: "terminal",
    machine: "m1",
    contender: "cua",
    model: "model-b",
    condition: "foreground",
    rep: 1,
    outcome: "ok",
    pass: true,
    tokens_in: 900,
    tokens_out: 200,
    cost_usd: 0.08,
    wall_ms: 9000,
  }),
  makeRow({
    trial_id: "5",
    ts: "2026-10-02T10:10:00Z",
    commit: "bbbb2222",
    task: "save-file",
    track: "terminal",
    machine: "m2",
    contender: "cua",
    model: "model-b",
    condition: "background",
    rep: 1,
    outcome: "ok",
    pass: false,
    fail_class: "wrong-output",
    tokens_in: 800,
    tokens_out: 180,
    cost_usd: 0.1,
    wall_ms: 11000,
    focus_steals: 1,
    pointer_moves: 2,
    keys_swallowed: 0,
    windows_raised: 1,
  }),
  makeRow({
    trial_id: "6",
    ts: "2026-10-01T11:00:00Z",
    commit: "aaaa1111",
    task: "open-app",
    track: "desktop",
    machine: "m1",
    contender: "atlas",
    model: "model-a",
    condition: "foreground",
    rep: 1,
    outcome: "ok",
    pass: false,
    fail_class: "crashed",
    tokens_in: 700,
    tokens_out: 150,
    cost_usd: 0.05,
    wall_ms: 20000,
  }),
  makeRow({
    trial_id: "7",
    ts: "2026-10-01T11:05:00Z",
    commit: "aaaa1111",
    task: "save-file",
    track: "terminal",
    machine: "m1",
    contender: "atlas",
    model: "model-a",
    condition: "foreground",
    rep: 1,
    outcome: "ok",
    pass: true,
    tokens_in: 1000,
    tokens_out: 220,
    cost_usd: 0.09,
    wall_ms: 13000,
  }),
  makeRow({
    trial_id: "8",
    ts: "2026-10-02T11:00:00Z",
    commit: "bbbb2222",
    task: "open-app",
    track: "desktop",
    machine: "m2",
    contender: "atlas",
    model: "model-b",
    condition: "background",
    rep: 1,
    outcome: "ok",
    pass: true,
    tokens_in: 1300,
    tokens_out: 260,
    cost_usd: 0.14,
    wall_ms: 17000,
    focus_steals: 0,
    pointer_moves: 1,
    keys_swallowed: 1,
    windows_raised: 0,
  }),
  makeRow({
    trial_id: "9",
    ts: "2026-10-02T11:05:00Z",
    commit: "bbbb2222",
    task: "save-file",
    track: "terminal",
    machine: "m2",
    contender: "atlas",
    model: "model-b",
    condition: "foreground",
    rep: 1,
    outcome: "ok",
    pass: true,
    tokens_in: 950,
    tokens_out: 210,
    cost_usd: 0.07,
    wall_ms: 10000,
  }),
  makeRow({
    trial_id: "10",
    ts: "2026-10-02T11:10:00Z",
    commit: "bbbb2222",
    task: "open-app",
    track: "desktop",
    machine: "m1",
    contender: "cua",
    model: "model-a",
    condition: "foreground",
    rep: 3,
    outcome: "setup_error",
    pass: false,
    fail_class: "setup",
    tokens_in: 10,
    tokens_out: 5,
    cost_usd: 0.001,
    wall_ms: 500,
  }),
]

const OPTIONS = { generatedAt: "2026-10-31T12:00:00Z", sources: ["runs/ledger.tsv"] }

describe("renderReport", () => {
  const html = renderReport(ROWS, OPTIONS)

  it("returns one self-contained html document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true)
  })

  it("states sample sizes and shows pass@1", () => {
    expect(html).toContain("n=")
    expect(html).toContain("pass@1")
  })

  it("shows latency per track with per-tool percentiles", () => {
    const rows = [
      makeRow({
        trial_id: "lat-1",
        ts: "2026-10-03T10:00:00Z",
        commit: "cccc3333",
        task: "env-001",
        track: "environment",
        machine: "m1",
        contender: "kiko-remote",
        model: "model-a",
        condition: "foreground",
        outcome: "done",
        pass: true,
        ttft_ms: 120,
        model_p50_ms: 900,
        model_p95_ms: 1500,
        tool_p50_ms: 40,
        tool_p95_ms: 80,
        tool_transport_ms: 12,
        tool_op_ms: 28,
        tool_queue_ms: 3,
        tool_latency_by_name: JSON.stringify({ computer_shell: { calls: 2, p50: 40, p95: 80 } }),
        images_bytes: 2048,
      }),
    ]
    const latency = renderReport(rows, OPTIONS)
    expect(latency).toContain("<h2>Latency</h2>")
    expect(latency).toContain("<h3>environment</h3>")
    expect(latency).toContain("TTFT p50 / p95 ms")
    expect(latency).toContain("computer_shell")
    expect(latency).toContain("n=1")
  })

  it("makes no external requests", () => {
    expect(html).not.toContain("http://")
    expect(html).not.toContain("https://")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("fetch(")
  })

  it("draws inline charts", () => {
    expect(html).toContain("<svg")
  })

  it("escapes text interpolated into the document", () => {
    const escaped = renderReport(ROWS, { generatedAt: "<b>today</b>", sources: ["a&b"] })
    expect(escaped).toContain("&lt;b&gt;today&lt;/b&gt;")
    expect(escaped).toContain("a&amp;b")
    expect(escaped).not.toContain("<b>today</b>")
  })

  it("renders an empty ledger without throwing", () => {
    const empty = renderReport([], { generatedAt: "2026-10-31T12:00:00Z", sources: [] })
    expect(empty.startsWith("<!doctype html>")).toBe(true)
    expect(empty).not.toContain("<svg")
  })

  it("counts a trial that measured nothing as unmeasured instead of zero", () => {
    const blind = renderReport(
      [
        makeRow({
          trial_id: "blind",
          ts: "2026-10-03T10:00:00Z",
          commit: "cccc3333",
          task: "open-app",
          track: "desktop",
          machine: "m1",
          contender: "cua",
          model: "model-a",
          condition: "background",
          rep: 1,
          outcome: "ok",
          pass: false,
          focus_steals: "unmeasured",
          pointer_moves: "unmeasured",
          keys_swallowed: "unmeasured",
          windows_raised: "unmeasured",
        }),
      ],
      OPTIONS,
    )
    expect(blind).toContain('<th class="num">Unmeasured trials</th>')
    expect(blind).toContain(
      '<th>cua</th><td class="num">1</td><td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">0</td><td class="num">1</td><td class="num">0.0</td>',
    )
  })
})
