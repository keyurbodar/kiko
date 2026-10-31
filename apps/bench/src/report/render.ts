import type { Row } from "../ledger"

export interface ReportOptions {
  readonly generatedAt: string
  readonly sources: readonly string[]
}

const NULL = "\u0000"

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

function field(row: Row, column: keyof Row): string {
  return String(row[column] ?? "")
}

function amount(row: Row, column: keyof Row): number {
  const parsed = Number(row[column])
  return Number.isFinite(parsed) ? parsed : 0
}

function flag(row: Row, column: keyof Row): boolean {
  const raw = row[column]
  return raw === true || raw === 1 || raw === "true" || raw === "1"
}

function scored(row: Row): boolean {
  return field(row, "outcome") !== "setup_error"
}

function passed(row: Row): boolean {
  return flag(row, "pass")
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function integer(value: number): string {
  return Math.round(value).toLocaleString("en-US")
}

function money(value: number): string {
  return `$${value.toFixed(4)}`
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index] ?? 0
}

function millis(values: readonly number[]): string {
  if (values.length === 0) return "-"
  const p50 = Math.round(percentile(values, 0.5))
  const p95 = Math.round(percentile(values, 0.95))
  return `${integer(p50)} / ${integer(p95)}<span class="muted"> n=${values.length}</span>`
}

function positive(rows: readonly Row[], column: keyof Row): number[] {
  return rows.map((row) => amount(row, column)).filter((value) => value > 0)
}

interface ToolLatencyEntry {
  readonly calls: number
  readonly p50: number
  readonly p95: number
}

function toolLatencies(row: Row): Readonly<Record<string, ToolLatencyEntry>> {
  const raw = field(row, "tool_latency_by_name")
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, ToolLatencyEntry>
    return typeof parsed === "object" && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function toolLatencyRows(rows: readonly Row[]): string {
  const byName = new Map<string, { calls: number; p50: number[]; p95: number[] }>()
  for (const row of rows) {
    for (const [name, entry] of Object.entries(toolLatencies(row))) {
      const held = byName.get(name) ?? { calls: 0, p50: [], p95: [] }
      held.calls += entry.calls
      held.p50.push(entry.p50)
      held.p95.push(entry.p95)
      byName.set(name, held)
    }
  }
  if (byName.size === 0) return `<p class="empty">No per-tool latency recorded.</p>`
  const lines = [...byName.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, held]) => {
      const p50 = Math.round(median(held.p50))
      const p95 = Math.round(median(held.p95))
      return `<tr><th>${escapeHtml(name)}</th><td class="num">${held.calls}</td><td class="num">${integer(p50)}<span class="muted"> n=${held.p50.length}</span></td><td class="num">${integer(p95)}<span class="muted"> n=${held.p95.length}</span></td></tr>`
    })
    .join("")
  const head = `<tr><th>Tool</th><th class="num">Calls</th><th class="num">p50 ms</th><th class="num">p95 ms</th></tr>`
  return `<table><thead>${head}</thead><tbody>${lines}</tbody></table>`
}

function latencyTrack(track: string, trials: readonly Row[]): string {
  if (trials.length === 0) return `<h3>${escapeHtml(track)}</h3><p class="empty">No scored trials.</p>`
  const groups = [...groupRows(trials, ["contender", "model", "machine"]).values()].sort(compareGroups)
  const body = groups
    .map((group) => {
      const images = group.rows.map((row) => amount(row, "images_bytes"))
      const cells = [
        `<td>${escapeHtml(group.labels[0] ?? "")}</td>`,
        `<td>${escapeHtml(group.labels[1] ?? "")}</td>`,
        `<td>${escapeHtml(group.labels[2] ?? "")}</td>`,
        `<td class="num">${group.rows.length}</td>`,
        `<td class="num">${millis(positive(group.rows, "ttft_ms"))}</td>`,
        `<td class="num">${millis(positive(group.rows, "model_p50_ms"))}</td>`,
        `<td class="num">${millis(positive(group.rows, "tool_p50_ms"))}</td>`,
        `<td class="num">${millis(positive(group.rows, "tool_transport_ms"))}</td>`,
        `<td class="num">${millis(positive(group.rows, "tool_op_ms"))}</td>`,
        `<td class="num">${millis(positive(group.rows, "tool_queue_ms"))}</td>`,
        `<td class="num">${escapeHtml(integer(median(images)))}<span class="muted"> n=${group.rows.length}</span></td>`,
      ]
      return `<tr>${cells.join("")}</tr>`
    })
    .join("")
  const head = `<tr><th>Contender</th><th>Model</th><th>Machine</th><th class="num">Trials</th><th class="num">TTFT p50 / p95 ms</th><th class="num">Model p50 / p95 ms</th><th class="num">Tool p50 / p95 ms</th><th class="num">Transport p50 / p95 ms</th><th class="num">Op p50 / p95 ms</th><th class="num">Queue p50 / p95 ms</th><th class="num">Images bytes</th></tr>`
  return `<h3>${escapeHtml(track)}</h3><table><thead>${head}</thead><tbody>${body}</tbody></table><h3>${escapeHtml(track)} by tool</h3>${toolLatencyRows(trials)}`
}

function latencySection(rows: readonly Row[]): string {
  const trials = rows.filter((row) => scored(row))
  if (trials.length === 0) return section("Latency", `<p class="empty">No scored trials.</p>`)
  const tracks = uniqueSorted(trials, "track")
  const blocks = tracks
    .map((track) =>
      latencyTrack(
        track,
        trials.filter((row) => field(row, "track") === track),
      ),
    )
    .join("")
  const caption = `n=${trials.length} scored trials; TTFT and model percentiles pool every trial's value, and each cell states its own n. Tool time is transport plus op; queue is the wait between the model's reply and the tool.`
  return section("Latency", blocks, caption)
}

function wilson(successes: number, trials: number): readonly [number, number] {
  if (trials === 0) return [0, 0]
  const z = 1.959963984540054
  const p = successes / trials
  const z2 = z * z
  const denominator = 1 + z2 / trials
  const centre = (p + z2 / (2 * trials)) / denominator
  const spread = (z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials)) / denominator
  return [Math.max(0, centre - spread), Math.min(1, centre + spread)]
}

function timeOf(row: Row): number {
  const parsed = Date.parse(field(row, "ts"))
  return Number.isFinite(parsed) ? parsed : 0
}

function total(rows: readonly Row[], column: keyof Row): number {
  return rows.reduce((sum, row) => sum + amount(row, column), 0)
}

interface Group {
  readonly labels: readonly string[]
  readonly rows: Row[]
}

function groupRows(rows: readonly Row[], columns: readonly (keyof Row)[]): Map<string, Group> {
  const groups = new Map<string, Group>()
  for (const row of rows) {
    const labels = columns.map((column) => field(row, column))
    const key = labels.join(NULL)
    const existing = groups.get(key)
    if (existing === undefined) groups.set(key, { labels, rows: [row] })
    else existing.rows.push(row)
  }
  return groups
}

function uniqueSorted(rows: readonly Row[], column: keyof Row): readonly string[] {
  return [...new Set(rows.map((row) => field(row, column)))].sort((a, b) => a.localeCompare(b))
}

function compareGroups(a: Group, b: Group): number {
  return a.labels.join(NULL).localeCompare(b.labels.join(NULL))
}

function passAt5(rows: readonly Row[]): string {
  const groups = groupRows(rows, ["task", "machine"])
  let passedGroups = 0
  let counted = 0
  let undersampled = false
  for (const group of groups.values()) {
    if (group.rows.length < 5) {
      undersampled = true
      continue
    }
    counted += 1
    if (group.rows.every((row) => passed(row))) passedGroups += 1
  }
  if (counted === 0) return "n<5"
  const value = percent(passedGroups / counted)
  return undersampled ? `${value} (n<5)` : value
}

function heatCell(group: Group | undefined): string {
  if (group === undefined || group.rows.length === 0) return `<td class="num muted">-</td>`
  const passes = group.rows.filter((row) => passed(row)).length
  const value = group.rows.length >= 5 ? (passes === group.rows.length ? 1 : 0) : passes / group.rows.length
  const level = Math.max(0, Math.min(4, Math.round(value * 4)))
  const ink = level >= 3 ? "var(--heat-ink-strong)" : "var(--heat-ink)"
  return `<td class="num heat" style="background: var(--heat-${level}); color: ${ink}">${percent(value)}</td>`
}

function rateCell(group: Group | undefined): string {
  if (group === undefined) return `<td class="num muted">-</td>`
  const passes = group.rows.filter((row) => passed(row)).length
  return `<td class="num">${percent(passes / group.rows.length)}<span class="muted"> n=${group.rows.length}</span></td>`
}

interface Point {
  readonly label: string
  readonly cost: number
  readonly rate: number
}

function costPoints(rows: readonly Row[], contender: string): readonly Point[] {
  const trials = rows.filter((row) => scored(row) && field(row, "contender") === contender)
  const points: Point[] = []
  for (const group of groupRows(trials, ["task"]).values()) {
    const successes = group.rows.filter((row) => passed(row))
    if (successes.length === 0) continue
    const cost = median(successes.map((row) => amount(row, "cost_usd")))
    points.push({ label: group.labels[0] ?? "", cost, rate: successes.length / group.rows.length })
  }
  return points.sort((a, b) => a.cost - b.cost)
}

function paretoFront(points: readonly Point[]): readonly Point[] {
  const front = points.filter(
    (point) =>
      !points.some(
        (other) =>
          other !== point &&
          other.cost <= point.cost &&
          other.rate >= point.rate &&
          (other.cost < point.cost || other.rate > point.rate),
      ),
  )
  return [...front].sort((a, b) => a.cost - b.cost)
}

function seriesColour(index: number): string {
  return `var(--series-${index % 6})`
}

function axes(left: number, top: number, plotWidth: number, plotHeight: number): string {
  const bottom = top + plotHeight
  return [
    `<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="var(--line)" />`,
    `<line x1="${left}" y1="${bottom}" x2="${left + plotWidth}" y2="${bottom}" stroke="var(--line)" />`,
  ].join("")
}

function rateAxis(left: number, top: number, plotHeight: number): string {
  return [
    `<text x="${left - 8}" y="${top + 4}" text-anchor="end" font-size="11" fill="var(--muted)">100%</text>`,
    `<text x="${left - 8}" y="${top + plotHeight}" text-anchor="end" font-size="11" fill="var(--muted)">0%</text>`,
  ].join("")
}

function svg(width: number, height: number, label: string, content: string): string {
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}">${content}</svg>`
}

function legendHtml(entries: readonly { readonly label: string; readonly colour: string }[]): string {
  const items = entries.map(
    (entry) =>
      `<span><span class="swatch" style="background: ${entry.colour}"></span>${escapeHtml(entry.label)}</span>`,
  )
  return `<div class="legend">${items.join("")}</div>`
}

function histogramSvg(values: readonly number[], colour: string): string {
  const width = 460
  const height = 170
  const left = 40
  const right = 12
  const top = 12
  const bottom = 28
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const bins = 8
  const max = Math.max(...values, 1)
  const counts = Array.from({ length: bins }, () => 0)
  for (const value of values) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value / max) * bins)))
    counts[index] = (counts[index] ?? 0) + 1
  }
  const peak = Math.max(...counts, 1)
  const barWidth = plotWidth / bins
  const bars = counts
    .map((count, index) => {
      const barHeight = (count / peak) * plotHeight
      const barX = left + index * barWidth + 1
      const barY = top + plotHeight - barHeight
      return `<rect x="${barX.toFixed(1)}" y="${barY.toFixed(1)}" width="${Math.max(1, barWidth - 2).toFixed(1)}" height="${barHeight.toFixed(1)}" fill="${colour}" rx="2" />`
    })
    .join("")
  const labels = [
    `<text x="${left}" y="${top + plotHeight + 16}" font-size="10" fill="var(--muted)">0 ms</text>`,
    `<text x="${left + plotWidth}" y="${top + plotHeight + 16}" text-anchor="end" font-size="10" fill="var(--muted)">${escapeHtml(integer(max))} ms</text>`,
  ].join("")
  return svg(
    width,
    height,
    `wall clock distribution for ${values.length} trials`,
    `${axes(left, top, plotWidth, plotHeight)}${bars}${labels}`,
  )
}

function commitPoints(
  commits: readonly { readonly label: string }[],
  groups: Map<string, Group>,
  contender: string,
  x: (index: number) => number,
  y: (rate: number) => number,
): readonly { readonly x: number; readonly y: number }[] {
  const points: { x: number; y: number }[] = []
  commits.forEach((commit, index) => {
    const group = groups.get([contender, commit.label].join(NULL))
    if (group === undefined) return
    const passes = group.rows.filter((row) => passed(row)).length
    points.push({ x: x(index), y: y(passes / group.rows.length) })
  })
  return points
}

function commitLabels(
  commits: readonly { readonly label: string }[],
  x: (index: number) => number,
  baseline: number,
): readonly string[] {
  const step = commits.length > 10 ? Math.ceil(commits.length / 10) : 1
  return commits.flatMap((commit, index) => {
    if (index % step !== 0 && index !== commits.length - 1) return []
    return [
      `<text x="${x(index).toFixed(1)}" y="${baseline + 18}" text-anchor="middle" font-size="10" fill="var(--muted)">${escapeHtml(commit.label.slice(0, 10))}</text>`,
    ]
  })
}

function section(title: string, body: string, caption?: string): string {
  const note = caption === undefined ? "" : `<p class="caption">${escapeHtml(caption)}</p>`
  return `<section><h2>${escapeHtml(title)}</h2>${body}${note}</section>`
}

function headlineSection(rows: readonly Row[]): string {
  const trials = rows.filter((row) => scored(row))
  if (trials.length === 0) return section("Headline results", `<p class="empty">No scored trials.</p>`)
  const groups = [...groupRows(trials, ["contender", "model", "condition"]).values()].sort(compareGroups)
  const body = groups
    .map((group) => {
      const passes = group.rows.filter((row) => passed(row)).length
      const [low, high] = wilson(passes, group.rows.length)
      return [
        "<tr>",
        `<td>${escapeHtml(group.labels[0] ?? "")}</td>`,
        `<td>${escapeHtml(group.labels[1] ?? "")}</td>`,
        `<td>${escapeHtml(group.labels[2] ?? "")}</td>`,
        `<td class="num">${group.rows.length}</td>`,
        `<td class="num">${percent(passes / group.rows.length)}</td>`,
        `<td class="num">${percent(low)} - ${percent(high)}</td>`,
        `<td class="num">${escapeHtml(passAt5(group.rows))}</td>`,
        "</tr>",
      ].join("")
    })
    .join("")
  const head = `<tr><th>Contender</th><th>Model</th><th>Condition</th><th class="num">Trials</th><th class="num">pass@1</th><th class="num">Wilson 95%</th><th class="num">pass^5</th></tr>`
  const caption = `n=${trials.length} scored trials; pass^5 needs every rep in a task x machine group to pass, and is marked n<5 when a group has fewer than 5 reps.`
  return section("Headline results", `<table><thead>${head}</thead><tbody>${body}</tbody></table>`, caption)
}

function heatmapSection(rows: readonly Row[]): string {
  const trials = rows.filter((row) => scored(row))
  if (trials.length === 0) return section("Pass rate by task and machine", `<p class="empty">No scored trials.</p>`)
  const tasks = uniqueSorted(trials, "task")
  const machines = uniqueSorted(trials, "machine")
  const groups = groupRows(trials, ["task", "machine"])
  const head = `<tr><th>Task</th>${machines.map((machine) => `<th>${escapeHtml(machine)}</th>`).join("")}</tr>`
  const body = tasks
    .map((task) => {
      const cells = machines.map((machine) => heatCell(groups.get([task, machine].join(NULL))))
      return `<tr><th>${escapeHtml(task)}</th>${cells.join("")}</tr>`
    })
    .join("")
  const caption = `n=${trials.length} scored trials; cells show pass^5 when a task x machine group has 5 or more reps, otherwise pass@1.`
  return section(
    "Pass rate by task and machine",
    `<table><thead>${head}</thead><tbody>${body}</tbody></table>`,
    caption,
  )
}

function accuracyCostSection(rows: readonly Row[]): string {
  const trials = rows.filter((row) => scored(row))
  const contenders = uniqueSorted(trials, "contender")
  const series = contenders.map((contender) => ({ contender, points: costPoints(trials, contender) }))
  const points = series.flatMap((entry) => entry.points)
  if (points.length === 0) {
    return section("Accuracy vs cost", `<p class="empty">No task has a successful trial yet.</p>`)
  }
  const width = 980
  const height = 320
  const left = 56
  const right = 16
  const top = 16
  const bottom = 44
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const maxCost = Math.max(...points.map((point) => point.cost), 0.000001)
  const x = (cost: number): number => left + (cost / maxCost) * plotWidth
  const y = (rate: number): number => top + (1 - rate) * plotHeight
  const marks: string[] = [axes(left, top, plotWidth, plotHeight), rateAxis(left, top, plotHeight)]
  series.forEach((entry, index) => {
    const colour = seriesColour(index)
    for (const point of entry.points) {
      const title = `${entry.contender} ${point.label}: ${percent(point.rate)} at ${money(point.cost)}`
      marks.push(
        `<circle cx="${x(point.cost).toFixed(1)}" cy="${y(point.rate).toFixed(1)}" r="4" fill="${colour}"><title>${escapeHtml(title)}</title></circle>`,
      )
    }
    const front = paretoFront(entry.points)
    if (front.length > 1) {
      const line = front.map((point) => `${x(point.cost).toFixed(1)},${y(point.rate).toFixed(1)}`).join(" ")
      marks.push(`<polyline points="${line}" fill="none" stroke="${colour}" stroke-width="2" />`)
    }
  })
  marks.push(
    `<text x="${left}" y="${top + plotHeight + 18}" font-size="11" fill="var(--muted)">$0</text>`,
    `<text x="${left + plotWidth}" y="${top + plotHeight + 18}" text-anchor="end" font-size="11" fill="var(--muted)">${escapeHtml(money(maxCost))}</text>`,
    `<text x="${left + plotWidth / 2}" y="${top + plotHeight + 36}" text-anchor="middle" font-size="11" fill="var(--muted)">median cost per successful trial</text>`,
  )
  const legend = legendHtml(series.map((entry, index) => ({ label: entry.contender, colour: seriesColour(index) })))
  const caption = `n=${points.length} task points from successful trials; x is median cost per successful trial, y is pass rate. Lines show each contender's Pareto front.`
  return section("Accuracy vs cost", `${legend}${svg(width, height, "Accuracy versus cost", marks.join(""))}`, caption)
}

function modelGridSection(rows: readonly Row[]): string {
  const trials = rows.filter((row) => scored(row))
  if (trials.length === 0) return section("Pass@1 by model and contender", `<p class="empty">No scored trials.</p>`)
  const contenders = uniqueSorted(trials, "contender")
  const models = uniqueSorted(trials, "model")
  const groups = groupRows(trials, ["contender", "model"])
  const head = `<tr><th>Contender</th>${models.map((model) => `<th>${escapeHtml(model)}</th>`).join("")}</tr>`
  const body = contenders
    .map((contender) => {
      const cells = models.map((model) => rateCell(groups.get([contender, model].join(NULL))))
      return `<tr><th>${escapeHtml(contender)}</th>${cells.join("")}</tr>`
    })
    .join("")
  const caption = `n=${trials.length} scored trials; cells show pass@1 with the number of trials.`
  return section(
    "Pass@1 by model and contender",
    `<table><thead>${head}</thead><tbody>${body}</tbody></table>`,
    caption,
  )
}

function timeSection(rows: readonly Row[]): string {
  const successes = rows.filter((row) => scored(row) && passed(row))
  if (successes.length === 0) return section("Time to complete", `<p class="empty">No successful trials.</p>`)
  const contenders = uniqueSorted(successes, "contender")
  const charts = contenders.map((contender, index) => {
    const values = successes.filter((row) => field(row, "contender") === contender).map((row) => amount(row, "wall_ms"))
    return `<div><h3>${escapeHtml(contender)}</h3>${histogramSvg(values, seriesColour(index))}</div>`
  })
  const caption = `n=${successes.length} successful trials; each bar counts trials in a wall-clock bucket.`
  return section("Time to complete", `<div class="grid">${charts.join("")}</div>`, caption)
}

function tokenSection(rows: readonly Row[]): string {
  const successes = rows.filter((row) => scored(row) && passed(row))
  if (successes.length === 0)
    return section("Tokens per success by track", `<p class="empty">No successful trials.</p>`)
  const contenders = uniqueSorted(successes, "contender")
  const tracks = uniqueSorted(successes, "track")
  const groups = groupRows(successes, ["track", "contender"])
  const head = `<tr><th>Track</th>${contenders.map((contender) => `<th class="num">${escapeHtml(contender)}</th>`).join("")}</tr>`
  const body = tracks
    .map((track) => {
      const cells = contenders.map((contender) => {
        const group = groups.get([track, contender].join(NULL))
        if (group === undefined) return `<td class="num muted">-</td>`
        const values = group.rows.map((row) => amount(row, "tokens_in") + amount(row, "tokens_out"))
        return `<td class="num">${escapeHtml(integer(median(values)))}<span class="muted"> n=${group.rows.length}</span></td>`
      })
      return `<tr><th>${escapeHtml(track)}</th>${cells.join("")}</tr>`
    })
    .join("")
  const caption = `n=${successes.length} successful trials; cells show the median of tokens_in + tokens_out.`
  return section("Tokens per success by track", `<table><thead>${head}</thead><tbody>${body}</tbody></table>`, caption)
}

function backgroundSection(rows: readonly Row[]): string {
  const contenders = uniqueSorted(rows, "contender")
  if (contenders.length === 0) return section("Background safety", `<p class="empty">No trials.</p>`)
  const background = rows.filter((row) => field(row, "condition") === "background")
  const groups = groupRows(background, ["contender"])
  const body = contenders
    .map((contender) => {
      const group = groups.get(contender)
      const trials = group?.rows ?? []
      const steals = total(trials, "focus_steals")
      const moves = total(trials, "pointer_moves")
      const keys = total(trials, "keys_swallowed")
      const raised = total(trials, "windows_raised")
      const per100 = trials.length === 0 ? 0 : ((steals + moves + keys + raised) / trials.length) * 100
      return [
        "<tr>",
        `<th>${escapeHtml(contender)}</th>`,
        `<td class="num">${trials.length}</td>`,
        `<td class="num">${integer(steals)}</td>`,
        `<td class="num">${integer(moves)}</td>`,
        `<td class="num">${integer(keys)}</td>`,
        `<td class="num">${integer(raised)}</td>`,
        `<td class="num">${per100.toFixed(1)}</td>`,
        "</tr>",
      ].join("")
    })
    .join("")
  const head = `<tr><th>Contender</th><th class="num">Background trials</th><th class="num">Focus steals</th><th class="num">Pointer moves</th><th class="num">Keys swallowed</th><th class="num">Windows raised</th><th class="num">Per 100 trials</th></tr>`
  const caption = `n=${background.length} background trials; disturbance counters are summed and scaled to 100 trials. Zero means no background trials or no disturbances.`
  return section("Background safety", `<table><thead>${head}</thead><tbody>${body}</tbody></table>`, caption)
}

function trendSection(rows: readonly Row[]): string {
  const trials = rows.filter((row) => scored(row))
  if (trials.length === 0) return section("Trend by commit", `<p class="empty">No scored trials.</p>`)
  const commits = [...groupRows(trials, ["commit"]).values()]
    .map((group) => ({
      label: group.labels[0] ?? "",
      time: Math.min(...group.rows.map((row) => timeOf(row))),
    }))
    .sort((a, b) => a.time - b.time || a.label.localeCompare(b.label))
  const contenders = uniqueSorted(trials, "contender")
  const groups = groupRows(trials, ["contender", "commit"])
  const width = 980
  const height = 300
  const left = 56
  const right = 16
  const top = 16
  const bottom = 72
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const x = (index: number): number =>
    commits.length <= 1 ? left + plotWidth / 2 : left + (index / (commits.length - 1)) * plotWidth
  const y = (rate: number): number => top + (1 - rate) * plotHeight
  const marks: string[] = [axes(left, top, plotWidth, plotHeight), rateAxis(left, top, plotHeight)]
  contenders.forEach((contender, index) => {
    const colour = seriesColour(index)
    const points = commitPoints(commits, groups, contender, x, y)
    if (points.length === 0) return
    const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")
    marks.push(`<polyline points="${line}" fill="none" stroke="${colour}" stroke-width="2" />`)
    for (const point of points) {
      marks.push(`<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3" fill="${colour}" />`)
    }
  })
  marks.push(...commitLabels(commits, x, top + plotHeight))
  const legend = legendHtml(contenders.map((contender, index) => ({ label: contender, colour: seriesColour(index) })))
  const caption = `n=${trials.length} scored trials across ${commits.length} commits, ordered by first trial time.`
  return section("Trend by commit", `${legend}${svg(width, height, "Pass rate by commit", marks.join(""))}`, caption)
}

function failureSection(rows: readonly Row[]): string {
  const failed = rows.filter((row) => !passed(row))
  if (failed.length === 0) return section("Failure taxonomy", `<p class="empty">No failed trials.</p>`)
  const entries = [...groupRows(failed, ["fail_class"]).values()]
    .map((group) => ({
      label: (group.labels[0] ?? "").trim() || "unknown",
      count: group.rows.length,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  const peak = Math.max(...entries.map((entry) => entry.count), 1)
  const bars = entries
    .map(
      (entry) =>
        `<div class="fail-row"><span>${escapeHtml(entry.label)}</span><span class="fail-bar"><span class="fail-fill" style="width: ${((entry.count / peak) * 100).toFixed(1)}%"></span></span><span class="num">${entry.count}</span></div>`,
    )
    .join("")
  const caption = `n=${failed.length} failed trials, including setup errors.`
  return section("Failure taxonomy", bars, caption)
}

function costSection(rows: readonly Row[]): string {
  if (rows.length === 0) return section("Cost to run", `<p class="empty">No rows.</p>`)
  const groups = [...groupRows(rows, ["contender", "model"]).values()].sort(compareGroups)
  const body = groups
    .map((group) => {
      const tokens = total(group.rows, "tokens_in") + total(group.rows, "tokens_out")
      return [
        "<tr>",
        `<td>${escapeHtml(group.labels[0] ?? "")}</td>`,
        `<td>${escapeHtml(group.labels[1] ?? "")}</td>`,
        `<td class="num">${money(total(group.rows, "cost_usd"))}</td>`,
        `<td class="num">${escapeHtml(integer(tokens))}</td>`,
        `<td class="num">${group.rows.length}</td>`,
        "</tr>",
      ].join("")
    })
    .join("")
  const tokens = total(rows, "tokens_in") + total(rows, "tokens_out")
  const foot = `<tr><th>Total</th><th></th><td class="num">${money(total(rows, "cost_usd"))}</td><td class="num">${escapeHtml(integer(tokens))}</td><td class="num">${rows.length}</td></tr>`
  const head = `<tr><th>Contender</th><th>Model</th><th class="num">Cost (USD)</th><th class="num">Tokens in + out</th><th class="num">Rows</th></tr>`
  const caption = `n=${rows.length} rows, including setup errors.`
  return section(
    "Cost to run",
    `<table><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`,
    caption,
  )
}

function header(options: ReportOptions): string {
  const sources = options.sources.length === 0 ? "none recorded" : options.sources.join(", ")
  return `<header><h1>Computer-use bench report</h1><p class="muted">Generated ${escapeHtml(options.generatedAt)} from ${escapeHtml(sources)}.</p></header>`
}

const STYLES = `
:root {
  --bg: #f6f6f3;
  --panel: #ffffff;
  --ink: #1d1d1b;
  --muted: #64645e;
  --line: #d9d9d2;
  --accent: #2f6f5e;
  --bad: #a5453a;
  --heat-0: #f1f1ec;
  --heat-1: #dbe8e2;
  --heat-2: #b3d0c4;
  --heat-3: #7bad9a;
  --heat-4: #2f6f5e;
  --heat-ink: #1d1d1b;
  --heat-ink-strong: #f6f6f3;
  --series-0: #2f6f5e;
  --series-1: #8a5a2b;
  --series-2: #3f5d8a;
  --series-3: #7a4b73;
  --series-4: #4f6b2f;
  --series-5: #8a3f3f;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141513;
    --panel: #1c1d1a;
    --ink: #ecece7;
    --muted: #a3a39b;
    --line: #35362f;
    --accent: #7fc3ac;
    --bad: #e0897e;
    --heat-0: #232420;
    --heat-1: #2c3a34;
    --heat-2: #3d5a4e;
    --heat-3: #5d8d79;
    --heat-4: #8fd0b8;
    --heat-ink: #ecece7;
    --heat-ink-strong: #141513;
    --series-0: #7fc3ac;
    --series-1: #d3a06b;
    --series-2: #8aa7d6;
    --series-3: #c48fbb;
    --series-4: #a3c47f;
    --series-5: #d98f8f;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
}
main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 26px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 0 0 10px; }
h3 { font-size: 13px; margin: 0 0 6px; color: var(--muted); font-weight: 600; }
section {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 18px 20px;
  margin: 18px 0;
}
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: var(--bg); font-weight: 600; }
tfoot th, tfoot td { border-top: 2px solid var(--line); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); }
.caption { color: var(--muted); font-size: 12px; margin: 8px 0 0; }
.empty { color: var(--muted); font-style: italic; margin: 0; }
.chart { display: block; width: 100%; height: auto; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 8px; font-size: 12px; color: var(--muted); }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
.fail-row { display: grid; grid-template-columns: 180px 1fr 48px; gap: 8px; align-items: center; margin: 4px 0; }
.fail-bar { display: block; background: var(--line); border-radius: 3px; height: 14px; overflow: hidden; }
.fail-fill { display: block; background: var(--bad); height: 100%; }
.heat { font-variant-numeric: tabular-nums; }
@media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
`

export function renderReport(rows: readonly Row[], options: ReportOptions): string {
  const sections = [
    headlineSection(rows),
    heatmapSection(rows),
    accuracyCostSection(rows),
    modelGridSection(rows),
    timeSection(rows),
    latencySection(rows),
    tokenSection(rows),
    backgroundSection(rows),
    trendSection(rows),
    failureSection(rows),
    costSection(rows),
  ].join("\n")
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Computer-use bench report</title>
<style>${STYLES}</style>
</head>
<body>
<main>
${header(options)}
${sections}
</main>
</body>
</html>`
}
