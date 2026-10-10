import { expect, test } from "bun:test";
import { buildCatalog, catalogFile } from "./build-catalog.ts";

const catalog = await buildCatalog();

test("every provider lists at least one connect method", () => {
  expect(catalog.providers.length).toBeGreaterThan(10);
  for (const provider of catalog.providers) {
    expect(provider.id).toBeTruthy();
    expect(provider.connect.length).toBeGreaterThan(0);
  }
});

test("every model has provider, id, context window, and pricing", () => {
  let count = 0;
  for (const provider of catalog.providers) {
    for (const model of provider.models) {
      count += 1;
      expect(provider.id).toBeTruthy();
      expect(model.id).toBeTruthy();
      expect(model.contextWindow).toBeGreaterThan(0);
      for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
        expect(Number.isFinite(model.pricing[key])).toBe(true);
      }
    }
  }
  expect(count).toBeGreaterThan(100);
});

test("the test model and the connect kinds come from pi-ai", () => {
  const opencodeGo = catalog.providers.find((p) => p.id === "opencode-go");
  expect(opencodeGo?.models.some((m) => m.id === "deepseek-v4.1-flash")).toBe(true);
  expect(opencodeGo?.connect).toEqual(["api_key"]);
  expect(catalog.providers.find((p) => p.id === "github-copilot")?.connect).toContain("device_code");
  expect(catalog.providers.find((p) => p.id === "anthropic")?.connect).toContain("paste_code");
});

test("the file name is a hash of the content", () => {
  const a = catalogFile(catalog);
  expect(a.fileName).toMatch(/^models-[0-9a-f]{10}\.json$/);
  expect(catalogFile(catalog).fileName).toBe(a.fileName);
  expect(catalogFile({ providers: catalog.providers.slice(1) }).fileName).not.toBe(a.fileName);
});

test("a provider's classifier models are counted, so the client can tell a judge from a chat provider", () => {
  const typesafe = catalog.providers.find((p) => p.id === "typesafe");
  expect(typesafe?.models).toEqual([]);
  expect(typesafe?.classifiers).toBeGreaterThan(0);
  expect(catalog.providers.find((p) => p.id === "anthropic")?.classifiers).toBe(0);
});
