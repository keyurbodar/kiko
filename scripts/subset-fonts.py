import argparse
import hashlib
import io
import re
import subprocess
import sys
import unicodedata
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from fontTools.otlLib.builder import buildPairPosClassesSubtable
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "apps/web-solid/src/fonts"
CSS = ROOT / "apps/web-solid/src/index.css"
HTML = ROOT / "apps/web-solid/index.html"

LATIN = "0020-007E,00A0-00AC,00AE-00FF,0131,0152-0153,02BC,02C6,02DA,02DC,0304,0308,2013-2014,2018-201A,201C-201E,2022,2026,2032-2033,2039-203A,2044,20AC,2122,2191,2193,2212"
CYRILLIC = "0400-045F,0490-0491,04B0-04B1,2116"
CYRILLIC_EXT = "0462-0463,046A-046B,0472-0475,0492-0493,0496-0497,049A-049B,04A2-04A3,04AE-04AF,04B2-04B3,04B6-04B7,04BA-04BB,04C0,04CF,04D8-04D9,04E2-04E3,04E8-04E9,04EE-04EF"
VIETNAMESE = "0300-0301,0303,0309,0323,1EA0-1EF1"
LATIN_EXT_SANS = "0100-0113,0116-012B,012E-0130,0132-0137,0139-013E,0141-0148,014A-014D,0150-0151,0154-017E,018F,0192,01A0-01A1,01AF-01B0,01CD-01CE,01E4-01E9,0218-021B,0237,0259,02B9,02C7-02C8,02DD,1E20-1E21,1E80-1E85,1E9E,1EF2-1EF9,2020,20AA,20B1,20B4,20B9,20BD,A78B-A78C"
LATIN_EXT_MONO = "0100-0113,0116-012B,012E-0130,0134-0137,0139-013E,0141-0148,014A-014D,0150-0151,0154-017E,018F,0192,01A0-01A1,01AF-01B0,01CD-01CE,01E4-01E9,0218-021B,0237,0259,02B9,02C7-02C8,02DD,1E20-1E21,1E80-1E85,1E9E,1EF2-1EF9,2020,20AA,20B1,20B4,20B9,20BD,A78B-A78C"
SYMBOLS = "2500-259F"


def codepoints(ranges: str) -> frozenset[int]:
    out: set[int] = set()
    for part in ranges.split(","):
        first, _, last = part.partition("-")
        out.update(range(int(first, 16), int(last or first, 16) + 1))
    return frozenset(out)


def unicode_range(cps: set[int]) -> str:
    spans: list[tuple[int, int]] = []
    for cp in sorted(cps):
        if spans and cp == spans[-1][1] + 1:
            spans[-1] = (spans[-1][0], cp)
        else:
            spans.append((cp, cp))
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in spans)


@dataclass(frozen=True)
class Part:
    name: str
    groups: dict[str, frozenset[int]]
    preload: bool

    @property
    def cps(self) -> frozenset[int]:
        return frozenset().union(*self.groups.values())


@dataclass(frozen=True)
class Face:
    slug: str
    family: str
    url: str
    sha256: str
    features: tuple[str, ...]
    weight: tuple[int, int] | None
    today: dict[str, frozenset[int]]
    parts: tuple[Part, ...] = field(default=())


def split(today: dict[str, frozenset[int]], core: frozenset[int], preload: bool) -> tuple[Part, Part]:
    rest = {name: cps - core for name, cps in today.items() if cps - core}
    return Part("core", {"core": core}, preload), Part("extended", rest, False)


SANS_TODAY = {
    "latin": codepoints(LATIN),
    "latin-ext": codepoints(LATIN_EXT_SANS),
    "vietnamese": codepoints(VIETNAMESE),
    "cyrillic": codepoints(CYRILLIC),
    "cyrillic-ext": codepoints(CYRILLIC_EXT),
}
MONO_TODAY = {
    "latin": codepoints(LATIN),
    "latin-ext": codepoints(LATIN_EXT_MONO),
    "vietnamese": codepoints(VIETNAMESE),
    "symbols2": codepoints(SYMBOLS),
    "cyrillic": codepoints(CYRILLIC),
    "cyrillic-ext": codepoints(CYRILLIC_EXT),
}

FACES = (
    Face(
        slug="geist",
        family="Geist Variable",
        url="https://raw.githubusercontent.com/google/fonts/87a44ad3d4535f7b3a5a715a08e8944f144afd06/ofl/geist/Geist%5Bwght%5D.ttf",
        sha256="73894e0448cae90a92b6c2f8732b7bb9acb7b94c418bff559dad4a18e1de9659",
        features=("ccmp", "kern", "liga", "mark", "mkmk", "tnum"),
        weight=(400, 900),
        today=SANS_TODAY,
        parts=split(SANS_TODAY, codepoints(LATIN), preload=True),
    ),
    Face(
        slug="geist-mono",
        family="Geist Mono Variable",
        url="https://raw.githubusercontent.com/google/fonts/9e25e2ba265e5298f70f6182dd4e8a3ebf1b9123/ofl/geistmono/GeistMono%5Bwght%5D.ttf",
        sha256="d00e590b8eb3a59acc329b2d044fd143ae935090b7da33199ebee27cc7de8196",
        features=("ccmp", "mark", "mkmk"),
        weight=(400, 900),
        today=MONO_TODAY,
        parts=split(MONO_TODAY, codepoints(LATIN), preload=False),
    ),
)
SERIF = dict(
    slug="geist-serif",
    family="Geist Serif",
    url="https://raw.githubusercontent.com/vercel/geist-font/2e554ff2ea3979b63afe770af6424eb8b9490a74/fonts/GeistSerif/webfonts/GeistSerif-Regular.woff2",
    sha256="d11c9077e61bda553e2eea121409c584504319e08f972d11e0a38ed4b14de398",
    features=("ccmp", "kern", "mark", "mkmk"),
    weight=None,
)


def fetch(url: str, sha256: str, cache: Path) -> TTFont:
    path = cache / sha256
    if not path.exists():
        cache.mkdir(parents=True, exist_ok=True)
        path.write_bytes(urllib.request.urlopen(url).read())
    if hashlib.sha256(path.read_bytes()).hexdigest() != sha256:
        path.unlink()
        sys.exit(f"{url} does not match its pinned sha256")
    return TTFont(path, recalcTimestamp=False)


def serif_face(cache: Path, split_serif: bool) -> Face:
    source = fetch(SERIF["url"], SERIF["sha256"], cache)
    everything = frozenset(source.getBestCmap())
    today = {"serif": everything}
    if split_serif:
        core, extended = split(today, everything & codepoints(LATIN), preload=True)
        return Face(**SERIF, today=today, parts=(core, extended))
    return Face(**SERIF, today=today, parts=(Part("core", today, True),))


def glyph_sides(font: TTFont, groups: dict[str, frozenset[int]]) -> dict[str, str]:
    owners: dict[str, set[str]] = {}
    for cp, glyph in font.getBestCmap().items():
        for name, cps in groups.items():
            if cp in cps:
                owners.setdefault(glyph, set()).add(name)
    return {glyph: names.pop() for glyph, names in owners.items() if len(names) == 1}


def isolate_kerning(font: TTFont, groups: dict[str, frozenset[int]]) -> None:
    sides = glyph_sides(font, groups)
    crosses = lambda a, b: a in sides and b in sides and sides[a] != sides[b]
    glyph_map = font.getReverseGlyphMap()
    every = font.getGlyphOrder()
    for lookup in font["GPOS"].table.LookupList.Lookup:
        for index, holder in enumerate(lookup.SubTable):
            extension = lookup.LookupType == 9
            if (holder.ExtensionLookupType if extension else lookup.LookupType) != 2:
                continue
            table = holder.ExtSubTable if extension else holder
            if table.Format == 1:
                for first, pair_set in zip(table.Coverage.glyphs, table.PairSet):
                    pair_set.PairValueRecord = [r for r in pair_set.PairValueRecord if not crosses(first, r.SecondGlyph)]
                    pair_set.PairValueCount = len(pair_set.PairValueRecord)
                continue
            firsts: dict[tuple[int, str | None], list[str]] = {}
            for glyph in table.Coverage.glyphs:
                firsts.setdefault((table.ClassDef1.classDefs.get(glyph, 0), sides.get(glyph)), []).append(glyph)
            seconds: dict[tuple[int, str | None], list[str]] = {}
            for glyph in every:
                seconds.setdefault((table.ClassDef2.classDefs.get(glyph, 0), sides.get(glyph)), []).append(glyph)
            pairs = {}
            for (c1, s1), left in firsts.items():
                for (c2, s2), right in seconds.items():
                    if s1 and s2 and s1 != s2:
                        continue
                    record = table.Class1Record[c1].Class2Record[c2]
                    values = (getattr(record, "Value1", None), getattr(record, "Value2", None))
                    if any(v is not None and v.getEffectiveFormat() for v in values):
                        pairs[(tuple(left), tuple(right))] = values
            rebuilt = buildPairPosClassesSubtable(pairs, glyph_map, table.ValueFormat1, table.ValueFormat2)
            if extension:
                holder.ExtSubTable = rebuilt
            else:
                lookup.SubTable[index] = rebuilt


def trim_weight(original: TTFont, weight: tuple[int, int]) -> TTFont:
    axis = next(a for a in original["fvar"].axes if a.axisTag == "wght")
    if axis.defaultValue != weight[0] or axis.maxValue != weight[1]:
        sys.exit(f"{original['name'].getBestFamilyName()} no longer defaults to wght {weight[0]} with a maximum of {weight[1]}")
    heavier = lambda t: all(start >= 0 for start, _, _ in t.axes.values())
    lighter = lambda t: all(end <= 0 for _, _, end in t.axes.values())
    trimmed = instantiateVariableFont(copy(original), {"wght": weight})
    for glyph, tuples in original["gvar"].variations.items():
        if not all(heavier(t) or lighter(t) for t in tuples):
            sys.exit(f"{glyph} has a variation region that crosses the default weight")
        trimmed["gvar"].variations[glyph] = [t for t in tuples if heavier(t)]
    return copy(trimmed)


def file_name(face: Face, part: Part) -> str:
    return f"{face.slug}.woff2" if len(face.parts) == 1 else f"{face.slug}-{part.name}.woff2"


def copy(font: TTFont) -> TTFont:
    buffer = io.BytesIO()
    font.save(buffer)
    buffer.seek(0)
    return TTFont(buffer, recalcTimestamp=False)


def build(face: Face, source: TTFont, part: Part, hinting: bool) -> bytes:
    font = copy(source)
    if len(part.groups) > 1 and "GPOS" in font:
        isolate_kerning(font, part.groups)
    missing = part.cps - set(font.getBestCmap())
    if missing:
        sys.exit(f"{face.slug} {part.name} lacks {unicode_range(set(missing))}")
    options = Options()
    options.layout_features = list(face.features)
    options.hinting = hinting
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.name_languages = [0x0409]
    options.drop_tables += ["meta"]
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=part.cps)
    subsetter.subset(font)
    if "fvar" in font:
        font["fvar"].instances = []
    font.flavor = "woff2"
    out = io.BytesIO()
    font.save(out)
    return out.getvalue()


def font_face(face: Face, part: Part, cps: set[int]) -> str:
    weight = f"{face.weight[0]} {face.weight[1]}" if face.weight else "400"
    format = "woff2-variations" if face.weight else "woff2"
    return "\n".join(
        [
            "@font-face {",
            f'  font-family: "{face.family}";',
            f'  src: url("./fonts/{file_name(face, part)}") format("{format}");',
            f"  font-weight: {weight};",
            "  font-style: normal;",
            "  font-display: swap;",
            f"  unicode-range: {unicode_range(cps)};",
            "}",
        ]
    )


def replace_block(path: Path, start: str, end: str, body: str) -> None:
    text = path.read_text()
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pattern.search(text):
        sys.exit(f"{path} has no {start} … {end} block")
    path.write_text(pattern.sub(lambda _: f"{start}\n{body}\n{end}", text, count=1))


def describe(path: Path) -> str:
    font = TTFont(path)
    tags = lambda tag: ",".join(sorted({r.FeatureTag for r in font[tag].table.FeatureList.FeatureRecord})) if tag in font else "-"
    axes = " ".join(f"{a.axisTag} {a.minValue:g}-{a.maxValue:g}" for a in font["fvar"].axes) if "fvar" in font else "static"
    hints = [t for t in ("fpgm", "prep", "cvt ", "cvar", "hdmx", "VDMX", "LTSH") if t in font]
    instructed = sum(1 for name in font.getGlyphOrder() if getattr(font["glyf"][name], "program", None) and font["glyf"][name].program.getBytecode())
    return (
        f"{path.name:28} {path.stat().st_size:7} B  {font['maxp'].numGlyphs:4} glyphs  {len(font.getBestCmap()):4} chars  "
        f"{axes:12} GSUB {tags('GSUB')}  GPOS {tags('GPOS')}  hinting {','.join(hints) or 'none'}, {instructed} instructed glyphs"
    )


class Shaper:
    def __init__(self, fonts: dict[str, TTFont], weight: int | None):
        import uharfbuzz as hb

        self.hb = hb
        location = {"wght": weight} if weight else None
        self.glyph_sets = {name: font.getGlyphSet(location=location) for name, font in fonts.items()}
        self.orders = {name: font.getGlyphOrder() for name, font in fonts.items()}
        self.fonts = {}
        for name, font in fonts.items():
            plain = copy(font)
            plain.flavor = None
            buffer = io.BytesIO()
            plain.save(buffer)
            shaper = hb.Font(hb.Face(hb.Blob(buffer.getvalue())))
            if weight:
                shaper.set_variations({"wght": weight})
            self.fonts[name] = shaper
        self.keys: dict[tuple[str, int], tuple] = {}

    def outline(self, name: str, glyph: str) -> tuple:
        glyphs = self.glyph_sets[name]
        pen = DecomposingRecordingPen(glyphs)
        glyphs[glyph].draw(pen)
        return round(glyphs[glyph].width), tuple((op, tuple((round(x, 3), round(y, 3)) for x, y in args)) for op, args in pen.value)

    def glyph(self, name: str, gid: int) -> tuple:
        if (name, gid) not in self.keys:
            self.keys[(name, gid)] = self.outline(name, self.orders[name][gid])
        return self.keys[(name, gid)]

    def shape(self, text: str, faces: list[tuple[str, frozenset[int]]]) -> list:
        runs: list[list] = []
        for cluster in clusters(text):
            pick = next((i for i, (_, cps) in enumerate(faces) if all(ord(c) in cps for c in cluster)), None)
            if runs and runs[-1][0] == pick:
                runs[-1][1] += cluster
            else:
                runs.append([pick, cluster])
        out: list = []
        for pick, run in runs:
            if pick is None:
                out.append(("fallback", run))
                continue
            name = faces[pick][0]
            buffer = self.hb.Buffer()
            buffer.add_str(run)
            buffer.guess_segment_properties()
            self.hb.shape(self.fonts[name], buffer, {})
            out += [(self.glyph(name, i.codepoint), p.x_advance, p.x_offset, p.y_offset) for i, p in zip(buffer.glyph_infos, buffer.glyph_positions)]
        return out


def clusters(text: str) -> list[str]:
    out: list[str] = []
    for ch in text:
        if out and unicodedata.category(ch).startswith("M"):
            out[-1] += ch
        else:
            out.append(ch)
    return out


def slice_of(original: TTFont, cps: frozenset[int]) -> TTFont:
    options = Options()
    options.layout_features = ["*"]
    options.hinting = True
    options.drop_tables += ["meta"]
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=cps)
    font = copy(original)
    subsetter.subset(font)
    return copy(font)


def check(face: Face, original: TTFont, files: dict[str, TTFont]) -> list[str]:
    problems = [f"{face.slug} {part.name} draws other characters than intended" for part in face.parts if set(files[part.name].getBestCmap()) != part.cps]
    today = {f"today {name}": slice_of(original, cps) for name, cps in face.today.items()}
    fonts = {"source": original, **today, **files}
    reference = [(f"today {name}", cps) for name, cps in face.today.items()]
    generated = [(part.name, part.cps) for part in face.parts]
    every = sorted(cp for cps in face.today.values() for cp in cps)
    bases = [cp for cp in every if not unicodedata.category(chr(cp)).startswith("M")]
    marks = [cp for cp in every if unicodedata.category(chr(cp)).startswith("M")]
    together = lambda a, m: any(a in cps and m in cps for cps in face.today.values())
    ordered = lambda s: unicodedata.normalize("NFD", s) == "".join(unicodedata.normalize("NFD", c) for c in s)
    attached = [chr(a) + chr(m) for a in bases for m in marks if together(a, m)]
    sequences = [chr(a) + chr(b) for a in bases for b in bases] + [s for s in attached if ordered(s)]
    for weight in (400, 500, 600, 700, 800, 900) if face.weight else (None,):
        shaper = Shaper(fonts, weight)
        cmaps = {name: font.getBestCmap() for name, font in fonts.items()}
        for part in face.parts:
            drift = [cp for cp in part.cps if shaper.outline(part.name, cmaps[part.name][cp]) != shaper.outline("source", cmaps["source"][cp])]
            if drift:
                problems.append(f"{face.slug} {part.name} wght {weight}: {len(drift)} outlines differ from the source")
        if weight not in (None, 400, 600, 900):
            continue
        differ = [s for s in sequences if shaper.shape(s, reference) != shaper.shape(s, generated)]
        if differ:
            problems.append(f"{face.slug} wght {weight}: {len(differ)} of {len(sequences)} pairs shape differently: {' '.join(differ[:24])}")
    return problems


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Cut Geist, Geist Mono and Geist Serif down to what the client uses and split Geist and Geist Mono into a core "
        "and an extended file behind unicode-range. Writes apps/web-solid/src/fonts, the fonts block in index.css and the preloads "
        "in index.html, then checks every glyph and character pair against the pinned sources.",
        epilog="Run it from a throwaway venv: python3 -m venv /tmp/fontvenv && /tmp/fontvenv/bin/pip install fonttools brotli "
        "uharfbuzz && /tmp/fontvenv/bin/python scripts/subset-fonts.py",
    )
    parser.add_argument("--cache", type=Path, default=Path("/tmp/kiko-font-sources"))
    parser.add_argument("--split-serif", action="store_true", help="also split Geist Serif; changes kerning next to non-Latin-1 letters")
    parser.add_argument("--drop-hinting", action="store_true", help="also drop hinting; changes how Chromium rasterizes every glyph on Linux")
    parser.add_argument("--skip-check", action="store_true")
    args = parser.parse_args()
    faces = (*FACES, serif_face(args.cache, args.split_serif))
    FONTS.mkdir(parents=True, exist_ok=True)
    for stale in FONTS.glob("*.woff2"):
        stale.unlink()
    rules, preloads, problems = [], [], []
    for face in faces:
        original = fetch(face.url, face.sha256, args.cache)
        source = trim_weight(original, face.weight) if face.weight else original
        files = {}
        for part in reversed(face.parts):
            path = FONTS / file_name(face, part)
            path.write_bytes(build(face, source, part, not args.drop_hinting))
            files[part.name] = TTFont(path)
            rules.append(font_face(face, part, set(files[part.name].getBestCmap())))
            if part.preload:
                preloads.append(f'    <link rel="preload" href="/src/fonts/{path.name}" as="font" type="font/woff2" crossorigin />')
            print(describe(path), flush=True)
        if not args.skip_check:
            problems += check(face, original, files)
            print(f"{face.slug} checked", flush=True)
    replace_block(CSS, "/* fonts:start */", "/* fonts:end */", "\n\n".join(rules))
    replace_block(HTML, "<!-- fonts:start -->", "<!-- fonts:end -->", "\n".join(preloads))
    subprocess.run(["bunx", "oxfmt", str(CSS), str(HTML)], cwd=ROOT, check=True)
    if problems:
        sys.exit("\n".join(problems))


if __name__ == "__main__":
    main()
