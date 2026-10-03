/*
 * Client tier budget. Reads the Vite manifest and fails when a tier grows past
 * its recorded gzip size plus 5 percent. Architecture 19.3.
 *
 *   cd apps/web-solid && bun run build   (once)
 *   bun scripts/bundle-budget.ts
 *
 * To record a new size on purpose, edit RECORDED below in the same change and
 * say why. Sizes are gzip bytes of the JS and CSS files in that tier.
 */
import { gzipSync } from "node:zlib";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIST = join(import.meta.dir, "../apps/web-solid/dist");
const TOLERANCE = 1.05;
const HTML_MAX_BYTES = 20 * 1024;

/* Manifest keys. Tier 1 is the entry. Tier 2 is what /chat needs before it paints. */
const FIRST_PAINT_ROUTE = "src/app/routes/chat.tsx";
const APP_ENTRY = "src/main.tsx";

/* Tier 3 modules load with lazy() or a dynamic import on idle or intent. */
const TIER3 = [
  "src/palette/palette.tsx",
  "src/chat/info/panel.tsx",
  "src/chat/ui/DateCalendar.tsx",
  "../../node_modules/.bun/emoji-picker-element@1.29.1/node_modules/emoji-picker-element/index.js",
  // Loaded after first paint, on idle or first use: Kobalte overlays, the toaster, motion, icon glyphs.
  "../../packages/ui/src/v2/components/overlays-impl.ts",
  "../../packages/ui/src/v2/components/toast-v2-impl.tsx",
  "../../node_modules/.bun/motion@12.34.5/node_modules/motion/dist/es/index.mjs",
  "../../packages/ui/src/components/icon-paths.ts",
  "../../packages/ui/src/v2/components/icon-bodies.ts",
  // Loaded on intent: the composer's attachment strip and popover, its link card, the picker wrapper, the masked link warning.
  "src/composer/prompt-input/extras.tsx",
  "src/composer/link-preview.tsx",
  "src/chat/ui/EmojiPicker.tsx",
  "src/chat/ui/SuspiciousLinkDialog.tsx",
];
/* Tier 4 route chunks load on route intent. */
const TIER4 = ["src/files/pane.tsx", "src/app/routes/settings.tsx"];

/*
 * Recorded gzip bytes, measured at P2-03. Re-recorded on purpose:
 * - tier 1: the shell html lists more modulepreload links.
 * - tier 3: P3-14 palette and cmdk-solid add 5.6 KB. The budget fix moved the hotkey library
 *   (@tanstack/solid-hotkeys), the corvu day calendar and fuzzysort out of tier 2 into lazy
 *   chunks, which adds about 12 KB here. Tier 2 shrank by the same code.
 * - tier 4: the settings and memory routes have real content. They were placeholders. P2-19 then removed the memory route: memory is a view in the info panel.
 * - The first-paint pass moved motion, solid-sonner, Kobalte (menus, tooltips, hover cards,
 *   dialogs, the dismissable layer, the button), the icon glyphs not shown at rest, and the
 *   composer's attachment strip, popover and link card out of tier 2, and listed those lazy
 *   modules in tier 3. Tier 2 fell from 231871 to 142468. Every number below is the new size.
 */
const RECORDED: Record<string, number> = {
  "tier 1 shell js": 1750, // First-paint pass: re-recorded at the measured size. P8-08: the sidebar lazy-loads the files panel, which adds one dynamic import to the entry.
  "tier 2 first paint of /chat": 150260, // Agents' files and drafts: the stores now carry folders, the user's drive (/home) and its overlay, drafts with kiko, private chats, and the socket's liveness ping (~7.8 KB with the earlier growth below). The rich tree renderer and sugar-high stay lazy. Before: 142468. First-paint pass: motion, sonner, Kobalte, idle icon glyphs and composer extras moved to tier 3. Before: 231871. P2-08 bubble pacing and drafts, the chat QA pass (group sender names and gutter avatar, bubble-in motion, empty-chat tips, start-chat button), and one chatSeed for every avatar.
  "tier 3 lazy modules": 165808, // First-paint pass: now also lists the overlays chunk, the toaster, motion, the icon glyphs and the composer extras, which left tier 2. Before: 45525. The Telegram-style info panel and memory redesign (action tiles, grouped list, core tiles, record header) add ~3 KB. P2-19: the chat info panel (10.5 KB gzip) is a lazy module. It loads on first open or on idle, never in tier 2.
  "tier 4 route chunks": 23389, // The files section left the rail for the chat's right panel. Its route chunk is gone, and the panel's files tab (src/files/pane.tsx) is measured here instead, with the file tree it draws at once (headless-tree, virtua, file icons): about 10.7 KB that was a dynamic import outside this count. The viewers (CodeMirror, the markdown parser, the table, pdf and media views) stay lazy chunks outside it. Earlier: The kat-style settings (sidebar rows with icons, provider logos, grouped cards, executor card) and the files chat switcher add ~2 KB. QA shell pass: the account section with sign out, provider search, and the narrow-screen settings tabs add ~1.2 KB to the settings route (the previous note still applies: grew 2.5 KB when every screen moved to the one IdentityAvatar (blobatar now loads with the routes that draw it); the real settings (providers, models, integrations, appearance, account), memory, and files routes. CodeMirror, the theme editor, and the file tree are dynamic imports, outside this count.
};

interface Entry {
  file: string;
  imports?: string[];
  css?: string[];
  isEntry?: boolean;
}

const manifestPath = join(DIST, ".vite/manifest.json");
if (!existsSync(manifestPath)) {
  console.error("no build manifest. run `bun run build` in apps/web-solid first.");
  process.exit(1);
}
const manifest: Record<string, Entry> = JSON.parse(readFileSync(manifestPath, "utf8"));

const gz = (file: string): number => gzipSync(readFileSync(join(DIST, file))).length;

/* Manifest keys a tier names that the build does not have. Reported as failures, never thrown. */
const missing = new Set<string>();

/* The files of a set of manifest keys and their static imports, minus `exclude`. */
function closure(keys: string[], exclude = new Set<string>()): Set<string> {
  const files = new Set<string>();
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const entry = manifest[key];
    if (!entry) {
      missing.add(key);
      return;
    }
    if (!exclude.has(entry.file)) files.add(entry.file);
    for (const css of entry.css ?? []) if (!exclude.has(css)) files.add(css);
    for (const dep of entry.imports ?? []) visit(dep);
  };
  keys.forEach(visit);
  return files;
}

const size = (files: Iterable<string>) => [...files].reduce((sum, file) => sum + gz(file), 0);

const entryKey = Object.keys(manifest).find((key) => manifest[key]?.isEntry);
if (!entryKey) throw new Error("manifest has no entry");

const tier1 = closure([entryKey]);
const tier2 = closure([APP_ENTRY, FIRST_PAINT_ROUTE], tier1);
const tier3 = closure(TIER3, new Set([...tier1, ...tier2]));
const tier4 = closure(TIER4, new Set([...tier1, ...tier2, ...tier3]));

const measured: Record<string, number> = {
  "tier 1 shell js": size(tier1),
  "tier 2 first paint of /chat": size(tier2),
  "tier 3 lazy modules": size(tier3),
  "tier 4 route chunks": size(tier4),
};

/* Libraries that must never reach tiers 1 to 3. Found by text that only the library's own code holds. */
const BANNED: Record<string, RegExp> = {
  effect: /["'`]effect\/[A-Z]/,
  codemirror: /@codemirror|cm-editor|cm-content/,
  "markdown parser (marked)": /markedjs\/marked/,
};

let failed = false;
const rows: string[] = [];
const fail = (message: string) => {
  failed = true;
  console.error(`FAIL ${message}`);
};

const banned: Array<[string, Set<string>]> = [
  ["tier 1 shell js", tier1],
  ["tier 2 first paint of /chat", tier2],
  ["tier 3 lazy modules", tier3],
];
for (const [name, files] of banned) {
  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    const text = readFileSync(join(DIST, file), "utf8");
    for (const [lib, pattern] of Object.entries(BANNED)) {
      if (pattern.test(text)) fail(`${name} contains ${lib} in ${file} (${gz(file)} bytes gzip). ${lib} may not load before tier 4.`);
    }
  }
}

for (const key of missing) fail(`manifest has no ${key}. A tier names it, so the tier is measured without it. Fix the key in scripts/bundle-budget.ts.`);

const htmlBytes = readFileSync(join(DIST, "index.html")).length;
const htmlOk = htmlBytes <= HTML_MAX_BYTES;
if (!htmlOk) fail(`shell index.html is ${htmlBytes} bytes raw, over the ${HTML_MAX_BYTES} byte max`);
console.log(`${htmlOk ? "ok  " : "FAIL"} index.html ${htmlBytes} bytes raw (max ${HTML_MAX_BYTES})`);
rows.push(`| shell index.html (raw) | ${htmlBytes} | ${HTML_MAX_BYTES} | ${htmlOk ? "ok" : "FAIL"} |`);

for (const [name, bytes] of Object.entries(measured)) {
  const recorded = RECORDED[name] ?? 0;
  const limit = Math.floor(recorded * TOLERANCE);
  const ok = bytes <= limit;
  if (!ok) fail(`${name} is ${bytes} bytes gzip, over its limit of ${limit} (recorded ${recorded} plus 5 percent). Fix the growth, or edit RECORDED in scripts/bundle-budget.ts and say why.`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${bytes} bytes gzip (recorded ${recorded}, limit ${limit})`);
  rows.push(`| ${name} | ${bytes} | ${limit} | ${ok ? "ok" : "FAIL"} |`);
}

/* The job summary on GitHub Actions. */
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  appendFileSync(summary, `### client bundle budget\n\n| tier | bytes | limit | result |\n| --- | ---: | ---: | --- |\n${rows.join("\n")}\n`);
}

process.exit(failed ? 1 : 0);
