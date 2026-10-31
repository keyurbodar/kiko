import type { ComputerCaps, ComputerSummary, UserStreamItem } from "@kiko/protocol"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { CliError, type Context } from "../context"

export const WAIT_BUDGET = Duration.seconds(60)

type Computers = Stream.Stream<readonly ComputerSummary[], CliError>

function capabilityList(caps: ComputerCaps, background: boolean): readonly string[] {
  const list: string[] = []
  if (caps.shell) list.push("shell")
  if (caps.files) list.push("files")
  if (caps.desktop) list.push("desktop")
  if (caps.input) list.push("input")
  if (caps.live) list.push("live")
  if (caps.browser) list.push("browser")
  if (caps.terminal) list.push("terminal")
  if (background) list.push("background")
  return list
}

export function describeComputer(pc: ComputerSummary): string {
  return `${pc.name} (${pc.os}): ${capabilityList(pc.caps, pc.background).join(", ") || "no capabilities reported"}`
}

export interface DaemonReadings {
  welcomed: boolean
  cannotReach: string | null
  refused: string | null
  protocol: string | null
}

export function readDaemonLog(lines: readonly string[]): DaemonReadings {
  const readings: DaemonReadings = { welcomed: false, cannotReach: null, refused: null, protocol: null }
  for (const line of lines) {
    if (line.includes("the worker calls this machine")) readings.welcomed = true
    if (line.includes("cannot reach")) readings.cannotReach = line.trim()
    if (line.includes("the worker refused the connection")) readings.refused = line.trim()
    if (line.includes("speaks computer protocol")) readings.protocol = line.trim()
  }
  return readings
}

export interface AddDiagnosis {
  readonly reason: "started" | "unreachable" | "refused" | "unkept"
  readonly detail?: string
}

export function diagnose(log: string | null, readings: DaemonReadings): AddDiagnosis {
  if (readings.protocol) return { reason: "unreachable", detail: readings.protocol }
  if (readings.cannotReach) return { reason: "unreachable", detail: readings.cannotReach }
  if (readings.refused) return { reason: "refused", detail: readings.refused }
  if (log === null) return { reason: "unkept", detail: "no daemon log exists on the machine" }
  if (readings.welcomed)
    return { reason: "started", detail: `${log}\n(the daemon reached the worker but the computer never came online)` }
  return { reason: "started", detail: log }
}

export function failureMessage(result: AddDiagnosis, target: string): string {
  switch (result.reason) {
    case "started":
      return `the daemon on ${target} never came online. last 20 log lines:\n${result.detail}`
    case "unreachable":
      return `the daemon started on ${target} but cannot reach the worker: ${result.detail}`
    case "refused":
      return `the worker refused the pairing from ${target}: ${result.detail}`
    case "unkept":
      return `${target} cannot keep a kiko daemon running: ${result.detail}. kiko computers need a persistent user session (systemd --user or launchd), so this machine is not a supported environment`
  }
}

export function daemonLogTailCommand(remoteOs: "macos" | "linux" | "windows" | undefined): string {
  if (remoteOs === "macos")
    return 'tail -n 20 "$HOME/Library/Application Support/kiko-computer/daemon.log" 2>/dev/null; exit 0'
  return 'tail -n 20 "${XDG_CONFIG_HOME:-$HOME/.config}/kiko-computer/daemon.log" 2>/dev/null; exit 0'
}

export interface WaitTarget {
  readonly name?: string
  readonly known: ReadonlySet<string>
}

export function computerMatches(pc: ComputerSummary, target: WaitTarget): boolean {
  if (!pc.online) return false
  if (target.name) return pc.name.toLowerCase() === target.name.toLowerCase()
  return !target.known.has(pc.id)
}

export function waitForComputer(computers: Computers, target: WaitTarget): Effect.Effect<ComputerSummary, CliError> {
  return computers.pipe(
    Stream.map((list) => list.find((pc) => computerMatches(pc, target))),
    Stream.filter((pc): pc is ComputerSummary => pc !== undefined),
    Stream.runHead,
    Effect.flatMap((head) =>
      head._tag === "Some" ? Effect.succeed(head.value) : Effect.fail(new CliError({ message: "no hello" })),
    ),
    Effect.timeoutOrElse({
      duration: WAIT_BUDGET,
      orElse: () => Effect.fail(new CliError({ message: "no hello" })),
    }),
  )
}

export function pcStream(client: {
  "user.subscribe"(payload: { afterSequence?: number }): Stream.Stream<UserStreamItem, unknown>
}): Computers {
  return client["user.subscribe"]({}).pipe(
    Stream.map((item) => (item.kind === "signal" && item.signal.t === "pcState" ? item.signal.computers : undefined)),
    Stream.filter((list): list is readonly ComputerSummary[] => list !== undefined),
    Stream.mapError(() => new CliError({ message: "lost the connection to the Worker" })),
  )
}

export async function sshOutput(ctx: Context, target: string, remote: string): Promise<string | null> {
  const args = ["ssh"]
  if (ctx.port) args.push("-p", ctx.port)
  if (ctx.identity) args.push("-i", ctx.identity)
  args.push(target, remote)
  try {
    const proc = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "ignore" })
    const [text, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return exitCode === 0 ? text.trim() || null : null
  } catch {
    return null
  }
}
