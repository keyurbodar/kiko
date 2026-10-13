export const FLAVOUR_NAMES = [
  "hatsuyuki", "sakura", "ume", "momo", "matcha", "ichigo", "kinako", "hojicha",
  "yuzu", "ramune", "ajisai", "suika", "tsukimi", "momiji", "ginkgo", "goma",
  "yomogi", "azuki", "kuri", "fuji", "mikan", "kohi", "anzu", "shio",
  "melon", "budo", "purin", "kabocha", "remon", "chocomint", "sora", "usuzumi",
  "ringo", "sakuranbo", "mango", "beniimo", "genmai", "kuromitsu", "nashi", "yukimi",
] as const;
export const LEAF_NAMES = ["camellia", "nandina", "bamboo", "pine", "sakura", "ume", "momiji", "ginkgo", "susuki"] as const;
export const EYE_NAMES = ["nanten", "kuromame", "kohaku", "blueberry", "ume", "ice"] as const;
export const CHARM_NAMES = [
  "camellia", "sprig", "hydrangea", "mizuhiki", "suzu", "beret", "glasses", "headphones", "snowflake", "mikan",
  "ribbon", "star", "moon", "kanzashi", "omamori", "cherries", "sprout", "clover", "bandage",
] as const;
export const OUTFIT_NAMES = ["scarf", "hachimaki", "obi", "bib", "bowtie", "kerchief"] as const;
export const PATTERN_NAMES = ["mizutama", "shima", "dipped", "leafwrap", "sprinkles", "frost", "heart"] as const;
export const MOOD_NAMES = ["calm", "happy", "wink", "curious", "thinking", "surprised", "shy", "love", "sleepy", "excited", "laugh", "sad", "pouty", "dizzy"] as const;

export type FlavourName = (typeof FLAVOUR_NAMES)[number];
export type LeafName = (typeof LEAF_NAMES)[number];
export type EyeName = (typeof EYE_NAMES)[number];
export type CharmName = (typeof CHARM_NAMES)[number];
export type MoodName = (typeof MOOD_NAMES)[number];
export type OutfitName = (typeof OUTFIT_NAMES)[number];
export type PatternName = (typeof PATTERN_NAMES)[number];

export type Topping =
  | { kind: "cap"; color: string }
  | { kind: "dust"; color: string }
  | { kind: "petals" }
  | { kind: "bubbles" }
  | { kind: "beans" }
  | { kind: "seeds" }
  | { kind: "sparkles"; color: string };

export interface Flavour {
  label: string;
  note: string;
  body: string;
  shade: string;
  grain: string;
  accent?: string;
  leaf: LeafName;
  eye: EyeName;
  leafColor?: readonly [fill: string, vein: string];
  blush?: boolean;
  mouth?: boolean;
  toppings?: readonly Topping[];
}

export const FLAVOURS: Record<FlavourName, Flavour> = {
  hatsuyuki: { label: "Hatsuyuki", note: "first snow", body: "#FBFBF9", shade: "#CFDAE8", grain: "#B7C6D8", leaf: "camellia", eye: "nanten" },
  sakura: { label: "Sakura", note: "spring snow", body: "#FFF5F6", shade: "#EDD3D8", grain: "#DDB5BE", leaf: "sakura", eye: "ume", blush: true, toppings: [{ kind: "petals" }] },
  ume: { label: "Ume", note: "plum blossom", body: "#FFF9F7", shade: "#EADADD", grain: "#D9BEC4", leaf: "ume", eye: "ume", blush: true },
  momo: { label: "Momo", note: "white peach", body: "#FFEFE8", shade: "#F1D3C7", grain: "#E2B4A4", leaf: "nandina", leafColor: ["#78A653", "#B9D98F"], eye: "nanten", blush: true },
  matcha: { label: "Matcha", note: "kakigōri", body: "#F4F6EE", shade: "#C9D6B4", grain: "#A9BC8A", leaf: "bamboo", eye: "kuromame", toppings: [{ kind: "cap", color: "#8EAB57" }, { kind: "beans" }] },
  ichigo: { label: "Ichigo", note: "daifuku", body: "#FCF4F2", shade: "#EBCFD2", grain: "#D8AEB4", leaf: "camellia", eye: "kuromame", blush: true, toppings: [{ kind: "cap", color: "#E36B7E" }] },
  kinako: { label: "Kinako", note: "roasted soy", body: "#F8F1E4", shade: "#E1D2B8", grain: "#C9B28E", leaf: "nandina", eye: "kuromame", toppings: [{ kind: "dust", color: "#B98D4E" }] },
  hojicha: { label: "Hojicha", note: "roasted tea", body: "#ECDCC6", shade: "#CDB592", grain: "#B49A76", leaf: "camellia", eye: "kuromame", blush: true },
  yuzu: { label: "Yuzu", note: "citrus snow", body: "#FFF9EA", shade: "#EEE2BE", grain: "#DCC991", leaf: "camellia", leafColor: ["#3F7A44", "#82B87D"], eye: "kohaku", toppings: [{ kind: "cap", color: "#F2C24C" }] },
  ramune: { label: "Ramune", note: "soda ice", body: "#E8F5FB", shade: "#B4D6E8", grain: "#8DBBD4", leaf: "nandina", eye: "ice", toppings: [{ kind: "bubbles" }] },
  ajisai: { label: "Ajisai", note: "hydrangea rain", body: "#F2F3FB", shade: "#D2D6EE", grain: "#B3B9DE", leaf: "camellia", leafColor: ["#4E7C55", "#8DBA8A"], eye: "blueberry" },
  suika: { label: "Suika", note: "watermelon ice", body: "#FDF6F4", shade: "#EED3D3", grain: "#DDB2B4", leaf: "nandina", eye: "kuromame", toppings: [{ kind: "cap", color: "#E8505F" }, { kind: "seeds" }] },
  tsukimi: { label: "Tsukimi", note: "moon viewing", body: "#FBF6EA", shade: "#E8DEC6", grain: "#D4C59F", leaf: "susuki", eye: "kohaku" },
  momiji: { label: "Momiji", note: "autumn maple", body: "#FCF9F4", shade: "#E3D7CA", grain: "#CDBBA7", leaf: "momiji", eye: "kohaku" },
  ginkgo: { label: "Ginkgo", note: "late autumn", body: "#FBF8EE", shade: "#E2DABF", grain: "#CBBF97", leaf: "ginkgo", eye: "kohaku", mouth: true },
  goma: { label: "Goma", note: "black sesame", body: "#F7F6F3", shade: "#DCDCE0", grain: "#BDBDC4", leaf: "nandina", eye: "kuromame", toppings: [{ kind: "dust", color: "#3A3436" }] },
  yomogi: { label: "Yomogi", note: "mugwort mochi", body: "#E6EDD6", shade: "#C3D0AA", grain: "#A3B585", leaf: "bamboo", eye: "kuromame", toppings: [{ kind: "beans" }] },
  azuki: { label: "Azuki", note: "red bean", body: "#FBF4F1", shade: "#E8D2D2", grain: "#D2B0B2", leaf: "camellia", eye: "nanten", toppings: [{ kind: "cap", color: "#8E3B46" }, { kind: "beans" }] },
  kuri: { label: "Kuri", note: "chestnut mont blanc", body: "#FAF3E8", shade: "#E5D3BB", grain: "#CDB394", leaf: "nandina", eye: "kohaku", mouth: true, toppings: [{ kind: "cap", color: "#B07A4B" }] },
  fuji: { label: "Fuji", note: "wisteria", body: "#F7F3FC", shade: "#DCD3EE", grain: "#C4B8E0", leaf: "ume", leafColor: ["#B9A3DE", "#E6DCF6"], eye: "ume", blush: true },
  mikan: { label: "Mikan", note: "winter orange", body: "#FFF8EE", shade: "#EEDCC4", grain: "#DCC19E", leaf: "camellia", eye: "kohaku", toppings: [{ kind: "cap", color: "#F29B45" }] },
  kohi: { label: "Kōhī", note: "coffee jelly", body: "#FAF6F0", shade: "#E2D6C6", grain: "#C8B7A0", leaf: "nandina", eye: "kohaku", toppings: [{ kind: "cap", color: "#5A3B2E" }] },
  anzu: { label: "Anzu", note: "apricot", body: "#FFF1E3", shade: "#F2D2B4", grain: "#E4B98F", leaf: "nandina", leafColor: ["#78A653", "#B9D98F"], eye: "nanten", blush: true },
  melon: { label: "Melon", note: "melon soda", body: "#EEF7E6", shade: "#C6DDB2", grain: "#A6C98C", leaf: "bamboo", eye: "kuromame", toppings: [{ kind: "cap", color: "#93C866" }] },
  budo: { label: "Budō", note: "grape ice", body: "#F6F1FA", shade: "#DACDEA", grain: "#BFADD9", leaf: "camellia", eye: "blueberry", accent: "#8C5BB0", toppings: [{ kind: "cap", color: "#8C5BB0" }] },
  purin: { label: "Purin", note: "caramel pudding", body: "#FBE9B6", shade: "#E9CD86", grain: "#D6B565", leaf: "nandina", eye: "kuromame", mouth: true, toppings: [{ kind: "cap", color: "#8A4E25" }] },
  kabocha: { label: "Kabocha", note: "pumpkin", body: "#F6D7A4", shade: "#E2B776", grain: "#CC9B55", leaf: "camellia", leafColor: ["#4E7A3A", "#8DB36A"], eye: "kuromame", blush: true },
  remon: { label: "Remon", note: "lemon ice", body: "#FFFBE4", shade: "#EFE6AE", grain: "#DDD089", leaf: "nandina", eye: "kohaku", toppings: [{ kind: "cap", color: "#F5DA55" }] },
  chocomint: { label: "Choco mint", note: "mint chip", body: "#E2F3EA", shade: "#B6DAC7", grain: "#93C3AC", leaf: "nandina", eye: "kuromame", accent: "#4A2F25", toppings: [{ kind: "dust", color: "#4A2F25" }] },
  sora: { label: "Sora", note: "clear sky", body: "#EAF3FC", shade: "#BCD2EC", grain: "#9AB7DA", leaf: "bamboo", eye: "blueberry", toppings: [{ kind: "sparkles", color: "#8FB8E4" }] },
  usuzumi: { label: "Usuzumi", note: "pale ink", body: "#ECECEF", shade: "#C7C8CF", grain: "#A8A9B3", leaf: "pine", eye: "kuromame", mouth: true },
  ringo: { label: "Ringo", note: "candy apple", body: "#FFF4F1", shade: "#EED2D0", grain: "#DCAFAE", leaf: "camellia", eye: "kuromame", blush: true, accent: "#D9434E", toppings: [{ kind: "cap", color: "#D9434E" }] },
  sakuranbo: { label: "Sakuranbo", note: "cherry", body: "#FFF0F2", shade: "#F0CDD3", grain: "#DFAAB4", leaf: "nandina", eye: "nanten", blush: true, accent: "#D23A50" },
  mango: { label: "Mango", note: "mango ice", body: "#FFEBBE", shade: "#F2C97E", grain: "#E3AE5E", leaf: "nandina", leafColor: ["#4F8A44", "#8FC27A"], eye: "kohaku", toppings: [{ kind: "cap", color: "#F4A02E" }] },
  beniimo: { label: "Beni-imo", note: "purple sweet potato", body: "#ECE1F3", shade: "#CDB9E0", grain: "#AE96CC", leaf: "camellia", eye: "kuromame", accent: "#7A4E9C" },
  genmai: { label: "Genmai", note: "roasted rice tea", body: "#F2ECD5", shade: "#D8CDA6", grain: "#C2B484", leaf: "bamboo", eye: "kuromame", toppings: [{ kind: "dust", color: "#9C7B4A" }] },
  kuromitsu: { label: "Kuromitsu", note: "brown sugar syrup", body: "#FBF5EC", shade: "#E4D6C3", grain: "#CBB79E", leaf: "nandina", eye: "kohaku", toppings: [{ kind: "cap", color: "#3E2A20" }] },
  nashi: { label: "Nashi", note: "asian pear", body: "#FBF8E6", shade: "#E6E0B6", grain: "#D2C98E", leaf: "camellia", leafColor: ["#5E8F3A", "#9CC56E"], eye: "kohaku", toppings: [{ kind: "dust", color: "#C4B276" }] },
  yukimi: { label: "Yukimi", note: "snow daifuku", body: "#FFFFFF", shade: "#D8E2EE", grain: "#C0CFE0", leaf: "ume", eye: "kuromame", blush: true, toppings: [{ kind: "sparkles", color: "#AFC6E3" }] },
  shio: { label: "Shio", note: "sea salt", body: "#F4F8FA", shade: "#C9D8E2", grain: "#A9BCC9", leaf: "bamboo", eye: "ice", toppings: [{ kind: "sparkles", color: "#8DBCD6" }] },
};

export interface Season {
  label: string;
  flavour: FlavourName;
  leaf?: LeafName;
  charm?: CharmName;
  outfit?: OutfitName;
  pattern?: PatternName;
}

export const SEASONS: readonly Season[] = [
  { label: "Shōgatsu", flavour: "hatsuyuki", leaf: "pine", charm: "mikan" },
  { label: "Ume", flavour: "ume" },
  { label: "Hina", flavour: "momo", charm: "mizuhiki", outfit: "obi" },
  { label: "Sakura", flavour: "sakura" },
  { label: "Shincha", flavour: "matcha" },
  { label: "Ajisai", flavour: "ajisai", charm: "hydrangea" },
  { label: "Ramune", flavour: "ramune" },
  { label: "Suika", flavour: "suika" },
  { label: "Tsukimi", flavour: "tsukimi" },
  { label: "Momiji", flavour: "momiji", outfit: "scarf" },
  { label: "Ginkgo", flavour: "ginkgo", charm: "beret" },
  { label: "Hatsuyuki", flavour: "hatsuyuki", charm: "suzu" },
];

export const SEKKI: readonly (Season & { kanji: string; date: string })[] = [
  { label: "Risshun", kanji: "立春", date: "Feb 4", flavour: "ume" },
  { label: "Usui", kanji: "雨水", date: "Feb 19", flavour: "sora" },
  { label: "Keichitsu", kanji: "啓蟄", date: "Mar 5", flavour: "yomogi", charm: "sprout" },
  { label: "Shunbun", kanji: "春分", date: "Mar 20", flavour: "momo", charm: "sprig" },
  { label: "Seimei", kanji: "清明", date: "Apr 4", flavour: "sakura", charm: "ribbon" },
  { label: "Kokuu", kanji: "穀雨", date: "Apr 20", flavour: "matcha", charm: "clover" },
  { label: "Rikka", kanji: "立夏", date: "May 5", flavour: "yomogi", outfit: "hachimaki" },
  { label: "Shōman", kanji: "小満", date: "May 21", flavour: "sakuranbo", charm: "cherries" },
  { label: "Bōshu", kanji: "芒種", date: "Jun 5", flavour: "ajisai", charm: "hydrangea" },
  { label: "Geshi", kanji: "夏至", date: "Jun 21", flavour: "remon", pattern: "sprinkles" },
  { label: "Shōsho", kanji: "小暑", date: "Jul 7", flavour: "ramune", charm: "star" },
  { label: "Taisho", kanji: "大暑", date: "Jul 23", flavour: "suika", pattern: "shima" },
  { label: "Risshū", kanji: "立秋", date: "Aug 7", flavour: "mango" },
  { label: "Shosho", kanji: "処暑", date: "Aug 23", flavour: "nashi" },
  { label: "Hakuro", kanji: "白露", date: "Sep 7", flavour: "sora", pattern: "frost" },
  { label: "Shūbun", kanji: "秋分", date: "Sep 23", flavour: "tsukimi", charm: "moon" },
  { label: "Kanro", kanji: "寒露", date: "Oct 8", flavour: "kuri" },
  { label: "Sōkō", kanji: "霜降", date: "Oct 23", flavour: "momiji", outfit: "scarf" },
  { label: "Rittō", kanji: "立冬", date: "Nov 7", flavour: "beniimo", charm: "beret" },
  { label: "Shōsetsu", kanji: "小雪", date: "Nov 22", flavour: "usuzumi", charm: "snowflake" },
  { label: "Taisetsu", kanji: "大雪", date: "Dec 7", flavour: "hatsuyuki", outfit: "kerchief" },
  { label: "Tōji", kanji: "冬至", date: "Dec 22", flavour: "yuzu" },
  { label: "Shōkan", kanji: "小寒", date: "Jan 5", flavour: "azuki", outfit: "obi" },
  { label: "Daikan", kanji: "大寒", date: "Jan 20", flavour: "kuromitsu", outfit: "bib" },
];

export interface Festival extends Season {
  date: string;
  mood?: (typeof MOOD_NAMES)[number];
}

export const FESTIVALS = {
  shogatsu: { label: "Shōgatsu", date: "Jan 1", flavour: "hatsuyuki", leaf: "pine", charm: "mikan" },
  setsubun: { label: "Setsubun", date: "Feb 3", flavour: "azuki", charm: "omamori", mood: "pouty" },
  hinamatsuri: { label: "Hinamatsuri", date: "Mar 3", flavour: "momo", charm: "mizuhiki", outfit: "obi" },
  hanami: { label: "Hanami", date: "Apr", flavour: "sakura", charm: "ribbon", pattern: "mizutama", mood: "happy" },
  kodomo: { label: "Kodomo no hi", date: "May 5", flavour: "yomogi", outfit: "hachimaki", mood: "excited" },
  tsuyu: { label: "Tsuyu", date: "Jun", flavour: "ajisai", charm: "hydrangea", mood: "sad" },
  tanabata: { label: "Tanabata", date: "Jul 7", flavour: "ramune", charm: "star", mood: "love" },
  natsumatsuri: { label: "Natsu matsuri", date: "Aug", flavour: "suika", charm: "kanzashi", pattern: "shima", mood: "laugh" },
  tsukimi: { label: "Tsukimi", date: "Sep", flavour: "tsukimi", charm: "moon", mood: "calm" },
  momijigari: { label: "Momijigari", date: "Nov", flavour: "momiji", outfit: "scarf" },
  christmas: { label: "Kurisumasu", date: "Dec 25", flavour: "ichigo", outfit: "bowtie", pattern: "frost", mood: "love" },
  omisoka: { label: "Ōmisoka", date: "Dec 31", flavour: "hojicha", charm: "suzu", mood: "sleepy" },
} as const satisfies Record<string, Festival>;
export type FestivalName = keyof typeof FESTIVALS;
export const FESTIVAL_NAMES = Object.keys(FESTIVALS) as FestivalName[];

export const COLLECTIONS = {
  wagashi: ["sakura", "ume", "ichigo", "kinako", "yomogi", "azuki", "kuri", "goma", "momo", "yukimi", "kuromitsu"],
  kakigori: ["matcha", "ichigo", "ramune", "suika", "melon", "remon", "budo", "mikan"],
  cafe: ["hojicha", "kohi", "purin", "chocomint", "matcha", "kuri", "kinako", "genmai"],
  fruit: ["momo", "yuzu", "mikan", "anzu", "suika", "budo", "remon", "melon", "ringo", "sakuranbo", "mango", "nashi"],
  spring: ["sakura", "ume", "yomogi", "momo", "fuji"],
  summer: ["ramune", "suika", "melon", "ajisai", "remon", "sora"],
  autumn: ["momiji", "ginkgo", "kuri", "kabocha", "tsukimi", "purin", "beniimo", "nashi"],
  winter: ["hatsuyuki", "mikan", "azuki", "shio", "goma", "usuzumi", "yuzu", "yukimi"],
  pastel: ["sakura", "fuji", "sora", "ramune", "momo", "melon", "remon", "ume"],
} as const satisfies Record<string, readonly FlavourName[]>;
export type CollectionName = keyof typeof COLLECTIONS;
export const COLLECTION_NAMES = Object.keys(COLLECTIONS) as CollectionName[];

export const CHARM_RATE = 0.35;
export const OUTFIT_RATE = 0.3;
export const PATTERN_RATE = 0.3;
