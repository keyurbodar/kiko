import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js"

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
    <div class="rich-code" ref={root}>
      <div class="rich-code-bar">
        <span class="rich-code-lang">{props.lang ?? ""}</span>
        <button type="button" class="rich-code-copy" onClick={copy}>
          {copied() ? "copied" : "copy"}
        </button>
      </div>
      <pre class="rich-code-pre">
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
