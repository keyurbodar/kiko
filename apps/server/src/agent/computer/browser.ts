import { Type, type Static } from "@earendil-works/pi-ai"
import { defineTool, type ToolExecutionApi } from "@earendil-works/pi-durable"
import { PAGE_ACTIONS, type DriverCall, type Mode, type Page, type Tab } from "@kiko/computer/driver"
import {
  baseReady,
  cut,
  driverCall,
  failText,
  imageResult,
  MAX_STEPS,
  notRunning,
  PC,
  run,
  SCREEN_MAX_WIDTH,
  seeFailure,
  stepFailure,
  text,
  type ComputerResult,
  type ComputerToolDeps,
  type Ready,
} from "./shared"
import type { ComputerSummary } from "./types"

const BrowserStep = Type.Object({
  action: Type.Union(PAGE_ACTIONS.map((action) => Type.Literal(action))),
  ref: Type.Number({ description: "the [ref] id from browser_read" }),
  text: Type.Optional(Type.String({ description: "for type, set_value and select: the text to put there" })),
})

type BrowserStepArgs = Static<typeof BrowserStep>

const INSPECT: Readonly<Record<string, string>> = {
  chrome: "chrome://inspect/#remote-debugging",
  edge: "edge://inspect",
  brave: "brave://inspect",
}

const TABS_DESCRIPTION =
  "list every tab in every browser kiko can drive, including tabs in the background, with an id for browser_read and browser_act, and say what each browser is doing. use the tab the owner already has open for a site instead of opening another."

const READ_DESCRIPTION =
  "read one browser tab's controls with [ref] ids and a picture, including a tab in the background that the owner is not looking at. tab is an id from browser_tabs or browser_open; pass the refs it returns to browser_act."

const ACT_DESCRIPTION =
  "click and type in one browser tab by ref, with up to 10 steps in one call, without bringing the tab forward. ref comes from browser_read. actions: click, type, set_value, select, press_key, scroll, focus. stops at the first step that fails, then reads the tab again to check before you say what happened. set on_screen true only when the owner asked you to work on their screen: it then brings the tab forward and uses their real mouse and keyboard."

function label(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function consentLine(name: string): string {
  const browser = label(name)
  const url = INSPECT[name] ?? INSPECT.chrome
  const others = name === "chrome" ? " (Edge edge://inspect, Brave brave://inspect)" : ""
  return `${browser}: open ${url} in ${browser} and turn on "Allow remote debugging for this browser instance"${others}`
}

function browserLine(browser: ComputerSummary["browsers"][number]): string {
  if (browser.state === "needs_consent") return consentLine(browser.name)
  if (browser.state === "not_running") return `${label(browser.name)}: not open`
  if (browser.state === "unsupported") return `${label(browser.name)}: kiko cannot drive this browser`
  return `${label(browser.name)}: connected`
}

function tabLine(tab: Tab): string {
  return `${tab.id}${tab.active ? " [in front]" : ""} ${tab.title || "(no title)"} — ${tab.url}`
}

function tabHead(tab: Tab, suffix: string): string {
  return `${tab.title || "(no title)"} — ${tab.url} (tab ${tab.id}, ${suffix})`
}

function browserBlocked(pc: ComputerSummary): ComputerResult | null {
  if (pc.caps.browser) return null
  const consent = pc.browsers.filter((browser) => browser.state === "needs_consent")
  if (consent.length > 0) return text(consent.map((browser) => consentLine(browser.name)).join("\n"), true)
  const closed = pc.browsers.filter((browser) => browser.state === "not_running")
  if (closed.length > 0)
    return text(
      `${pc.name} has no browser open that kiko can use: ${closed.map((browser) => browser.name).join(", ")}. open one, then try again.`,
      true,
    )
  return text(notRunning(pc), true)
}

function tabsText(pc: ComputerSummary, list: readonly Tab[]): string {
  const groups = new Map<string, Tab[]>()
  for (const tab of list) groups.set(tab.browser, [...(groups.get(tab.browser) ?? []), tab])
  const lines: string[] = []
  for (const [browser, tabs] of groups) {
    lines.push(`${label(browser)}:`)
    for (const tab of tabs) lines.push(`  ${tabLine(tab)}`)
  }
  for (const browser of pc.browsers) {
    if (!groups.has(browser.name)) lines.push(browserLine(browser))
  }
  if (lines.length === 0) return `no browser tabs are open on ${pc.name}.`
  return lines.join("\n")
}

function pageCall(tab: string, step: BrowserStepArgs, mode: Mode): DriverCall | string {
  if (!Number.isInteger(step.ref) || step.ref < 0) return "ref must be a whole number from browser_read"
  return {
    method: "browser.act",
    params: {
      tab,
      ref: step.ref,
      action: step.action,
      mode,
      ...(step.text !== undefined ? { text: step.text } : {}),
    },
  }
}

function pageResult(
  api: Pick<ToolExecutionApi, "env">,
  page: Page,
  sees: boolean,
  head: string,
): Promise<ComputerResult> {
  const body = cut([head, page.outline.trim() || "(no controls on this page)"].join("\n\n"))
  return imageResult(api, page.image, sees, body)
}

export function browserTools(deps: ComputerToolDeps) {
  const base = baseReady(deps)
  const ready = async (which?: string): Promise<Ready> => {
    const target = await base(which)
    if (!target.ok) return target
    const blocked = browserBlocked(target.pc)
    if (blocked) return { ok: false, result: blocked }
    return target
  }

  const tabs = defineTool({
    name: "browser_tabs",
    description: TABS_DESCRIPTION,
    parameters: Type.Object({ pc: PC }),
    replay: "safe",
    execute: (args) =>
      run("browser_tabs", async () => {
        const target = await ready(args.pc)
        if (!target.ok) return target.result
        const pc = target.pc
        const out = await driverCall(deps, pc, { method: "browser.tabs" })
        if (!out.ok) return text(failText(out.code, out.message, pc), true)
        return text(tabsText(pc, out.value as Tab[]))
      }),
  })

  const read = defineTool({
    name: "browser_read",
    description: READ_DESCRIPTION,
    parameters: Type.Object({
      pc: PC,
      tab: Type.String({ description: "the tab id from browser_tabs or browser_open" }),
      image: Type.Optional(
        Type.Boolean({ description: "take a picture of the tab too, default true when you can see images" }),
      ),
    }),
    replay: "safe",
    execute: (args, api, ctx) =>
      run("browser_read", async () => {
        const target = await ready(args.pc)
        if (!target.ok) return target.result
        const pc = target.pc
        const sees = deps.acceptsImages((await api.agent(ctx)).model)
        const out = await driverCall(deps, pc, {
          method: "browser.read",
          params: { tab: args.tab, image: args.image ?? sees, max_width: SCREEN_MAX_WIDTH },
        })
        if (!out.ok) return text(seeFailure(out, pc), true)
        const page = out.value as Page
        return pageResult(api, page, sees, tabHead(page.tab, "read in the background"))
      }),
  })

  const act = defineTool({
    name: "browser_act",
    description: ACT_DESCRIPTION,
    parameters: Type.Object({
      pc: PC,
      tab: Type.String({ description: "the tab id from browser_tabs or browser_read" }),
      steps: Type.Array(BrowserStep, { minItems: 1, maxItems: MAX_STEPS }),
      on_screen: Type.Optional(
        Type.Boolean({ description: "use the owner's real screen instead of working in the background" }),
      ),
      image: Type.Optional(
        Type.Boolean({ description: "return a picture of the fresh view, default true when you can see images" }),
      ),
    }),
    replay: "unsafe",
    execute: (args, api, ctx) =>
      run("browser_act", async () => {
        const target = await ready(args.pc)
        if (!target.ok) return target.result
        const pc = target.pc
        const sees = deps.acceptsImages((await api.agent(ctx)).model)
        const steps = args.steps.slice(0, MAX_STEPS)
        const mode: Mode = args.on_screen ? "foreground" : "background"
        const calls = steps.map((step) => pageCall(args.tab, step, mode))
        const bad = calls.findIndex((call) => typeof call === "string")
        if (bad >= 0) return text(`step ${bad + 1}: ${calls[bad]}. nothing was done.`, true)
        let done = 0
        let error: string | undefined
        for (const call of calls as DriverCall[]) {
          const out = await driverCall(deps, pc, call)
          if (out.ok) {
            done += 1
            continue
          }
          error = stepFailure(out.code, out.message, pc)
          break
        }
        return afterSteps(deps, api, pc, { tab: args.tab, done, total: steps.length, error }, sees, args.image)
      }),
  })

  const open = defineTool({
    name: "browser_open",
    description:
      "open a URL in a new tab in the background, in the browser the owner already uses, without bringing it to the front. use the tab the owner already has open for that site instead when there is one.",
    parameters: Type.Object({
      pc: PC,
      url: Type.String({ description: "the full URL to open, such as https://example.com" }),
    }),
    replay: "unsafe",
    execute: (args) =>
      run("browser_open", async () => {
        const target = await ready(args.pc)
        if (!target.ok) return target.result
        const pc = target.pc
        const out = await driverCall(deps, pc, {
          method: "browser.open",
          params: { url: args.url, mode: "background" },
        })
        if (!out.ok) return text(failText(out.code, out.message, pc), true)
        return text(`opened ${tabLine(out.value as Tab)} on ${pc.name} in the background.`)
      }),
  })

  const close = defineTool({
    name: "browser_close",
    description: "close one browser tab by id, in the background.",
    parameters: Type.Object({
      pc: PC,
      tab: Type.String({ description: "the tab id from browser_tabs" }),
    }),
    replay: "unsafe",
    execute: (args) =>
      run("browser_close", async () => {
        const target = await ready(args.pc)
        if (!target.ok) return target.result
        const pc = target.pc
        const out = await driverCall(deps, pc, { method: "browser.close", params: { tab: args.tab } })
        if (!out.ok) return text(failText(out.code, out.message, pc), true)
        return text(`closed tab ${args.tab} on ${pc.name}.`)
      }),
  })

  const show = defineTool({
    name: "browser_show",
    description:
      "bring one browser tab to the front so the owner can see it. this takes over their screen: use it only when the owner asks you to show them something.",
    parameters: Type.Object({
      pc: PC,
      tab: Type.String({ description: "the tab id from browser_tabs" }),
    }),
    replay: "unsafe",
    execute: (args) =>
      run("browser_show", async () => {
        const target = await ready(args.pc)
        if (!target.ok) return target.result
        const pc = target.pc
        const out = await driverCall(deps, pc, { method: "browser.show", params: { tab: args.tab } })
        if (!out.ok) return text(failText(out.code, out.message, pc), true)
        return text(`brought tab ${args.tab} to the front on ${pc.name}.`)
      }),
  })

  return [tabs, read, act, open, close, show]
}

async function afterSteps(
  deps: ComputerToolDeps,
  api: Pick<ToolExecutionApi, "env">,
  pc: ComputerSummary,
  plan: { tab: string; done: number; total: number; error?: string },
  sees: boolean,
  image: boolean | undefined,
): Promise<ComputerResult> {
  const out = await driverCall(deps, pc, {
    method: "browser.read",
    params: { tab: plan.tab, image: image ?? sees, max_width: SCREEN_MAX_WIDTH },
  })
  const progress = `did ${plan.done} of ${plan.total} steps`
  if (!out.ok) return text(`${progress}. the page could not be read: ${seeFailure(out, pc)}`, true)
  const page = out.value as Page
  const failure = plan.error ? `. step ${plan.done + 1} failed: ${plan.error}` : ""
  return pageResult(api, page, sees, `${progress} on ${tabHead(page.tab, "read in the background")}${failure}`)
}
