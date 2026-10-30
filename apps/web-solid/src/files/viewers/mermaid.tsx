import { appearanceOf } from "@kiko/theme/apply"
import { TabsPill, TabsV2 as Tabs } from "@kiko/ui/v2/tabs-v2"
import { createEffect, createMemo, createSignal, Match, onCleanup, Show, Switch, type JSX } from "solid-js"
import { look } from "../../theme/live"
import { SurfaceFailure, SurfaceLoading } from "../chrome"

const MAX_BYTES = 2 * 1024 * 1024
const UNSAFE_SOURCE =
  /%%\s*\{|^\s*---|<\/?[A-Za-z]|<[!?]|@\s*\{|\b(?:img|image)\s*:|url\s*\(|@import|(?:https?|data|blob|file):/im

export function safeDiagramSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml")
  if (doc.documentElement.nodeName === "parsererror") throw new Error("This diagram could not be drawn.")
  for (const node of doc.querySelectorAll("script")) node.remove()
  for (const node of doc.querySelectorAll("*")) {
    for (const attribute of node.attributes) {
      if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name)
      if ((attribute.name === "href" || attribute.name === "xlink:href") && !attribute.value.startsWith("#"))
        node.removeAttribute(attribute.name)
    }
  }
  return doc.documentElement.outerHTML
}

let counter = 0

function tokenColor(name: string): string {
  const probe = document.createElement("span")
  probe.style.color = `var(${name})`
  document.body.append(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext("2d")
  if (!context) return computed
  context.fillStyle = computed
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
  return `#${[red, green, blue].map((value) => (value ?? 0).toString(16).padStart(2, "0")).join("")}`
}

async function draw(source: string): Promise<string> {
  const { default: mermaid } = await import("mermaid")
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    theme: "base",
    fontFamily: "Satoshi, system-ui, sans-serif",
    themeVariables: {
      background: tokenColor("--bg"),
      primaryColor: tokenColor("--raise"),
      primaryTextColor: tokenColor("--fg"),
      primaryBorderColor: tokenColor("--line"),
      secondaryColor: tokenColor("--panel"),
      tertiaryColor: tokenColor("--bg-000"),
      lineColor: tokenColor("--fg3"),
      textColor: tokenColor("--fg2"),
    },
  })
  const { svg } = await mermaid.render(`kiko-mermaid-${++counter}`, source)
  return safeDiagramSvg(svg)
}

export default function MermaidViewer(props: { name: string; src: string; size: number }): JSX.Element {
  const [source, setSource] = createSignal<string | null>(null)
  const [svg, setSvg] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [rendered, setRendered] = createSignal(true)
  const dark = createMemo(() => appearanceOf(look().mode) === "dark")

  createEffect(() => {
    const src = props.src
    const size = props.size
    setSource(null)
    setSvg(null)
    setError(null)
    if (size > MAX_BYTES) {
      setError("Mermaid previews support files up to 2 MB.")
      return
    }
    void fetch(src)
      .then(async (response) => {
        if (!response.ok) throw new Error("This diagram could not be loaded.")
        const text = await response.text()
        if (UNSAFE_SOURCE.test(text)) {
          setError("This diagram contains resource URLs, markup, node metadata, or custom configuration.")
          setSource(text)
          return
        }
        setSource(text)
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "This diagram could not be loaded."))
  })

  createEffect(() => {
    const text = source()
    dark()
    if (!text || UNSAFE_SOURCE.test(text)) return
    let cancelled = false
    void draw(text).then(
      (markup) => {
        if (!cancelled) setSvg(markup)
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "This diagram could not be drawn.")
      },
    )
    onCleanup(() => {
      cancelled = true
    })
  })

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-component="file-mermaid">
      <div class="flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-[var(--border-100)] px-3">
        <span class="min-w-0 flex-1 truncate text-hint text-fg3">{props.name}</span>
        <Show when={source()}>
          <Tabs value={rendered() ? "diagram" : "source"} onChange={(next: string) => setRendered(next === "diagram")}>
            <Tabs.List class="relative flex gap-1" aria-label="Show diagram as">
              <TabsPill />
              <Tabs.Trigger
                value="diagram"
                class="relative z-10 rounded-control px-2.5 py-1 text-hint text-fg2 data-[selected]:text-fg"
              >
                Diagram
              </Tabs.Trigger>
              <Tabs.Trigger
                value="source"
                class="relative z-10 rounded-control px-2.5 py-1 text-hint text-fg2 data-[selected]:text-fg"
              >
                Source
              </Tabs.Trigger>
            </Tabs.List>
          </Tabs>
        </Show>
      </div>
      <Switch>
        <Match when={!source() && !error()}>
          <SurfaceLoading />
        </Match>
        <Match when={!source()}>
          <SurfaceFailure message={error() ?? "This diagram could not be loaded."} />
        </Match>
        <Match when={!rendered()}>
          <pre class="min-h-0 flex-1 overflow-auto p-4 font-mono text-hint whitespace-pre-wrap text-fg2">
            {source()}
          </pre>
        </Match>
        <Match when={svg()}>
          {(markup) => (
            <div class="min-h-0 flex-1 overflow-auto p-6" innerHTML={markup()} data-component="mermaid-diagram" />
          )}
        </Match>
        <Match when={error()}>
          <SurfaceFailure message={error() ?? ""} />
        </Match>
        <Match when={!svg()}>
          <SurfaceLoading />
        </Match>
      </Switch>
    </div>
  )
}
