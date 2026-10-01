import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";

const PREVIEW_TIMEOUT_MS = 5000;
const PREVIEW_MAX_BYTES = 2_000_000;
const PREVIEW_MAX_REDIRECTS = 5;
const PREVIEW_CACHE_SIZE = 200;
const PREVIEW_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface PreviewPayload {
  status: number;
  contentType: string | null;
  html: string;
}

const previewCache = new Map<string, PreviewPayload>();

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "::" || host.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (host.startsWith("::ffff:")) return true;
  const octets = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!octets) return false;
  const first = Number(octets[1]);
  const second = Number(octets[2]);
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 192 && second === 168) return true;
  return first === 172 && second >= 16 && second <= 31;
}

function parsePublicUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isPrivateHost(url.hostname)) return null;
  return url;
}

async function readHead(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let html = "";
  let total = 0;
  let scanFrom = 0;
  while (total < PREVIEW_MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    html += decoder.decode(value, { stream: true });
    const end = html.toLowerCase().indexOf("</head>", scanFrom);
    if (end !== -1) {
      html = html.slice(0, end + "</head>".length);
      break;
    }
    scanFrom = Math.max(0, html.length - "</head>".length);
  }
  await reader.cancel().catch(() => undefined);
  return html;
}

async function fetchPreviewPage(start: URL): Promise<PreviewPayload | null> {
  const signal = AbortSignal.timeout(PREVIEW_TIMEOUT_MS);
  let current = start;
  for (let hop = 0; hop <= PREVIEW_MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: { "user-agent": PREVIEW_USER_AGENT, accept: "text/html" },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = parsePublicUrl(new URL(location, current).href);
      if (!next) return null;
      current = next;
      continue;
    }
    if (!response.ok) return null;
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      html: await readHead(response),
    };
  }
  return null;
}

function remember(key: string, payload: PreviewPayload): void {
  previewCache.delete(key);
  previewCache.set(key, payload);
  if (previewCache.size <= PREVIEW_CACHE_SIZE) return;
  const oldest = previewCache.keys().next().value;
  if (oldest !== undefined) previewCache.delete(oldest);
}

async function handleLinkPreview(request: IncomingMessage, response: ServerResponse, next: () => void) {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  if (requestUrl.pathname !== "/api/link-preview") {
    next();
    return;
  }
  const target = request.method === "GET" ? parsePublicUrl(requestUrl.searchParams.get("url") ?? "") : null;
  if (!target) {
    response.statusCode = 204;
    response.end();
    return;
  }

  let payload = previewCache.get(target.href) ?? null;
  if (!payload) {
    try {
      payload = await fetchPreviewPage(target);
    } catch {
      payload = null;
    }
    if (payload) remember(target.href, payload);
  }
  if (!payload) {
    response.statusCode = 204;
    response.end();
    return;
  }
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

function linkPreviewProxy(): Plugin {
  return {
    name: "kiko-link-preview",
    configureServer(server) {
      server.middlewares.use((request, response, next) => void handleLinkPreview(request, response, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => void handleLinkPreview(request, response, next));
    },
  };
}

export default defineConfig({
  plugins: [solid(), tailwindcss(), linkPreviewProxy()],
  server: {
    port: 3001,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        "chat-harness": resolve(import.meta.dirname, "src/chat/harness.html"),
      },
    },
  },
});
