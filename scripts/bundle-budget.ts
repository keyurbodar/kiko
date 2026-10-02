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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIST = join(import.meta.dir, "../apps/web-solid/dist");
const TOLERANCE = 1.05;
const HTML_MAX_BYTES = 20 * 1024;

/* Manifest keys. Tier 1 is the entry. Tier 2 is what /chat needs before it paints. */
const FIRST_PAINT_ROUTE = "src/app/routes/chat.tsx";
const APP_ENTRY = "src/main.tsx";

/* Tier 3 modules load with lazy() or a dynamic import on idle or intent. */
const TIER3 = ["../../node_modules/.bun/emoji-picker-element@1.29.1/node_modules/emoji-picker-element/index.js"];
/* Tier 4 route chunks load on route intent. */
const TIER4 = ["src/app/routes/files.tsx", "src/app/routes/board.tsx", "src/app/routes/memory.tsx", "src/app/routes/settings.tsx"];

/* Recorded gzip bytes, measured at P2-03. */
const RECORDED: Record<string, number> = {
  "tier 1 shell js": 1524,
  "tier 2 first paint of /chat": 220198,
  "tier 3 lazy modules": 13408,
  "tier 4 route chunks": 816,
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

/* The files of a set of manifest keys and their static imports, minus `exclude`. */
function closure(keys: string[], exclude = new Set<string>()): Set<string> {
  const files = new Set<string>();
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const entry = manifest[key];
    if (!entry) throw new Error(`manifest has no ${key}`);
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

let failed = false;
const htmlBytes = readFileSync(join(DIST, "index.html")).length;
const htmlOk = htmlBytes <= HTML_MAX_BYTES;
failed ||= !htmlOk;
console.log(`${htmlOk ? "ok  " : "FAIL"} index.html ${htmlBytes} bytes raw (max ${HTML_MAX_BYTES})`);

for (const [name, bytes] of Object.entries(measured)) {
  const recorded = RECORDED[name] ?? 0;
  const limit = Math.floor(recorded * TOLERANCE);
  const ok = bytes <= limit;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${bytes} bytes gzip (recorded ${recorded}, limit ${limit})`);
}

process.exit(failed ? 1 : 0);
