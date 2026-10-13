import {
  CHARM_NAMES, CHARM_RATE, COLLECTIONS, EYE_NAMES, FESTIVALS, FLAVOUR_NAMES, FLAVOURS, LEAF_NAMES, OUTFIT_NAMES, OUTFIT_RATE,
  PATTERN_NAMES, PATTERN_RATE, SEASONS, SEKKI,
  type CharmName, type CollectionName, type EyeName, type FestivalName, type FlavourName, type LeafName, type MoodName,
  type OutfitName, type PatternName, type Season,
} from "./catalog";
import { seedState, stream } from "./hash";

export type Facing = "left" | "right";
export type Pin<T> = T | readonly T[];

export interface TraitOptions {
  flavour?: Pin<FlavourName>;
  collection?: CollectionName;
  leaf?: Pin<LeafName>;
  eye?: Pin<EyeName>;
  charm?: Pin<CharmName | "none">;
  outfit?: Pin<OutfitName | "none">;
  pattern?: Pin<PatternName | "none">;
  mood?: MoodName;
  facing?: Facing;
  blush?: boolean;
  mouth?: boolean;
  season?: number;
  sekki?: number;
  festival?: FestivalName;
  remix?: boolean;
  normalize?: boolean;
}

export interface AvatarTraits {
  flavour: FlavourName;
  leaf: LeafName;
  eye: EyeName;
  charm: CharmName | null;
  outfit: OutfitName | null;
  pattern: PatternName | null;
  mood: MoodName;
  facing: Facing;
  blush: boolean;
  mouth: boolean;
}

function choose<T>(state: number, key: string, all: readonly T[], pin: Pin<T> | undefined): T {
  if (pin !== undefined && !Array.isArray(pin)) return pin as T;
  const list = pin && (pin as readonly T[]).length ? (pin as readonly T[]) : all;
  return list[Math.floor(stream(state, key) * list.length)]!;
}
const wrap = (n: number, len: number) => (((Math.round(n) - 1) % len) + len) % len;

export function resolve(name: string, o: TraitOptions = {}): AvatarTraits {
  const st = seedState(name, o.normalize ?? true);
  const preset: (Season & { mood?: MoodName }) | undefined =
    o.festival !== undefined ? FESTIVALS[o.festival]
    : o.sekki !== undefined ? SEKKI[wrap(o.sekki, 24)]
    : o.season !== undefined ? SEASONS[wrap(o.season, 12)]
    : undefined;

  const pool = o.collection ? COLLECTIONS[o.collection] : FLAVOUR_NAMES;
  const flavour = o.flavour !== undefined ? choose(st, "flavour", FLAVOUR_NAMES, o.flavour) : preset?.flavour ?? choose(st, "flavour", pool, undefined);
  const f = FLAVOURS[flavour];

  const leaf = o.leaf !== undefined ? choose(st, "leaf", LEAF_NAMES, o.leaf) : preset?.leaf ?? (o.remix ? choose(st, "leaf", LEAF_NAMES, undefined) : f.leaf);
  const eye = o.eye !== undefined ? choose(st, "eye", EYE_NAMES, o.eye) : o.remix ? choose(st, "eye", EYE_NAMES, undefined) : f.eye;

  const optional = <T extends string>(key: string, all: readonly T[], pin: Pin<T | "none"> | undefined, fromPreset: T | undefined, rate: number, allowed = true): T | null => {
    if (pin !== undefined) { const v = choose<T | "none">(st, key, all, pin); return v === "none" ? null : (v as T); }
    if (fromPreset) return fromPreset;
    return allowed && stream(st, `${key}.on`) < rate ? choose(st, key, all, undefined) : null;
  };
  const charm = optional("charm", CHARM_NAMES, o.charm, preset?.charm, CHARM_RATE);
  const outfit = optional("outfit", OUTFIT_NAMES, o.outfit, preset?.outfit, OUTFIT_RATE, charm === null);
  const pattern = optional("pattern", PATTERN_NAMES, o.pattern, preset?.pattern, PATTERN_RATE);

  return {
    flavour, leaf, eye, charm, outfit, pattern,
    mood: o.mood ?? preset?.mood ?? "calm",
    facing: o.facing ?? (stream(st, "facing") < 0.5 ? "right" : "left"),
    blush: o.blush ?? !!f.blush,
    mouth: o.mouth ?? !!f.mouth,
  };
}
