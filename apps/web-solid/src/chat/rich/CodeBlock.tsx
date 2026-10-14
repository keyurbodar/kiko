import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { CheckIcon, CopyIcon, WrapTextIcon } from "lucide-solid"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"

/* One highlighted line: tokens as [token type, text]. Built from sugar-high's
 * syntax tree, so the result is rendered as elements and never as markup. */
type Line = { type: string; text: string }[]

const MAX_HIGHLIGHT_CHARS = 20_000

/* sugar-high loads on first use, in its own chunk, after a block is visible. */
async function highlight(text: string, lang: string | undefined): Promise<Line[] | null> {
  if (!lang || text.length > MAX_HIGHLIGHT_CHARS) return null
  const [core, langs] = await Promise.all([import("sugar-high/core"), import("sugar-high/lang")])
  const name = langs.lang(lang)
  if (!name) return null
  const config = langs.languages.find((l) => l.id === name)?.config
  return core.generate(core.parse(text, config)).map((line) =>
    line.children.map((token) => ({ type: token.tokenType, text: token.children[0]?.value ?? "" })),
  )
}

export function CodeBlock(props: { lang?: string; text: string }): JSX.Element {
  let root!: HTMLDivElement
  const [lines, setLines] = createSignal<Line[] | null>(null)
  const [copied, setCopied] = createSignal(false)
  // t3code's wordWrap setting defaults on, so a block wraps its long lines until the reader turns it off.
  const [wrap, setWrap] = createSignal(true)
  let timer: ReturnType<typeof setTimeout> | undefined
  let dead = false

  const run = () => {
    highlight(props.text, props.lang).then(
      (result) => !dead && setLines(result),
      () => {},
    )
  }

  onMount(() => {
    if (typeof IntersectionObserver === "undefined") return run()
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      run()
    })
    observer.observe(root)
    onCleanup(() => observer.disconnect())
  })
  onCleanup(() => {
    dead = true
    clearTimeout(timer)
  })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text)
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer)
    timer = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div class="rich-code" ref={root} data-component="chat-code-block">
      <div class="rich-code-bar">
        <span class="rich-code-lang">{props.lang || "text"}</span>
        <div class="rich-code-actions">
          <TooltipV2 placement="top" value={wrap() ? "Disable line wrap" : "Wrap lines"}>
            <button
              type="button"
              class="rich-code-action"
              aria-label={wrap() ? "Disable line wrap" : "Wrap lines"}
              aria-pressed={wrap()}
              data-active={wrap() ? "" : undefined}
              onClick={() => setWrap(!wrap())}
            >
              <WrapTextIcon class="size-3" aria-hidden="true" />
            </button>
          </TooltipV2>
          <TooltipV2 placement="top" value={copied() ? "Copied" : "Copy code"}>
            <button type="button" class="rich-code-action" aria-label={copied() ? "Copied" : "Copy code"} onClick={copy}>
              {copied() ? <CheckIcon class="size-3" aria-hidden="true" /> : <CopyIcon class="size-3" aria-hidden="true" />}
            </button>
          </TooltipV2>
        </div>
      </div>
      <pre class="rich-code-pre" data-wrap={wrap() ? "" : undefined}>
        <code>
          <Show when={lines()} fallback={props.text}>
            {(all) => (
              <For each={all()}>
                {(line, i) => (
                  <>
                    <For each={line}>
                      {(token) => <span style={{ color: `var(--sh-${token.type})` }}>{token.text}</span>}
                    </For>
                    {i() < all().length - 1 ? "\n" : ""}
                  </>
                )}
              </For>
            )}
          </Show>
        </code>
      </pre>
    </div>
  )
}
