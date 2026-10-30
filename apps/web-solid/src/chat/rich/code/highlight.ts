export type CodeToken = { readonly type: string; readonly text: string }

export type CodeLine = readonly CodeToken[]

const MAX_HIGHLIGHT_CHARS = 20_000

export async function highlight(text: string, lang: string | undefined): Promise<CodeLine[] | null> {
  if (!lang || text.length > MAX_HIGHLIGHT_CHARS) return null
  const [core, langs] = await Promise.all([import("sugar-high/core"), import("sugar-high/lang")])
  const name = langs.lang(lang)
  if (!name) return null
  const config = langs.languages.find((entry) => entry.id === name)?.config
  return core
    .generate(core.parse(text, config))
    .map((line) => line.children.map((token) => ({ type: token.tokenType, text: token.children[0]?.value ?? "" })))
}

export function plainLines(text: string): CodeLine[] {
  return text.split("\n").map((line) => [{ type: "plain", text: line }])
}

const lineText = (line: CodeLine): string => line.map((token) => token.text).join("")

const sameTokens = (a: CodeLine, b: CodeLine): boolean =>
  a.length === b.length && a.every((token, i) => token.type === b[i]!.type && token.text === b[i]!.text)

export function keepTokens(previous: readonly CodeLine[], next: readonly CodeLine[]): readonly CodeLine[] {
  return next.map((line, i) => {
    const before = previous[i]
    return before && sameTokens(before, line) ? before : line
  })
}

export function keepLinesWithSameText(previous: readonly CodeLine[], next: readonly CodeLine[]): readonly CodeLine[] {
  return next.map((line, i) => {
    const before = previous[i]
    return before && lineText(before) === lineText(line) ? before : line
  })
}
