import { getFilename } from "./path"

const LANGUAGE_NAMES: Record<string, string> = {
  bash: "Shell",
  c: "C",
  cc: "C++",
  cjs: "JavaScript",
  conf: "Config",
  cpp: "C++",
  cs: "C#",
  css: "CSS",
  csv: "CSV",
  diff: "Diff",
  dockerfile: "Docker",
  env: "Env",
  go: "Go",
  gql: "GraphQL",
  graphql: "GraphQL",
  h: "C",
  hpp: "C++",
  html: "HTML",
  ini: "INI",
  java: "Java",
  js: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  kt: "Kotlin",
  log: "Log",
  lua: "Lua",
  md: "Markdown",
  mdx: "MDX",
  mjs: "JavaScript",
  php: "PHP",
  py: "Python",
  rb: "Ruby",
  rs: "Rust",
  sass: "Sass",
  scss: "SCSS",
  sh: "Shell",
  sql: "SQL",
  svelte: "Svelte",
  swift: "Swift",
  tf: "Terraform",
  toml: "TOML",
  ts: "TypeScript",
  tsx: "TSX",
  txt: "Text",
  vue: "Vue",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  zsh: "Shell",
}

export function typeLabel(filename: string, mime: string, fallback: string) {
  if (mime === "application/pdf") return "PDF"
  const base = getFilename(filename)
  const idx = base.lastIndexOf(".")
  const suffix = idx <= 0 ? "" : base.slice(idx + 1).toLowerCase()
  if (!suffix) return fallback
  return LANGUAGE_NAMES[suffix] ?? suffix.toUpperCase()
}
