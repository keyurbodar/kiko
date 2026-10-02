# Frontend inventory (as of main @ 5845a72, 2026-10-02)

Read-only audit of apps/web-solid and packages/ui. Paths are repo-relative. "NOT FOUND" means grep/ls found nothing.

## 1. Build setup
- Bundler: Vite 7.1.4 (apps/web-solid/package.json), i.e. Rollup, NOT Rolldown. vite.config.ts:160 uses `build.rollupOptions`. (rolldown 1.2.11 exists in node_modules/.bun only transitively.)
- Plugins (vite.config.ts:155): vite-plugin-solid 2.11.10, @tailwindcss/vite 4.1.11, custom `kiko-link-preview` plugin.
- Tailwind 4.1.11 (CSS-first, no tailwind.config). `@theme` blocks in packages/ui/src/styles/kat.css:596 and :613. Layer order declared at apps/web-solid/src/styles/app.css:15 (`theme, base, v2, components, utilities`).
- Dev server port 3001 (vite.config.ts:157). Scripts: dev, build (`tsc --noEmit && vite build`), typecheck, preview. No test/lint script in package.json (tests run via `bun test`).
- Code splitting: none configured (no manualChunks, no lazy()/dynamic import). Two HTML inputs (vite.config.ts:162-165): `index.html` and `src/chat/harness.html` (the dev verification harness ships in the prod build too). Rollup produced a shared chunk named MessageList by accident.
- Dev/preview-only server middleware: `/api/link-preview` (vite.config.ts:117-153): SSRF-guarded fetch of page head, 5s timeout, 2MB cap, 5 redirects, 200-entry LRU. It does NOT exist in a static production host; the client (chat/lib/linkPreview.ts:179) calls it.
- dist/ is STALE and gitignored (built 30 Sep 15:36, before the last 3 commits). Sizes:
  - assets/MessageList-A-D3x2Kq.js 376k; MessageList-DPvgfiG4.css 91k; index-C7qTU2tD.js 39k; chat-harness-fpe4Jkzj.js 3.7k; main-2kTslW12.js 916B
  - emoji-picker-data.json 440k; emoji/ (twemoji-style SVGs, many files); fonts/ 4 woff2 (352k, 388k, 67k, 68k; the two big ones were deleted from public/ in 95c2d4b); dist total 20M
  - dist/index.html has theme-color #331D2C (source now #1c1b1f).
- Fonts: Inter is NOT loaded anywhere. Sans = system stack `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui` (kat.css:490). Mono = self-hosted "Fantasque Sans Mono" 400/700 via @font-face (kat.css:26-40) from public/fonts/{Y3td2gRp,hWqxyCs0}.woff2 (absolute `/fonts/...` URLs). A leftover @fontsource-variable/figtree sits in node_modules/.bun but is in no package.json.
- index.html (apps/web-solid/index.html): `<html class="dark" lang="en">`, color-scheme dark, theme-color #1c1b1f, title "Kiko", `<div id="root">`, `<script src=/src/main.tsx>`. No manifest, no icons, no font links, no PWA bits.
- tsconfig: strict, jsx preserve + solid-js, include `src` and vite.config.ts.

## 2. Routing
- @solidjs/router 0.15.4 and @solidjs/meta 0.29.4 are declared in package.json but imported NOWHERE (0 files). There is no router.
- Only screen: the composed chat app in src/main.tsx (`render(() => <App />, root)` :172). Sidebar rail has tabs chats / terminal / code / browser / settings (sidebar/sidebar.tsx:34-39,:155-166) held in a local signal (:55); only "chats" has a real panel, the others are placeholders. No URL state.
- Second entry: src/chat/harness.html + harness.tsx, `?state=<slug>` fixture states and `window.__chat` probes (dev/verification only).

## 3. Data layer
- All data is static fixtures: src/lib/fixtures.ts (1199 lines; BOTS :77, GROUPS :122, MESSAGES :217, FIXTURE_STATES :1107, UNREAD_ANCHOR_ID :1198, VIEWER_ID :24, NOW = Date.now() :38).
- State: one module-level `solid-js/store` in src/lib/store.ts:49-54, exposed as `useApp` object (:56-190): selectThread, toggleReaction, appendMessage, appendReply, markRead/markUnread, togglePinned, messagesFor, messageById. Everything is in memory; messages filtered per call (O(n) scans), ids `sent-N`. No persistence.
- WebSocket, EventSource, IndexedDB, localStorage: NOT FOUND. fetch calls only: `/api/link-preview` (chat/lib/linkPreview.ts:179), `/emoji-picker-data.json` (chat/ui/EmojiPicker.tsx:77), blob->size in composer/composer.tsx:60.
- Domain types: src/lib/types.ts (RosterBot, RosterGroup, Reaction, MediaItem, WebPagePreview, DocumentItem, ChatMessage with status "sending|sent|failed", OutgoingMessage, Thread, SidebarProps/ChatProps/ComposerProps). No agent-run/tool-call/streaming message types, no file/memory/reminder/integration types.
- Dependencies in packages/ui (@tanstack/solid-query, solid-dnd) are declared but unused (see 7).

## 4. Chat component inventory (apps/web-solid/src/chat)
- Transcript: MessageList.tsx (thin passthrough) -> VirtualThread.tsx (751 lines). Virtua: ONLY import site is VirtualThread.tsx:13 `Virtualizer` from "virtua/solid" (buffer 600, :53). Scroll anchoring/drift: lib/drift.ts, lib/heights.ts (height model), jump-to-message, landing highlight.
- Bubble: ui/bubble.tsx (Bubble, BubbleGroup, BubbleContent, BubbleReactions; variants/positions only|first|middle|last). Row: ui/MessageRow.tsx.
- Grouping: lib/grouping.ts (+ test) builds timeline items incl. date dividers and unread rule.
- Reply/quote preview: ui/Quote.tsx, lib/reply.ts (replySummary; photo thumb / doc glyph); composer/reply-bar.tsx.
- Read-more / collapse: NOT FOUND.
- Markdown: NOT FOUND. Rich text is a port of tweb's entity parser: lib/richtext/{parseEntities,regex,segments,suspicious,punycode,tld,url}.ts; entities = url, email, mention, hashtag only (no bold/italic/lists/code). Rendered by ui/RichText.tsx; suspicious-link confirm dialog ui/SuspiciousLinkDialog.tsx.
- Code highlighting / code blocks: NOT FOUND (no sugar-high/shiki/prism/hljs).
- Link preview card: ui/WebPageCard.tsx, lib/linkPreview.ts (parses og/twitter meta, large/small layouts).
- Media bubble: ui/Media.tsx (MessageMedia), lib/media.ts. Album/gallery layout: lib/album.ts (785 lines, tweb album layouter, tested). Documents: ui/Documents.tsx (typed ext badge).
- Lightbox: media/mediaViewer.tsx (496) + mediaViewer.css + zoom.ts; uses @kiko/ui/v2/modal-v2; native `<video>` at mediaViewer.tsx:362.
- Audio/voice player: NOT FOUND (audio mime only picks a colour in Documents.tsx:24). Custom video player: NOT FOUND (native controls).
- Reactions: ui/ReactionBadge.tsx (ReactionStack); store.toggleReaction. Emoji picker: ui/EmojiPicker.tsx wrapping `emoji-picker-element` with local SVG set (public/emoji, lib/emoji.tsx). 
- Typing indicator: ui/TypingRow.tsx (motion). Wired in VirtualThread.tsx:729 via `waitingNames`; main.tsx passes `waitingNames={[]}` so it never shows in the app.
- Date divider: ui/DateChip.tsx (floating chip + @corvu/calendar jump-to-date popover, lib/dayLabel.ts). Unread divider: ui/UnreadRule.tsx; main.tsx passes `firstUnreadMessageId={null}` so never shown in the app (harness `unread` state only).
- System messages: NOT FOUND. Empty state: ui/EmptyState.tsx. Jump-to-latest: ui/JumpToLatest.tsx (rendered at VirtualThread.tsx:742) AND a second scroll-down button in main.tsx (composer-scroll-down); two mechanisms. ScrollFades.tsx.
- Swipe-to-reply: ui/SwipeToReply.tsx wraps each row (VirtualThread.tsx:633). Gesture lib/useSwipeToReply.ts (545 lines; motion; leftward drag only, travel = max(0,-dx), :159-175). The reply icon (CornerUpLeft, 28px circle) is positioned `right-4` = RIGHT edge, revealed as the row slides left (SwipeToReply.tsx:73-78). Rightward drag is ignored by design (:20 comment).
- Context menu: ui/MessageMenu.tsx (MenuV2.Context :79, copy/reply/react etc.; `showToastV2` for "copied").
- Composer: src/composer/. composer.tsx (281, Kiko-authored) over prompt-input/ vendored from opencode (ATTRIBUTION.md). Editor = a hand-rolled `contenteditable` div (prompt-input/index.tsx:175) with mention chips as non-editable spans (:238-240); NOT CodeMirror/ProseMirror/Lexical. Mentions: `@bot` suggestions built from bots (composer.tsx:143-145), part type "agent". Slash commands: `commands: () => []` (composer.tsx:161) = none. Attachments: prompt-input/attachments.ts + attachment-card-v2.tsx (images become media, other files become documents, composer.tsx:204-210). Link draft preview: link-preview.tsx, link-draft.ts. Has history/persisted-state/model-select/shell-mode machinery from upstream, mostly unused.

## 5. Sidebar and navigation (src/sidebar)
- sidebar.tsx (267): vertical icon rail + resizable (200-420px, :31-33) collapsible panel; mingcute icons (icons.tsx). Not a horizontal tab bar; no horizontal navigation exists.
- chat-panel.tsx (331): pinned tiles grid + rows (`useApp.bots()` filtered by pinned, :304-305), hover-card preview, context menu (mark read/unread, pin), blobatar avatars. Groups (`useApp.groups()`, 2 fixtures) are NOT rendered in the panel.
- Search: NOT FOUND (no input in sidebar). Folders: NOT FOUND. Tabs (chat tabs): NOT FOUND. Virtua in sidebar: NO (plain `<For>`).
- Below 768px the panel overlays the transcript (commit 95c2d4b).

## 6. packages/ui (@kiko/ui)
- Public barrel src/index.ts: FileIcon, Icon, ProviderIcon, ButtonV2, HoverCardV2, IconV2, IconButtonV2, ModalV2, KeybindV2, MenuV2, TooltipV2, useFilteredList, I18nProvider/useI18n. Subpath exports (package.json): ./kat.css, ./icon(.css), ./file-icon(.css), ./provider-icon(.css), ./hooks, ./context/*, ./v2/*.
- components/ (legacy v1): icon.tsx (181), file-icon.tsx (588) + file-icons/sprite.svg (11.7k lines) + types, provider-icon.tsx + sprite.
- v2/components: button, dismissable-layer, hover-card, icon-button, icon (209), keybind, menu, modal, toast, tooltip (each -v2.tsx/.css). Total 10.
- Kobalte wrappers (@kobalte/core 0.13.11): button-v2, icon-button-v2, menu-v2 (DropdownMenu + ContextMenu), modal-v2 (Dialog), tooltip-v2, hover-card-v2, dismissable-layer-v2 (primitives), toast-v2 (solid-sonner + kobalte i18n), context/i18n.tsx. Corvu wrappers in packages/ui: NONE. Corvu is used only directly in apps/web-solid DateChip.tsx (@corvu/calendar). Note: the "dialog" Corvu is not used; Kobalte Dialog is.
- Not present: Tabs, Select, Switch, Checkbox, Input/TextField, Textarea, Avatar, Accordion, Popover, Resizable, Collapsible, Command palette, Badge, Progress. Commit 95c2d4b deleted 24 v2 components (accordion, avatar, badge, checkbox, field, file-tree-v2.css, inline-input, segmented-control, select, switch, tabs, text-input, textarea, radio, etc.). They are recoverable from git history (git show 95c2d4b^:packages/ui/src/v2/components/...).
- File tree component: NOT FOUND (only a deleted file-tree-v2.css; no .tsx ever listed in that commit; no headless-tree).
- Styles: src/styles/kat.css (1103 lines, dark-only, no borders), src/v2/styles/{colors.css 172, theme.css 503, tailwind.css 2}. 
  - kat.css sections: 1 fonts, 2 theme tiers (primitives `--l-grey-*` lightness steps, `--c-neutral` 0.008, orange l/c/h triplets, signal danger/success/gold), 3 @property registrations for animatable roles, 4 derived semantic layer (`--bg --bg-sidebar --bg-subtle --surface-raised --menu-bg --input-bg --hover-bg --text --text-muted --text-faint --accent --accent-fill --user-bubble --tint* --danger --success --gold`, `--hue:50`, `--cm` chroma multiplier, type scale `--font-xs..base` 11/12/13/14, radius scale `--brm`, layout constants, sidebar constants `--sidebar-nav-w --rail-icon --pin-circle --row-avatar`, syntax colours `--syntax-*`), 5 Tailwind bridge (@theme), 6 v2 bridge (`bg-v2-*`/`text-v2-*`), 7 base reset.
  - Accent: orange, oklch(0.751 0.161 47) mark; fill oklch(0.585 0.153 40); user bubble = orange-fill (kat.css:154). Note commit message calls it "mauve"; computed hue 40-50 chroma 0.15 is orange/copper on a warm-neutral grey. Canvas L 0.193. Dark only; no light theme, no theme switch (verify docs say so).
  - Syntax token vars already exist (`--syntax-*`, kat.css:747 area) so a highlighter can be themed without new tokens.

## 7. Dependencies: plan vs reality
Missing from every package.json and from bun.lock: sugar-high (a stray sugar-high@2.5.0 dir exists in node_modules/.bun, orphaned), CodeMirror 6, @headless-tree, thumbhash, fflate, Effect (stray effect@4.0.0-rc.115 and @effect/atom-react in node_modules/.bun, orphaned; bun.lock grep count 0). Also absent: markdown parser, audio waveform lib, Inter font, any realtime/WS client, any persistence lib.
Present but unused (candidates to drop):
- apps/web-solid: @solidjs/router (0 imports; keep if routing planned), @solidjs/meta (0), class-variance-authority (0), `blobatar` core (0 direct imports. Correction: it is a required peer dependency of @blobatar/solid, so it must stay).
- packages/ui: @tanstack/solid-query (0), @thisbeyond/solid-dnd (0), culori (0), @solid-primitives/bounds (0), @solid-primitives/media (0), motion (0 in ui; app uses it). fuzzysort/remeda/solid-list/solid-sonner each 1 import.
- Large: lucide-solid AND @mingcute/solid AND the Icon/IconV2/file-icon/provider-icon sprites = 4 icon systems. emoji-picker-element + 440k json + thousands of SVGs in public/emoji.
- Root devDeps (root node_modules): ultracite 7.12, oxlint, oxfmt, prettier, turbo, typescript 6.0.3 (app pins 5.8.2). Root package.json has NO scripts or devDependencies listed (only workspaces), so those are orphans of an earlier setup; no .oxlintrc/biome config checked into root listing (`ls -a` shows no config files found by my listing besides ultracite-agents.md).

## 8. OWNERSHIP.md, verify map, scripts
- apps/web-solid/OWNERSHIP.md: one-writer-per-file rule. Frozen: src/lib/types.ts, fixtures.ts, store.ts. Slices: Chat owns src/chat/**, Composer owns src/composer/**; CSS per slice; tokens owned by kat.css; src/main.tsx edited once on main. It is already out of date: it names `chat.css` (deleted), lists no Sidebar slice though src/sidebar exists, and the "frozen" files have been edited in recent commits. Plan should treat it as superseded.
- Verify map: .cursor/skills/verify-kiko/SKILL.md (418 lines: Launch, Doctor, Drive, Evidence, Cleanup, Helpers; uses `ego-browser nodejs`, no Playwright; use `localhost` not 127.0.0.1; harness at /src/chat/harness.html?state=<slug>, `window.__chat` probes) and .cursor/skills/verify-kiko/features/{README,app-shell,chat-bubbles,chat-images,chat-interactions,composer,kat-tokens,rich-text,sidebar}.md (997 lines total). README states each feature file has 4 H2 sections. It describes the app as of the prior commit (e.g. says "no top bar", "dark app").
- apps/web-solid/scripts/shots.sh + shots.js: screenshot helper writing to /tmp/kiko-verify-evidence/shots/<label> through ego-browser.
- ultracite-agents.md (root, 126 lines): Ultracite/Oxlint/Oxfmt coding standards (explicit types, for...of, no any, a11y rules). The matching AGENTS.md was deleted in 5845a72. No ultracite config or lint script is wired in package.json.
- docs/ did not exist before this file (docs/plan.md, solid-port.md, tech-stack.md were deleted in 5845a72; recover via `git show 5845a72^:docs/tech-stack.md`).
- Unit tests: 13 files, `bun test` in apps/web-solid: 171 pass, 0 fail (460ms). The verify README warns bun test resolves the server build of solid-js, so reactive derivations are not trustworthy there.

## 9. Breakage, TODOs, dead code
- `bun run typecheck` (apps/web-solid): PASS, no errors. `packages/ui` typecheck: PASS.
- TODO/FIXME/HACK/XXX markers: none found in src.
- Toasts never render: MessageMenu.tsx:68-70 calls `showToastV2` (copy confirmation) but `ToastV2.Region` (toast-v2.tsx:131) is mounted nowhere (grep). The copy toast is invisible.
- I18nProvider is never mounted but the composer/link-preview call `useI18n` from @kiko/ui/context/i18n (need to confirm the context has a default; the typecheck passes). i18n dict (packages/ui/src/i18n/en.ts, 220 lines) is opencode strings (sessionTurn, messagePart...), mostly irrelevant.
- main.tsx wiring gaps: `firstUnreadMessageId={null}`, `waitingNames={[]}`, `onJumpToMessage={() => {}}`, `scrollRef={() => {}}` (main.tsx:~95-100), so unread rule, typing row and unread tracking are demonstrable only in the harness.
- Group threads: store has GROUPS and Thread type supports groups, but the sidebar renders only bots and `activeMessages` works by id, so a group cannot be opened from the UI.
- Composer ATTRIBUTION.md lists prompt-input/attachments.css and attachment-card-v2.css as copied, but neither file exists in src/composer (composer.css is the only stylesheet imported, composer.tsx:10). Either styles were folded into composer.css or attachment styling is missing; verify visually.
- Vendored composer carries unused upstream surface (shell mode, model/agent select, history, persisted state, PromptInputV2Select/Popover, comment-card-v2, provider-icon import).
- Stale: dist/ (older than source), OWNERSHIP.md, verify-map statements, kat.css header comment about "coral" tokens vs actual orange names.
- `/api/link-preview` works only under Vite dev/preview; a real deployment needs a server route (the config is inside vite.config.ts, not in app code).
- Security-sensitive: the link-preview proxy blocks private hosts by hostname/IP string only (no DNS resolution check), so a public hostname resolving to a private IP bypasses it. Fine for dev, unfit for a hosted backend.
- Harness (`chat-harness` input) is included in the production build.
- Dual scroll-to-latest controls (JumpToLatest.tsx and main.tsx composer-scroll-down).
- Single 751-line VirtualThread.tsx and 785-line album.ts are the big files; `fixtures.ts` is 1199 lines of the only data.

## Reuse vs rebuild summary
Reusable as-is: virtualized transcript with anchoring, bubble/grouping/replies/reactions/emoji, media albums + viewer, link cards, rich-text links, swipe-to-reply, context menu, composer contenteditable with @mentions and attachments, kat tokens, Kobalte menu/modal/tooltip/hover-card/toast wrappers.
Must be built: routing, horizontal tab nav, settings, memory, reminders, integrations, file tree, real data layer (WS/HTTP/persistence), markdown + code blocks, agent/tool-call/streaming message types, system messages, audio player, search/folders in sidebar, group threads in sidebar, form controls (tabs/select/switch/input), Inter (or decision to keep system stack).
