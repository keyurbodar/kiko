/*
 * Tier 1 entry. Tiny on purpose: it loads tier 2 with a dynamic import and
 * holds the HTML shell until the first route's chunk is in, then swaps.
 */

import { apiUrl, getToken, read } from "./lib/api-base";

const RELOAD_KEY = "kiko:preload-reload";

// Same specifiers as `app/routes.tsx`, so the bundler shares the chunks.
function firstRouteChunk(path: string): Promise<unknown> {
  if (path.startsWith("/settings")) return import("./app/routes/settings");
  return import("./app/routes/chat");
}

function showBootError(): void {
  const el = document.getElementById("boot-error");
  if (el) el.style.display = "block";
}

// A chunk an older deploy removed, or one this browser cached wrong (a deploy still spreading answered it with
// index.html, which the one-year cache header kept). Fetch each named file past the cache, then reload once, never
// in a loop: at most once in 30 seconds, so a later deploy can still recover the same tab.
async function recover(error: unknown): Promise<void> {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) < 30_000) return showBootError();
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return showBootError();
  }
  for (const file of String(error).match(/\/assets\/\S+?\.js/g) ?? []) await fetch(file, { cache: "reload" }).catch(() => {});
  location.reload();
}

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  void recover((event as Event & { payload?: unknown }).payload);
});

// The session check and, for a browser with no cached session, the sign-in screen
// start now, in parallel with the route chunk, instead of one after another.
declare global {
  var __kikoBoot: { me?: Promise<Response> } | undefined;
}
const signedInBefore = read("kiko:session") !== null;
const token = getToken();
globalThis.__kikoBoot = { me: fetch(apiUrl("/api/me"), token ? { headers: { authorization: `Bearer ${token}` } } : undefined) };
if (!signedInBefore) void import("./app/sign-in").catch(() => {});

const chunk = firstRouteChunk(location.pathname === "/" ? "/chat" : location.pathname);
void Promise.all([import("./main"), chunk])
  .then(([main]) => main.start())
  .catch(recover);
