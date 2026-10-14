import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees"
import { FileText } from "lucide-solid"
import { createMemo, Show } from "solid-js"

/*
 * A file's icon, the one t3code draws in its tabs and rows: `@pierre/trees` names the icon from the
 * path, its sprite is put in the page once, and each icon takes the colour of its kind in either
 * appearance. Kiko draws the same icon in the file tree, the tabs, and the card.
 */

const COLORS: Record<string, readonly [light: string, dark: string]> = {
  astro: ["#a631be", "#d568ea"],
  babel: ["#d5a910", "#ffd452"],
  bash: ["#199f43", "#5ecc71"],
  biome: ["#1a85d4", "#69b1ff"],
  bootstrap: ["#693acf", "#9d6afb"],
  browserslist: ["#d5a910", "#ffd452"],
  bun: ["#594c5b", "#79697b"],
  c: ["#1a85d4", "#69b1ff"],
  claude: ["#d47628", "#ffa359"],
  cpp: ["#1a85d4", "#69b1ff"],
  css: ["#693acf", "#9d6afb"],
  database: ["#a631be", "#d568ea"],
  default: ["#84848a", "#adadb1"],
  docker: ["#1a85d4", "#69b1ff"],
  eslint: ["#693acf", "#9d6afb"],
  git: ["#ff8c5b", "#d5512f"],
  go: ["#1ca1c7", "#68cdf2"],
  graphql: ["#d32a61", "#ff678d"],
  html: ["#d47628", "#ffa359"],
  image: ["#d32a61", "#ff678d"],
  javascript: ["#d5a910", "#ffd452"],
  json: ["#d47628", "#ffa359"],
  markdown: ["#199f43", "#5ecc71"],
  mcp: ["#17a5af", "#64d1db"],
  nextjs: ["#84848a", "#adadb1"],
  npm: ["#d52c36", "#ff6762"],
  oxc: ["#1ca1c7", "#68cdf2"],
  postcss: ["#d52c36", "#ff6762"],
  prettier: ["#17a5af", "#64d1db"],
  python: ["#1a85d4", "#69b1ff"],
  react: ["#1ca1c7", "#68cdf2"],
  ruby: ["#d52c36", "#ff6762"],
  rust: ["#d47628", "#ffa359"],
  sass: ["#d32a61", "#ff678d"],
  stylelint: ["#84848a", "#adadb1"],
  svelte: ["#d52c36", "#ff6762"],
  svg: ["#d47628", "#ffa359"],
  svgo: ["#199f43", "#5ecc71"],
  swift: ["#d47628", "#ffa359"],
  table: ["#17a5af", "#64d1db"],
  tailwind: ["#1ca1c7", "#68cdf2"],
  terraform: ["#693acf", "#9d6afb"],
  text: ["#84848a", "#adadb1"],
  typescript: ["#1a85d4", "#69b1ff"],
  vite: ["#a631be", "#d568ea"],
  vscode: ["#1a85d4", "#69b1ff"],
  vue: ["#199f43", "#5ecc71"],
  wasm: ["#693acf", "#9d6afb"],
  webpack: ["#1a85d4", "#69b1ff"],
  yml: ["#d52c36", "#ff6762"],
  zig: ["#d47628", "#ffa359"],
  zip: ["#d47628", "#ffa359"],
};

const resolver = createFileTreeIconResolver({ set: "complete", colored: true })
const SPRITE_ID = "kiko-file-icon-sprite"

function ensureSprite() {
	if (typeof document === "undefined" || document.getElementById(SPRITE_ID)) return
	const holder = document.createElement("div")
	holder.id = SPRITE_ID
	holder.setAttribute("aria-hidden", "true")
	holder.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none"
	holder.innerHTML = getBuiltInSpriteSheet("complete")
	document.body.prepend(holder)
}

export function EntryIcon(props: { path: string; size?: number; class?: string }) {
	const icon = createMemo(() => {
		ensureSprite()
		return resolver.resolveIcon("file-tree-icon-file", props.path)
	})
	const color = () => {
		const pair = COLORS[icon()?.token ?? "default"] ?? COLORS.default
		return pair ? `light-dark(${pair[0]}, ${pair[1]})` : undefined
	}
	const size = () => props.size ?? 16
	return (
		<Show when={icon()} fallback={<FileText size={size()} strokeWidth={1.75} class={props.class} aria-hidden="true" />}>
			{(found) => (
				<svg aria-hidden="true" class={`shrink-0 ${props.class ?? ""}`} width={size()} height={size()} style={{ color: color() }} viewBox="0 0 16 16">
					<use href={`#${found().name}`} />
				</svg>
			)}
		</Show>
	)
}
