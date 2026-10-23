import type { IndexHtmlTransformContext, Plugin } from "vite"

const FIRST_PAINT = ["src/main.tsx", "src/app/routes/chat.tsx"]

type Bundle = NonNullable<IndexHtmlTransformContext["bundle"]>

function firstPaintFiles(bundle: Bundle): { scripts: Set<string>; styles: Set<string>; entry: string | undefined } {
  const chunks = Object.values(bundle).filter((item) => item.type === "chunk")
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
  const scripts = new Set<string>()
  const styles = new Set<string>()
  const visit = (file: string) => {
    const chunk = byFile.get(file)
    if (!chunk || scripts.has(file)) return
    scripts.add(file)
    for (const css of chunk.viteMetadata?.importedCss ?? []) styles.add(css)
    for (const dep of chunk.imports) visit(dep)
  }
  for (const key of FIRST_PAINT) {
    const chunk = chunks.find((item) => item.facadeModuleId?.endsWith(key))
    if (chunk) visit(chunk.fileName)
  }
  const entry = chunks.find((item) => item.isEntry)?.fileName
  if (entry) scripts.delete(entry)
  return { scripts, styles, entry }
}

export function firstPaintPreload(): Plugin {
  let loadedAtStart = new Set<string>()
  return {
    name: "kiko-first-paint-preload",
    enforce: "post",
    config() {
      return {
        build: {
          modulePreload: {
            resolveDependencies: (_filename, deps) => deps.filter((dep) => !loadedAtStart.has(dep)),
          },
        },
      }
    },
    generateBundle: {
      order: "pre",
      handler(_options, bundle) {
        const { scripts, entry } = firstPaintFiles(bundle)
        loadedAtStart = new Set(entry ? [...scripts, entry] : scripts)
      },
    },
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!ctx.bundle) return html
        const { scripts, styles } = firstPaintFiles(ctx.bundle)
        const tags = [
          ...[...scripts].map((file) => `<link rel="modulepreload" href="/${file}">`),
          ...[...styles].map((file) => `<link rel="preload" as="style" crossorigin href="/${file}">`),
        ]
        return tags.length ? html.replace("</head>", `${tags.join("")}</head>`) : html
      },
    },
  }
}
