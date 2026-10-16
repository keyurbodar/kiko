import { gzipSync } from "node:zlib";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIST = join(import.meta.dir, "../apps/web-solid/dist");
const TOLERANCE = 1.05;
const HTML_MAX_BYTES = 20 * 1024;

const FIRST_PAINT_ROUTE = "src/app/routes/chat.tsx";
const APP_ENTRY = "src/main.tsx";

const TIER3 = [
  "src/palette/palette.tsx",
  "src/chat/side/Sidecar.tsx",
  "src/chat/ui/DateCalendar.tsx",
  "../../packages/ui/src/v2/components/overlays-impl.ts",
  "../../packages/ui/src/v2/components/toast-v2-impl.tsx",
  "src/composer/prompt-input/extras.tsx",
  "src/composer/rich/bind.ts",
  "src/chat/ui/ImageDialog.tsx",
  "src/chat/ui/EmojiPicker.tsx",
  "src/chat/ui/ReactionPopover.tsx",
  "src/chat/ui/SuspiciousLinkDialog.tsx",
];
const TIER4 = ["src/app/routes/settings.tsx"];

const RECORDED: Record<string, number> = {
  "tier 1 shell js": 2122, // P09 (2026-10-16): re-recorded at the measured size (-25 B). Before: Cross-origin client (H03): the entry builds its /api/me request from the stored backend address and bearer token (lib/api-base.ts, +154 B). Before: 1993. Boot prefetch (2026-10-12): the entry starts /api/me, and for a browser with no cached session /api/providers and the sign-in chunk, in parallel with the route chunk (+101 B). It removes two serial round trips before sign-in shows. Before that, t3code attachments (2026-10-09): the entry's list of lazy chunks names the image dialog and a few shared chunks Rolldown split differently (+57 B over main's 1835, which was 2 B under the old limit). Before: 1750. First-paint pass: re-recorded at the measured size. P8-08: the sidebar lazy-loads the files panel, which adds one dynamic import to the entry.
  "tier 2 first paint of /chat": 192486, // P09: the composer shows a plain-text field at first paint and loads Tiptap and ProseMirror (composer/rich/bind.ts) after mount, so they left tier 2 (306,349 on the base commit, which had a static import by mistake). Before: Sidecar redesign (10159db5, 2026-10-13): the top bar's two lucide icons and the lucide runtime (estimated about 2 KB, not measured alone) and chat/side/surfaces.ts are in first paint. The base commit 82591c98 already measured 191993, over the old limit. Re-recorded at the measured size so the budget guards growth from here. Replacing the two icons with inline SVG in top-bar.tsx would recover about 2 KB. Before: 180567. t3code attachments (2026-10-09): the album layouter, link cards, thumbhash, the link preview cache and the media viewer's opener left first paint (-3.3 KB). Before: 178838. Emoji pass: the message hover actions, the shared emoji data and recents, and the composer's emoji button and shortcode list add 1.5 KB, after swipe to reply and Twemoji left. The build before it already measured 177348, past the old limit. Before: 166174. Redesign merged with extensions: the frost, graphite and porcelain looks with the tint (look model and pre-paint cache), the one Claude-style sidebar that replaced the rail, Hugeicons glyphs as named exports in place of the two icon sprites, and the extensions proposals count and waiting dot. The pixel field and moments are lazy, and the presence stage is gone. Before: 158220. Memory pass (~1.7 KB): the capped message window with paging from IndexedDB and disk patches, the split row memos, the shared user socket channel, object URL revocation, and the thumbhash placeholder. The still maker and both thumbhash halves load lazily. main before it: 156553, already past the earlier record. Before: 150260. Agents' files and drafts: the stores now carry folders, the user's drive (/home) and its overlay, drafts with kiko, private chats, and the socket's liveness ping (~7.8 KB with the earlier growth below). The rich tree renderer and sugar-high stay lazy. Before: 142468. First-paint pass: motion, sonner, Kobalte, idle icon glyphs and composer extras moved to tier 3. Before: 231871. P2-08 bubble pacing and drafts, the chat QA pass (group sender names and gutter avatar, bubble-in motion, empty-chat tips, start-chat button), and one chatSeed for every avatar.
  "tier 3 lazy modules": 292530, // P09: now holds the rich editor again (bind.ts, about 113 KB gzip). The motion entry is dropped from the list: Rolldown no longer emits it, so it measured nothing. Before: Merged dusty-finch + cobalt-thistle: measured build, guard growth from here. redesign (10159db5, 2026-10-13): the files pane (headless-tree, virtua, file icons) moved from tier 4 into the lazy Sidecar, so tier 3 plus tier 4 is 264618, under the old 266273. Before: 239167. Composer on Tiptap (K04, 2026-10-13): the rich editor (@tiptap/core, @tiptap/pm, and the extensions for marks, lists, quotes, code blocks, and undo) and the markdown serializer load lazily from composer/rich/bind.ts after the composer mounts, so they are tier 3. That is about 110 KB gzip more than before, and tier 2 does not contain them. Before: 129778. t3code attachments (2026-10-09): the composer's link card and the comment cards are gone, the strip is smaller, and the image dialog is listed (-8.8 KB from main's 136049). Before: 143640. Emoji pass: emoji-picker-element is gone, replaced by kiko's own picker and the reaction popover (-11.8 KB). Before: 165808. First-paint pass: now also lists the overlays chunk, the toaster, motion, the icon glyphs and the composer extras, which left tier 2. Before: 45525. The Telegram-style info panel and memory redesign (action tiles, grouped list, core tiles, record header) add ~3 KB. P2-19: the chat info panel (10.5 KB gzip) is a lazy module. It loads on first open or on idle, never in tier 2.
  "tier 4 route chunks": 19872, // P09: re-recorded at the measured size. The recorded 9,480 was stale: the base commit already measured 19,820, because the settings route gained its pages (models, integrations, routines, recipes) after the last record. This is not growth from P09. Before: Sidecar redesign (10159db5, 2026-10-13): the files pane moved to tier 3, so this is re-recorded at the measured size. Before: 27106. t3code file viewing (2026-10-09): the files tab gained t3code's file tabs, the crumbs with their folder menus, the shared surface chrome (actions with tooltips, notice, loading, failure, no preview), the rendered and source switches with their saved preferences, and the inline picture, video and audio views (+3.5 KB from 23640). The Telegram-style media viewer it replaced was a lazy chunk outside this count. CodeMirror, the markdown parser, the table, html and pdf views stay lazy chunks outside it. Before: 24802. Extensions (architecture section 24, +0.6 KB from 24205): the settings section entry and its lazy loader, the files header's install button, and the proposals count in the settings list. The extensions page, its review, and the code diff are a lazy chunk outside this count, and the folder reader loads on the install click. Before: 23389. The files section left the rail for the chat's right panel. Its route chunk is gone, and the panel's files tab (src/files/pane.tsx) is measured here instead, with the file tree it draws at once (headless-tree, virtua, file icons): about 10.7 KB that was a dynamic import outside this count. The viewers (CodeMirror, the markdown parser, the table, pdf and media views) stay lazy chunks outside it. Earlier: The kat-style settings (sidebar rows with icons, provider logos, grouped cards, integrations card) and the files chat switcher add ~2 KB. QA shell pass: the account section with sign out, provider search, and the narrow-screen settings tabs add ~1.2 KB to the settings route (the previous note still applies: grew 2.5 KB when every screen moved to the one IdentityAvatar (blobatar now loads with the routes that draw it); the real settings (providers, models, integrations, appearance, account), memory, and files routes. CodeMirror, the theme editor, and the file tree are dynamic imports, outside this count.
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

const missing = new Set<string>();

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

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  appendFileSync(summary, `### client bundle budget\n\n| tier | bytes | limit | result |\n| --- | ---: | ---: | --- |\n${rows.join("\n")}\n`);
}

process.exit(failed ? 1 : 0);
