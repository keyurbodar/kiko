# Rich text

A message body is not one string: it is a run of prose with urls, emails, mentions and hashtags mixed through it, and a reader has to be able to tell which is which at a glance. A url is something you can click, a mention and a hashtag are something the sender typed, and a url whose visible text and real destination disagree must not be clickable until the reader has been told where it actually goes.

## Sub-features

- `rich-links`: a url becomes an anchor that opens in a new tab with `rel="noopener noreferrer"`.
- `rich-scheme-gate`: a scheme-less host is linked only when its last label is a real TLD, so `foo.zzz` stays prose while `www.example.com` is linked and normalized to `https://`.
- `rich-sentence-furniture`: a trailing full stop, comma or unbalanced bracket is trimmed off the end of a url and left in the text, so the anchor does not swallow the punctuation.
- `rich-email`: an email becomes a `mailto:` anchor, with the address as the visible text.
- `rich-mention-hashtag`: a mention and a hashtag render as prose with a little more weight, **never** as anchors.
- `rich-homograph`: a host whose scripts mix is flagged rather than linked: the visible text is kept, the `href` is dropped entirely, and a confirm dialog names the real host before anything opens.
- `rich-userinfo`: a url carrying a login (`https://почта.рф@evil.com`) is the same kind of finding: the part that reads like a host is only a username, so the real destination is the part after the `@`.
- `rich-wrap`: the body preserves the sender's own line breaks and never widens the bubble, even for an unbroken url.

## How to get to it (user POV)

- Open the chat harness at `http://localhost:<port>/src/chat/harness.html?state=rich-text` and read the single body it holds. It is written to contain every case at once.
- Click a url to open it. Click a mention or a hashtag and nothing happens: they are not links.
- Send a message with a look-alike host to see it render as inert text and open the confirm on click.
- Type a long unbroken url into the composer and watch the bubble stop growing at its cap.

## Driving it with ego-browser

Preconditions:

- The dev server is running on the port chosen in `../../SKILL.md` and `/tmp/kiko-verify-evidence/vite.pid` names it.
- `../../SKILL.md` **Doctor** reports `ok: true` and `harnessStatus: 200`.
- **Use `http://localhost:<port>/`, not `http://127.0.0.1:<port>/`.** The server binds IPv6 loopback only; `curl` to `127.0.0.1:3017` exits `7` (connection refused) while `localhost:3017` answers `200`.
- **Every `page.goto` passes `{ waitUntil: "domcontentloaded", timeout: 60000 }`; a cold Vite module graph has been observed to need 90s on this page.** So on a first load pass a longer timeout and then wait on the condition.
- The homograph case needs a **real** mixed-script host. The `rich-text` fixture does not produce one: see the recipe and the gotchas.

Selectors this feature relies on:

- `.bubble-text`: the body, a `<span>` (not a `div`) carrying `whitespace-pre-wrap wrap-anywhere`. **A QA handle, not a style hook.**
- `.bubble-text a`: every anchor the body drew.
- `[data-component="chat-masked-link"]`: a flagged url: a `button` with **no `href`**, no `role` or `tabindex` attribute, and a click handler that opens the confirm.
- `.bubble-text span.font-medium`: a mention or a hashtag, rendered as prose with more weight.

- **Read the whole body and every run in it in one pass.** Observe: which runs became anchors, which stayed prose, and which lost their href.
  - Load `rich-text`, then run `page.evaluate(() => { const b = document.querySelector(".bubble-text"); return { text: b.textContent, className: b.className, whiteSpace: getComputedStyle(b).whiteSpace, overflowWrap: getComputedStyle(b).overflowWrap, anchors: [...b.querySelectorAll("a")].map((a) => ({ text: a.textContent, href: a.getAttribute("href"), hasHref: a.hasAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel"), masked: a.getAttribute("data-component") === "chat-masked-link", role: a.getAttribute("role"), tabindex: a.getAttribute("tabindex") })), weighted: [...b.querySelectorAll("span.font-medium")].map((n) => n.textContent) }; })`.
  - **On the `rich-text` state, the body reads** `Every shape the body parser has to tell apart, in one line: a bare link is https://example.com/geometry, a www. run is www.example.com, a trailing full stop is https://example.com/trailing. and foo.zzz is not a url so it has to stay plain text. Mail goes to ada@example.com, ping @ada, file it under #geometry, and https://аррӏе.com is not what it looks like.`
  - **Expected anchors, exactly four:** `https://example.com/geometry` → the same href; `www.example.com` → **`https://www.example.com`** (the scheme is added); `https://example.com/trailing` → **`https://example.com/trailing`** with the full stop **outside** the anchor; `ada@example.com` → **`mailto:ada@example.com`**. The homograph `https://аррӏе.com` is a button, not an anchor.
  - Every anchor carries `target: "_blank"` and `rel: "noopener noreferrer"`. **`span.font-medium` runs are the mention `@ada` and `#geometry`**, two, both prose, neither an anchor.

- **A non-TLD host stays prose.** Observe: `foo.zzz` is not clickable.
  - In the same read, confirm `foo.zzz` does not appear in the anchor list. The body text carries it as a text node. `page.evaluate(() => document.querySelector(".bubble-text").querySelectorAll("a").length)` is `4`, and none of their texts contains `zzz`. A run whose last label is not a real TLD being linked is a defect: the gate exists so ordinary dotted words are not turned into navigation.

- **Sentence furniture is trimmed off the url, not swallowed.** Observe: the trailing full stop stays in the text and stays out of the href.
  - In the same read, find the anchor whose text contains `trailing`: its `text` is `https://example.com/trailing` with **no** full stop, while the body's `textContent` reads `...https://example.com/trailing. and foo.zzz...` with one. **Assert the difference between the body's text and the anchor's text** rather than eyeballing either: the punctuation is the whole claim.

- **A mention and a hashtag are prose, not links.** Observe: they are weighted text and nothing else.
  - In the same read, confirm every `span.font-medium` run has **no** anchor ancestor and that its computed `font-weight` is heavier than the body's. `page.evaluate(() => { const b = document.querySelector(".bubble-text"); return [...b.querySelectorAll("span.font-medium")].map((n) => ({ text: n.textContent, weight: getComputedStyle(n).fontWeight, insideAnchor: !!n.closest("a") })); })` reports **`insideAnchor: false` for both** with `font-weight: 500` against the body's 400. A mention rendered as an anchor is a defect: an underlined word that cannot be clicked is a worse lie than no underline.

- **A homograph keeps its text and loses its href.** Observe: the flagged link is inert until the reader is told where it goes.
  - **The `rich-text` fixture produces one flagged link.** The body's `https://аррӏе.com` mixes a Cyrillic label with the Latin `com`, so the script check flags it, and it renders as a `button` with no `href`.
  - **To drive the real path, send a message containing a genuinely mixed-script host from the composed app.** Load `http://localhost:<port>/`, click `[data-component="prompt-input"]`, type `see https://аррӏе.com` and press `Enter` (the input is a `contenteditable` `<div>`, and `Enter` is the send path). Then run `page.evaluate(() => { const row = [...document.querySelectorAll('[data-component="chat-row"]')].pop(); const a = row.querySelector("[data-component='chat-masked-link']"); return { rowText: row.querySelector(".bubble-text").textContent, side: row.dataset.side, masked: row.querySelectorAll("[data-component='chat-masked-link']").length, anchor: a ? { text: a.textContent, hasHref: a.hasAttribute("href"), href: a.getAttribute("href"), role: a.getAttribute("role"), tabindex: a.getAttribute("tabindex"), cursor: getComputedStyle(a).cursor } : null, anchors: [...row.querySelectorAll(".bubble-text a")].map((x) => ({ t: x.textContent, href: x.getAttribute("href") })) }; })`.
  - **Measured:** one `chat-masked-link` whose `text` is `https://аррӏе.com`, whose **`hasHref` is `false` and `href` is `null`**, with `role` and `tabindex` both `null` (a `button` needs neither) and `cursor: "pointer"`. The `@ada` in the same sent body came back as a `span.font-medium`, not an anchor. **Assert `hasHref === false`: dropping the href rather than intercepting the click is deliberate, because it takes the middle-click and the keyboard with it and an interception misses both.** A flagged link that keeps an `href` is a defect. It is navigable by paths nothing intercepts.

- **The confirm names the real host before anything opens.** Observe: the dialog shows the punycode destination and offers two lowercase answers.
  - Click the masked link, wait ~800ms, and run `page.evaluate(() => ({ dialogs: document.querySelectorAll("[role=dialog]").length, title: document.querySelector("[data-component='modal-v2-title']")?.textContent?.trim(), body: document.querySelector("[role=dialog] p")?.textContent?.trim(), host: document.querySelector("[role=dialog] .font-mono")?.textContent?.trim(), buttons: [...document.querySelectorAll("[role=dialog] button")].map((b) => b.textContent.trim()), focused: document.activeElement?.textContent?.trim() }))`.
  - **Measured:** one `[role=dialog]`, the title **`This link may not go where it says`**, the body `The address is written in mixed scripts, which is how a look-alike host is spelled. It opens xn--80ak6aa92e.com.`, the monospace host **`xn--80ak6aa92e.com`**, and exactly two buttons: **`Cancel`** and **`Open anyway`**. **`Cancel` holds focus**, so the default answer to a dialog that only appears when something looks wrong is "no".
  - **Assert the host is the punycode destination, not the visible text.** `аррӏе.com` and `xn--80ak6aa92e.com` are the same host, and the dialog shows the real one: that is the entire point of the dialog, and a dialog echoing the visible text back proves nothing.
  - Press `Escape` and re-read: **measured, `[role=dialog]` drops to `0` and the masked link is still on screen**, inert and clickable again. The confirm closing without navigating is the correct end state for both its buttons.
  - **Do not click `Open anyway` in a verification run.** It calls `window.open`, and a probe that leaves a real tab open is worse than the check was worth. Prove the button exists, prove `Cancel` has focus, and close with `Escape`.

- **A long url never widens the bubble past its cap.** Observe: the body wraps an unbroken url instead of pushing the bubble wider.
  - In the `rich-text` read, `overflowWrap` is measured as **`anywhere`** and `whiteSpace` as **`pre-wrap`**, and the class list is exactly `bubble-text whitespace-pre-wrap wrap-anywhere`. The pre-wrap is what keeps a sender's own line breaks; `wrap-anywhere` is what keeps an unbroken url from widening the bubble past its cap. **Assert both, and cross-check the computed bubble width against the cap in `chat/ui/bubble.tsx`.**

- **Proof.** Write the run-by-run classification (anchor or prose, href or none, and the two weighted spans) to `/tmp/kiko-verify-evidence/rich-text.json`, and record separately that the fixture's homograph produced an ordinary anchor.

## Gotchas

- **The homograph is a `button`, not an anchor.** Assert it on `[data-component="chat-masked-link"]`, not on `a`. A recipe that counts it among the anchors, or expects an `href` on it, is asserting the design this feature exists to reject. The `rich-text` fixture no longer carries the userinfo case (`https://почта.рф@evil.com`); send that from the composed app if you need it.
- **Assert `hasHref === false`, not "the click does nothing".** A flagged link keeps its text and drops its `href` entirely, so there is no middle-click path, no keyboard path and no `window.open` fallback: the confirm is the only route. Intercepting the click instead would leave all three open.
- **The confirm shows the punycode host, not the visible one.** `аррӏе.com` renders as `xn--80ak6aa92e.com` in the dialog. A check that compares the dialog's host to the link's text will report a mismatch; compare it to the link's *intent*, or assert it is a punycode label.
- **`Cancel` is the focused button and the first one in the DOM.** Assert that: a dialog whose default is "go anyway" is a defect, because the whole dialog only exists when something looks wrong.
- **Do not click `Open anyway`.** It calls `window.open` and leaves a real tab behind. Prove the button's presence and Escape's behaviour instead.
- **A mention and a hashtag are `span.font-medium`, not anchors.** Assert `closest("a") === null` and the heavier `font-weight`. Counting anchors in the body and expecting the mention among them is asserting the design this feature exists to reject.
- **`www.example.com` gets an `https://` scheme and the visible text does not.** The anchor's `href` is `https://www.example.com` while its text is `www.example.com`. Assert the href, not the text, for that case.
- **A trailing full stop lives outside the anchor.** The body's `textContent` and the anchor's text differ by exactly the punctuation. That difference is the assertion.
- **An email is a `mailto:` anchor.** So it appears in the same `querySelectorAll("a")` list as the urls with a different scheme. Filter on the scheme when counting "urls".
- **`foo.zzz` staying prose is the TLD gate, not a parser miss.** A dotted word that is not a url must not become navigation; if a run is linked on a last label that is not a real TLD, that is a defect.
- **The body is a `<span>`, not a `div`.** A recipe that reaches for `[data-component="chat-text"]` finds nothing. The handle is the `bubble-text` class, and it is a QA handle rather than a style hook.
- **Sending is a composed-app-only path.** The harness mounts `MessageList` alone, so `[data-component="prompt-input"]` is `0` there. See [Composer](./composer.md).

## Agent file chips

An agent's message arrives as a tree the server parsed (`apps/server/src/room/rich-text.ts`), and `apps/web-solid/src/chat/rich/RichText.tsx` draws it. A file the agent names becomes a chip, as in t3code: the file's icon and name in a small tinted pill. A click opens the file in the right panel's files tab. The human's own text never gets chips.

- `file-chip-detect`: a link whose href is a path (`/plan/route.md`, `notes.md:3`, `./a/b.md#L4`, `file:///x.md`) and inline code that is clearly a path (a slash or a `:line`, an extension unless it starts with `/` or `./`, not a hostname or a version) become chips. Fenced code, prose, `node.meta`, `example.com/docs` and `/chat/settings` do not. The rules and their table test live in `chat/rich/file-links.ts`.
- `file-chip-label`: the label is the file's name, then the parent folders when two chips in one message share a name (`index.ts · a/x`), then the line (`L3`). A link whose words are not the file's name keeps them, with the chip after.
- `file-chip-open`: a click opens the file at its line. The chat's own files are searched first, then home. A bare name opens its one match. A name no file has draws a dashed edge and shows the toast `No file named <name> in this chat`. A name several files share opens the files tab on its tree.
- `file-chip-menu`: right-click shows only `Open` and `Copy path`, never the message menu. The tooltip is the full path with its line.

How to drive it, in `agent-browser` only:

- Create files with `fetch("/api/files/<roomId>?path=plan/route.md", { method: "PUT", headers: { "content-type": "text/markdown" }, body: "# route" })`.
- `/api/dev/agent/seed` writes plain text with no tree, so it draws no chips. Turn on the fake agent with `POST /api/dev/agent/fake { roomId }`, then send a message from the composer. Its reply `heard: <your text>` goes through the parser.
- Read the chips with `[...document.querySelectorAll("[data-component=chat-file-chip]")].map((e) => [e.textContent, e.dataset.path, e.hasAttribute("data-missing")])`.
- Measured on 2026-10-09 for the text ``route is in at `/plan/route.md`, see [the plan](/plan/route.md:3) and `notes.md:2`. Also [notes.md](notes.md), `a/x/index.ts`, `b/x/index.ts`, and `missing/gone.md`. Not files: `node.meta`, `example.com/docs`, [settings](/chat/settings).``: seven chips, `route.md`, `route.md · L3`, `notes.md · L2`, `notes.md`, `index.ts · a/x`, `index.ts · b/x`, and `gone.md` with `data-missing`. The last three runs stay code and text.
- A click on a chip sets `localStorage["kiko:info-tab"]` to `files` and opens the panel on the file.

Gotchas:

- A message stored before the server kept file hrefs has the link's words only, so an old `[x](/plan/a.md)` draws no chip. Send a new one.
- A right-click before the overlay chunk loads falls through to the message menu. It loads on idle, so wait a second after the page opens.