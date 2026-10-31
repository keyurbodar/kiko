import { For, Index, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type JSX } from "solid-js"
import { FileIcon as FileTypeIcon } from "@kiko/ui/file-icon"
import { DownloadIcon, WrapTextIcon } from "@kiko/ui/icons"
import { RemixIcon } from "@kiko/ui/remix-icon"
import { CopyCheckIcon } from "@kiko/ui/v2/copy-check-icon"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import type { CodeFile } from "../model"
import { PlainFallback } from "../plain-fallback"
import { codeEdges, fadeInsets, type CodeEdges } from "./edges"
import { highlight, keepLinesWithSameText, keepTokens, plainLines, type CodeLine } from "./highlight"
import "./code-block.css"

const WRAP_KEY = "kiko:code-wrap"

const COPIED_MS = 1200

function readWrap(): boolean {
  try {
    return globalThis.localStorage?.getItem(WRAP_KEY) === "on"
  } catch {
    return false
  }
}

const [wrapLines, setWrapLines] = createSignal(readWrap())

function toggleWrap(): void {
  const next = !wrapLines()
  setWrapLines(next)
  try {
    globalThis.localStorage?.setItem(WRAP_KEY, next ? "on" : "off")
  } catch {
    return
  }
}

function download(file: CodeFile): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: "text/plain" }))
  const link = document.createElement("a")
  link.href = url
  link.download = file.name ?? `code.${file.lang ?? "txt"}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function useHighlight(text: () => string, lang: () => string | undefined, root: () => HTMLElement | undefined) {
  const [lines, setLines] = createSignal<readonly CodeLine[]>(plainLines(text()))
  const [seen, setSeen] = createSignal(typeof IntersectionObserver === "undefined")
  let frame = 0
  let request = 0

  const run = () => {
    frame = 0
    const id = ++request
    highlight(text(), lang()).then(
      (result) => {
        if (id !== request || !result) return
        setLines((previous) => keepTokens(previous, result))
      },
      () => {},
    )
  }
  const schedule = () => {
    if (frame || !seen()) return
    frame = requestAnimationFrame(run)
  }

  createEffect(
    on([text, lang, seen], ([current]) => {
      setLines((previous) => keepLinesWithSameText(previous, plainLines(current)))
      schedule()
    }),
  )
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
  onCleanup(() => cancelAnimationFrame(frame))
  return lines
}

function Action(props: { label: string; pressed?: boolean; onClick: () => void; children: JSX.Element }): JSX.Element {
  return (
    <TooltipV2 placement="top" value={props.label}>
      <button
        type="button"
        class="chat-code-action"
        aria-label={props.label}
        aria-pressed={props.pressed}
        data-active={props.pressed ? "" : undefined}
        onClick={() => props.onClick()}
      >
        {props.children}
      </button>
    </TooltipV2>
  )
}

function Title(props: { file: CodeFile }): JSX.Element {
  const name = () => props.file.name
  return (
    <span class="chat-code-title">
      <Show when={name()} fallback={<span class="chat-code-name">{props.file.lang ?? "text"}</span>}>
        {(title) => (
          <>
            <FileTypeIcon class="chat-code-icon" node={{ path: title(), type: "file" }} />
            <span class="chat-code-name">{title()}</span>
          </>
        )}
      </Show>
    </span>
  )
}

function Tabs(props: { files: readonly CodeFile[]; active: number; onSelect: (index: number) => void }): JSX.Element {
  return (
    <div class="chat-code-tabs" role="tablist">
      <For each={props.files}>
        {(file, i) => (
          <button
            type="button"
            role="tab"
            class="chat-code-tab"
            aria-selected={props.active === i()}
            data-active={props.active === i() ? "" : undefined}
            onClick={() => props.onSelect(i())}
          >
            {file.name ?? file.lang ?? "text"}
          </button>
        )}
      </For>
    </div>
  )
}

function Lines(props: { lines: readonly CodeLine[] }): JSX.Element {
  return (
    <code class="chat-code-lines">
      <Index each={props.lines}>
        {(line, index) => (
          <span class="chat-code-line">
            <span class="chat-code-ln" aria-hidden="true">
              {index + 1}
            </span>
            <span class="chat-code-text">
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

function CodeFiles(props: { files: readonly CodeFile[]; streaming?: boolean }): JSX.Element {
  let root: HTMLDivElement | undefined
  let pre: HTMLPreElement | undefined
  let code: HTMLElement | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const [active, setActive] = createSignal(0)
  const file = () => props.files[Math.min(active(), props.files.length - 1)]!
  const text = createMemo(() => file().text)
  const lang = createMemo(() => file().lang)
  const lines = useHighlight(text, lang, () => root)
  const digits = createMemo(() => String(lines().length).length)
  const [copied, setCopied] = createSignal(false)
  const [edges, setEdges] = createSignal<CodeEdges>({ top: false, bottom: false, left: false, right: false })
  const [insets, setInsets] = createSignal({ bottom: 0, right: 0 })
  const [following, setFollowing] = createSignal(true)
  onCleanup(() => clearTimeout(timer))

  const measure = () => {
    if (!pre) return
    setEdges(codeEdges(pre))
    setInsets(fadeInsets(pre))
  }

  const onScroll = () => {
    if (!pre) return
    setFollowing(pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 1)
    measure()
  }

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

  createEffect(on([wrapLines, lines], () => measure(), { defer: true }))
  createEffect(
    on(
      lines,
      () => {
        if (!props.streaming || !following() || !pre) return
        pre.scrollTop = pre.scrollHeight
      },
      { defer: true },
    ),
  )
  onMount(() => {
    measure()
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => measure())
    if (pre) observer?.observe(pre)
    if (code) observer?.observe(code)
    onCleanup(() => observer?.disconnect())
  })

  return (
    <div
      ref={root}
      class="chat-code"
      dir="ltr"
      data-component="chat-code-block"
      data-wrap={wrapLines() ? "" : undefined}
      data-streaming={props.streaming ? "" : undefined}
    >
      <div class="chat-code-head">
        <Show when={props.files.length > 1} fallback={<Title file={file()} />}>
          <Tabs files={props.files} active={active()} onSelect={setActive} />
        </Show>
        <div class="chat-code-actions" role="toolbar" aria-label="Code block actions">
          <Action label={wrapLines() ? "Disable line wrap" : "Wrap lines"} pressed={wrapLines()} onClick={toggleWrap}>
            <RemixIcon icon={WrapTextIcon} size={16} />
          </Action>
          <Action label="Download" onClick={() => download(file())}>
            <RemixIcon icon={DownloadIcon} size={16} />
          </Action>
          <Action label={copied() ? "Copied" : "Copy code"} onClick={copy}>
            <CopyCheckIcon copied={copied()} size={16} />
          </Action>
        </div>
      </div>
      <div
        class="chat-code-body"
        style={{ "--fade-bottom": `${insets().bottom}px`, "--fade-right": `${insets().right}px` }}
      >
        <pre ref={pre} class="chat-code-pre" style={{ "--digits": String(digits()) }} onScroll={onScroll}>
          <Lines lines={lines()} />
        </pre>
        <span class="chat-code-fade" data-edge="top" data-on={edges().top ? "" : undefined} aria-hidden="true" />
        <span class="chat-code-fade" data-edge="bottom" data-on={edges().bottom ? "" : undefined} aria-hidden="true" />
        <span class="chat-code-fade" data-edge="left" data-on={edges().left ? "" : undefined} aria-hidden="true" />
        <span class="chat-code-fade" data-edge="right" data-on={edges().right ? "" : undefined} aria-hidden="true" />
      </div>
    </div>
  )
}

export function CodeBlock(props: { files: readonly CodeFile[]; streaming?: boolean }): JSX.Element {
  return (
    <PlainFallback text={props.files.map((file) => file.text).join("\n\n")}>
      <CodeFiles files={props.files} streaming={props.streaming} />
    </PlainFallback>
  )
}
