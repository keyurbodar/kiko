import { For, Index, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"
import { RemixIcon, type Glyph } from "@kiko/ui/remix-icon"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, DownloadIcon, WrapTextIcon } from "@kiko/ui/icons"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { PlainFallback } from "./plain-fallback"
import type { CodeFile } from "./model"

type Token = { type: string; text: string }

const MAX_HIGHLIGHT_CHARS = 20_000

const FOLD_LINES = 8

const SCROLL_LINES = 20

const LINE_PX = 21

const PAD_PX = 16

const COPIED_MS = 1500

async function highlight(text: string, lang: string | undefined): Promise<Token[][] | null> {
  if (!lang || text.length > MAX_HIGHLIGHT_CHARS) return null
  const [core, langs] = await Promise.all([import("sugar-high/core"), import("sugar-high/lang")])
  const name = langs.lang(lang)
  if (!name) return null
  const config = langs.languages.find((l) => l.id === name)?.config
  return core
    .generate(core.parse(text, config))
    .map((line) => line.children.map((token) => ({ type: token.tokenType, text: token.children[0]?.value ?? "" })))
}

const plainLines = (text: string): Token[][] => text.split("\n").map((line) => [{ type: "plain", text: line }])

function codeHeight(lines: number, open: boolean): number {
  const shown = open ? Math.min(lines, SCROLL_LINES) : Math.min(lines, FOLD_LINES)
  return shown * LINE_PX + PAD_PX
}

function download(file: CodeFile) {
  const url = URL.createObjectURL(new Blob([file.text], { type: "text/plain" }))
  const link = document.createElement("a")
  link.href = url
  link.download = file.name ?? `code.${file.lang ?? "txt"}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function Action(props: { label: string; icon: Glyph; pressed?: boolean; onClick: () => void }) {
  return (
    <TooltipV2 placement="top" value={props.label}>
      <button
        type="button"
        class="rich-code-action"
        aria-label={props.label}
        aria-pressed={props.pressed}
        data-active={props.pressed ? "" : undefined}
        onClick={() => props.onClick()}
      >
        <RemixIcon icon={props.icon} size={15} />
      </button>
    </TooltipV2>
  )
}

function Lines(props: { lines: Token[][] }) {
  return (
    <code class="rich-code-lines">
      <Index each={props.lines}>
        {(line, i) => (
          <span class="rich-code-line">
            <span class="rich-code-ln" aria-hidden="true">
              {i + 1}
            </span>
            <span class="rich-code-text">
              <For each={line()}>
                {(token) =>
                  token.type === "plain" ? (
                    token.text
                  ) : (
                    <span style={{ color: `var(--sh-${token.type})` }}>{token.text}</span>
                  )
                }
              </For>
              {"\n"}
            </span>
          </span>
        )}
      </Index>
    </code>
  )
}

function useHighlight(file: () => CodeFile, root: () => HTMLElement | undefined) {
  const [tokens, setTokens] = createSignal<Token[][] | null>(null)
  const [seen, setSeen] = createSignal(typeof IntersectionObserver === "undefined")
  onMount(() => {
    const element = root()
    if (seen() || !element) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      setSeen(true)
    })
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  })
  createEffect(
    on([file, seen], ([current, visible]) => {
      setTokens(null)
      if (!visible) return
      let dead = false
      highlight(current.text, current.lang).then(
        (result) => !dead && setTokens(result),
        () => {},
      )
      onCleanup(() => {
        dead = true
      })
    }),
  )
  return () => tokens() ?? plainLines(file().text)
}

function CodeFiles(props: { files: readonly CodeFile[] }): JSX.Element {
  let root: HTMLDivElement | undefined
  let pre: HTMLPreElement | undefined
  const [active, setActive] = createSignal(0)
  const file = () => props.files[Math.min(active(), props.files.length - 1)]!
  const lines = useHighlight(file, () => root)
  const count = createMemo(() => file().text.split("\n").length)
  const [open, setOpen] = createSignal(false)
  const [wrap, setWrap] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const [more, setMore] = createSignal(false)
  const folds = () => count() > FOLD_LINES
  const scrolls = () => open() && count() > SCROLL_LINES
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const measure = () => {
    if (pre) setMore(!wrap() && pre.scrollLeft + pre.clientWidth < pre.scrollWidth - 1)
  }
  onMount(measure)
  createEffect(on([wrap, lines], () => requestAnimationFrame(measure), { defer: true }))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file().text)
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer)
    timer = setTimeout(() => setCopied(false), COPIED_MS)
  }

  const label = (entry: CodeFile) => entry.name ?? entry.lang ?? "text"

  return (
    <div
      class="rich-code"
      ref={root}
      data-component="chat-code-block"
      data-copied={copied() ? "" : undefined}
      data-folded={folds() && !open() ? "" : undefined}
    >
      <div class="rich-code-bar">
        <div class="rich-code-tabs" role={props.files.length > 1 ? "tablist" : undefined}>
          <For each={props.files}>
            {(entry, i) => (
              <Show
                when={props.files.length > 1}
                fallback={
                  <span class="rich-code-tab" data-active="">
                    {label(entry)}
                  </span>
                }
              >
                <button
                  type="button"
                  role="tab"
                  class="rich-code-tab"
                  aria-selected={active() === i()}
                  data-active={active() === i() ? "" : undefined}
                  onClick={() => setActive(i())}
                >
                  {label(entry)}
                </button>
              </Show>
            )}
          </For>
        </div>
        <div class="rich-code-actions">
          <Action
            label={wrap() ? "Disable line wrap" : "Wrap lines"}
            icon={WrapTextIcon}
            pressed={wrap()}
            onClick={() => setWrap(!wrap())}
          />
          <Action label="Download" icon={DownloadIcon} onClick={() => download(file())} />
          <Action label={copied() ? "Copied" : "Copy code"} icon={copied() ? CheckIcon : CopyIcon} onClick={copy} />
        </div>
      </div>
      <pre
        ref={pre}
        class="rich-code-pre"
        data-wrap={wrap() ? "" : undefined}
        data-more={more() ? "" : undefined}
        data-scrolls={scrolls() ? "" : undefined}
        style={folds() ? { "max-height": `${codeHeight(count(), open())}px` } : undefined}
        onScroll={measure}
      >
        <Lines lines={lines()} />
      </pre>
      <Show when={folds()}>
        <button
          type="button"
          class="rich-code-fold"
          aria-expanded={open()}
          data-disclosure=""
          onClick={() => setOpen(!open())}
        >
          <RemixIcon icon={open() ? ChevronUpIcon : ChevronDownIcon} size={13} />
          <span>{open() ? "Show less" : `Show ${count() - FOLD_LINES} more lines`}</span>
          <span class="rich-code-count">{count()} lines</span>
        </button>
      </Show>
    </div>
  )
}

export function CodeBlock(props: { files: readonly CodeFile[] }): JSX.Element {
  return (
    <PlainFallback text={props.files.map((file) => file.text).join("\n\n")}>
      <CodeFiles files={props.files} />
    </PlainFallback>
  )
}
