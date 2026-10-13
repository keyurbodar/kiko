import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CHARM_NAMES, CHARM_RATE, COLLECTIONS, COLLECTION_NAMES, FESTIVALS, FESTIVAL_NAMES, FLAVOUR_NAMES, FLAVOURS, MOOD_NAMES,
  OUTFIT_NAMES, PATTERN_NAMES, PATTERN_RATE, SEASONS, SEKKI, avatar, render, resolve,
} from "../src/index";
import { avatarUri, cachedUri } from "../src/uri";
import { goldenLines } from "./golden";

const names = Array.from({ length: 2000 }, (_, i) => `person-${i}`);

describe("determinism", () => {
  test("matches the recorded golden renders", () => {
    expect(goldenLines().join("\n") + "\n").toBe(readFileSync(new URL("./golden.txt", import.meta.url), "utf8"));
  });
  test("normalizes case, whitespace and unicode composition", () => {
    expect(avatar("  Keyur@Example.com ")).toBe(avatar("keyur@example.com"));
    expect(avatar("café")).toBe(avatar("café"));
    expect(avatar("Keyur", { normalize: false })).not.toBe(avatar("keyur", { normalize: false }));
  });
});

describe("catalog", () => {
  test("every flavour name has a definition and vice versa", () => {
    expect(Object.keys(FLAVOURS).sort()).toEqual([...FLAVOUR_NAMES].sort());
  });
  test("collections and presets only name real flavours", () => {
    for (const c of COLLECTION_NAMES) for (const f of COLLECTIONS[c]) expect(FLAVOUR_NAMES).toContain(f);
    for (const p of [...SEASONS, ...SEKKI, ...Object.values(FESTIVALS)]) expect(FLAVOUR_NAMES).toContain(p.flavour);
    expect(SEKKI).toHaveLength(24);
  });
});

describe("distribution", () => {
  test("every flavour appears and none dominates", () => {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(resolve(n).flavour, (counts.get(resolve(n).flavour) ?? 0) + 1);
    expect(counts.size).toBe(FLAVOUR_NAMES.length);
    for (const c of counts.values()) expect(c).toBeLessThan((names.length / FLAVOUR_NAMES.length) * 1.6);
  });
  test("charm and pattern shares are near their rates", () => {
    const share = (k: "charm" | "pattern") => names.filter((n) => resolve(n)[k]).length / names.length;
    expect(Math.abs(share("charm") - CHARM_RATE)).toBeLessThan(0.04);
    expect(Math.abs(share("pattern") - PATTERN_RATE)).toBeLessThan(0.04);
  });
  test("a hashed name never wears an outfit and a charm together", () => {
    for (const n of names) { const y = resolve(n); expect(y.charm !== null && y.outfit !== null).toBe(false); }
    expect(names.some((n) => resolve(n).outfit)).toBe(true);
  });
  test("every avatar shares one silhouette", () => {
    const outline = (s: string) => s.match(/<clipPath id="[^"]+"><path d="([^"]+)"/)![1];
    const first = outline(avatar(names[0]!));
    for (const n of names.slice(1, 200)) expect(outline(avatar(n))).toBe(first);
  });
});

describe("pins", () => {
  test("a single value fixes the trait", () => {
    for (const n of names.slice(0, 50)) expect(resolve(n, { flavour: "sakura" }).flavour).toBe("sakura");
  });
  test("a list narrows the choice and the name still picks", () => {
    const seen = new Set(names.slice(0, 200).map((n) => resolve(n, { flavour: ["matcha", "yuzu"] }).flavour));
    expect([...seen].sort()).toEqual(["matcha", "yuzu"]);
  });
  test("a collection limits flavours to its set", () => {
    const seen = new Set(names.slice(0, 400).map((n) => resolve(n, { collection: "cafe" }).flavour));
    expect([...seen].sort()).toEqual([...COLLECTIONS.cafe].sort());
  });
  test("none clears charm, outfit and pattern", () => {
    for (const n of names.slice(0, 50)) {
      const y = resolve(n, { charm: "none", outfit: "none", pattern: "none" });
      expect([y.charm, y.outfit, y.pattern]).toEqual([null, null, null]);
    }
  });
  test("pinning one trait leaves the others untouched", () => {
    for (const n of names.slice(0, 50)) {
      const a = resolve(n), b = resolve(n, { pattern: "shima" });
      expect({ ...b, pattern: a.pattern }).toEqual(a);
    }
  });
  test("presets fill what they name and the name still varies the rest", () => {
    const tan = names.slice(0, 100).map((n) => resolve(n, { festival: "tanabata" }));
    for (const y of tan) expect([y.flavour, y.charm, y.mood]).toEqual(["ramune", "star", "love"]);
    expect(new Set(tan.map((y) => `${y.pattern}|${y.facing}`)).size).toBeGreaterThan(3);
    for (const f of FESTIVAL_NAMES) expect(resolve("x", { festival: f, sekki: 3, season: 6 }).flavour).toBe(FESTIVALS[f].flavour);
    expect(resolve("x", { sekki: 3, season: 6 }).flavour).toBe(SEKKI[2]!.flavour);
    expect(resolve("x", { sekki: 25 }).flavour).toBe(SEKKI[0]!.flavour);
    expect(resolve("x", { season: 10 }).outfit).toBe("scarf");
    expect(resolve("x", { festival: "tanabata", mood: "sleepy" }).mood).toBe("sleepy");
  });
});

describe("markup", () => {
  const finite = (svg: string) => {
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(svg.startsWith("<svg") && svg.endsWith("</svg>")).toBe(true);
  };
  test("every flavour in every mood renders finite geometry", () => {
    for (const flavour of FLAVOUR_NAMES) for (const mood of MOOD_NAMES) finite(avatar("probe", { flavour, mood }));
  });
  test("every charm, outfit and pattern combination renders finite geometry", () => {
    for (const charm of [...CHARM_NAMES, "none"] as const) for (const outfit of [...OUTFIT_NAMES, "none"] as const) for (const pattern of [...PATTERN_NAMES, "none"] as const)
      finite(avatar("probe", { charm, outfit, pattern }));
  });
  test("no backdrop is ever drawn", () => {
    for (const n of names.slice(0, 50)) expect(avatar(n)).not.toMatch(/<rect x="0" y="-6"|<circle cx="60" cy="54" r="60"/);
  });
  test("different looks never share element ids", () => {
    const ids = (s: string) => new Set([...s.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
    const a = ids(avatar("alice")), b = ids(avatar("bob"));
    for (const id of a) expect(b.has(id)).toBe(false);
  });
  test("title is escaped and makes the image accessible", () => {
    const svg = avatar("a", { title: `<b>"Kiko"</b>` });
    expect(svg).toContain(`role="img"`);
    expect(svg).toContain("&lt;b&gt;&quot;Kiko&quot;&lt;/b&gt;");
  });
  test("size sets width and height", () => {
    expect(avatar("a", { size: 30 })).toContain(`width="30" height="30"`);
  });
  test("uri encodes the same markup", () => {
    expect(decodeURIComponent(avatarUri("a").split(",")[1]!)).toBe(avatar("a"));
  });
  test("cached uri matches the uncached one, before and after eviction", () => {
    const first = cachedUri("keep-me", { flavour: "matcha" });
    for (let i = 0; i < 300; i++) cachedUri(`evict-${i}`);
    expect(cachedUri("keep-me", { flavour: "matcha" })).toBe(first);
    expect(first).toBe(avatarUri("keep-me", { flavour: "matcha" }));
  });
});

describe("defaults", () => {
  const plain = { charm: "none", outfit: "none", pattern: "none", mood: "calm" } as const;
  test("a bare avatar has no charm, outfit or pattern and a calm face", () => {
    for (const n of names.slice(0, 100)) expect(avatar(n)).toBe(render(resolve(n, plain)));
  });
  test("a pin replaces the default for its trait only", () => {
    for (const n of names.slice(0, 50)) {
      expect(avatar(n, { charm: "star" })).toBe(render(resolve(n, { ...plain, charm: "star" })));
      expect(avatar(n, { pattern: "shima" })).toBe(render(resolve(n, { ...plain, pattern: "shima" })));
    }
  });
  test("an undefined pin falls back to the default", () => {
    for (const n of names.slice(0, 50)) expect(avatar(n, { charm: undefined, mood: undefined })).toBe(avatar(n));
  });
});
