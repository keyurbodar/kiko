// Builds the model catalog the settings screen loads. Everything comes from the installed pi-ai package.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type ConnectMethod = "api_key" | "device_code" | "paste_code";

export interface CatalogModel {
  id: string;
  name: string;
  api: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  input: string[];
  /** Price in dollars per million tokens. */
  pricing: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface CatalogProvider {
  id: string;
  name: string;
  connect: ConnectMethod[];
  models: CatalogModel[];
  /** How many classifier models the provider serves. One with classifiers and no chat models only judges memory. */
  classifiers: number;
}

export interface Catalog {
  providers: CatalogProvider[];
}

const root = resolve(import.meta.dirname, "..");
// ASSUMPTION: the server app owns the pi-ai dependency, so the catalog is read from its install.
const piAiDist = join(root, "apps/server/node_modules/@earendil-works/pi-ai/dist");

async function loadPiAi(): Promise<{ builtinProviders: () => any[] }> {
  return import(pathToFileURL(join(piAiDist, "providers/all.js")).href);
}

/** The pi-ai module file that implements a provider's OAuth flow, found from the provider's own source. */
function oauthSource(providerId: string): string | undefined {
  let provider: string;
  try {
    provider = readFileSync(join(piAiDist, "providers", `${providerId}.js`), "utf8");
  } catch {
    return undefined;
  }
  const loader = /load:\s*(?:\(\)\s*=>\s*)?(load\w+)/.exec(provider)?.[1];
  if (!loader) return undefined;
  const loadSource = readFileSync(join(piAiDist, "auth/oauth/load.js"), "utf8");
  const body = new RegExp(`export const ${loader} = [\\s\\S]*?importOAuthModule\\("\\./([\\w-]+)\\.ts"\\)`).exec(loadSource);
  if (!body) return undefined;
  return readFileSync(join(piAiDist, "auth/oauth", `${body[1]}.js`), "utf8");
}

// ASSUMPTION: pi-ai exposes the flow kind only at login time, so it is read from the flow module's events.
// An oauth flow that emits no device code is a browser sign-in whose redirect the user pastes back.
function oauthMethod(providerId: string): ConnectMethod {
  const source = oauthSource(providerId);
  return source?.includes('type: "device_code"') ? "device_code" : "paste_code";
}

export async function buildCatalog(): Promise<Catalog> {
  const { builtinProviders } = await loadPiAi();
  const providers: CatalogProvider[] = [];
  for (const provider of builtinProviders()) {
    const connect: ConnectMethod[] = [];
    if (provider.auth?.apiKey) connect.push("api_key");
    if (provider.auth?.oauth) connect.push(oauthMethod(provider.id));
    const models: CatalogModel[] = [...provider.getModels()].map((model: any) => ({
      id: model.id,
      name: model.name,
      api: model.api,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: Boolean(model.reasoning),
      input: [...model.input],
      pricing: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cacheRead: model.cost?.cacheRead ?? 0,
        cacheWrite: model.cost?.cacheWrite ?? 0,
      },
    }));
    models.sort((a, b) => a.id.localeCompare(b.id));
    const classifiers = (provider.getAllModels?.() ?? []).filter((model: any) => model.type === "classifier").length;
    providers.push({ id: provider.id, name: provider.name ?? provider.id, connect, models, classifiers });
  }
  providers.sort((a, b) => a.id.localeCompare(b.id));
  return { providers };
}

export interface CatalogFile {
  fileName: string;
  json: string;
}

/** Serializes the catalog and names it by content hash, so the file can be cached forever. */
export function catalogFile(catalog: Catalog): CatalogFile {
  const json = JSON.stringify(catalog);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 10);
  return { fileName: `models-${hash}.json`, json };
}

if (import.meta.main) {
  const outDir = process.argv[2];
  const file = catalogFile(await buildCatalog());
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, file.fileName), file.json);
  }
  console.log(file.fileName);
}
