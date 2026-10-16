/*
 * Tier 1 entry. Tiny on purpose: it loads tier 2 with a dynamic import and
 * holds the HTML shell until the first route's chunk is in, then swaps.
 * Architecture 19.3.
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

// A stale deploy removes old chunks. Reload once, never in a loop.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, "1");
  } catch {
    return;
  }
  location.reload();
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
  .catch(showBootError);
