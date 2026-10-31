import json
import sys
import zipfile
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

MIMETYPE = "application/vnd.oasis.opendocument.spreadsheet"
OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
DRAW = "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
CHART = "urn:oasis:names:tc:opendocument:xmlns:chart:1.0"
SVG = "urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
XLINK = "http://www.w3.org/1999/xlink"
MANIFEST = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
OF = "urn:oasis:names:tc:opendocument:xmlns:of:1.2"

NAMESPACES = {
    "office": OFFICE,
    "table": TABLE,
    "text": TEXT,
    "draw": DRAW,
    "chart": CHART,
    "svg": SVG,
    "xlink": XLINK,
    "manifest": MANIFEST,
    "of": OF,
}
for prefix, uri in NAMESPACES.items():
    ET.register_namespace(prefix, uri)

DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n'
FIXED_TIME = (1980, 1, 1, 0, 0, 0)


def qname(prefix, name):
    return f"{{{NAMESPACES[prefix]}}}{name}"


def cell_xml(value, chart_index):
    if value is None:
        return f'<table:table-cell xmlns:table="{TABLE}"/>'
    if isinstance(value, dict) and "chart" in value:
        chart = value["chart"]
        width = escape(str(chart.get("width", "8cm")))
        height = escape(str(chart.get("height", "6cm")))
        return (
            f'<table:table-cell xmlns:table="{TABLE}" xmlns:draw="{DRAW}" xmlns:svg="{SVG}" '
            f'xmlns:xlink="{XLINK}"><draw:frame draw:name="Chart {chart_index}" svg:width="{width}" '
            f'svg:height="{height}"><draw:object xlink:href="./Object {chart_index}" '
            f'xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></table:table-cell>'
        )
    if isinstance(value, dict) and "formula" in value:
        formula = escape(str(value["formula"]))
        number = value.get("value", 0)
        shown = escape(str(number))
        return (
            f'<table:table-cell xmlns:table="{TABLE}" xmlns:office="{OFFICE}" '
            f'table:formula="{formula}" office:value-type="float" office:value="{number}">'
            f"<text:p>{shown}</text:p></table:table-cell>"
        )
    if isinstance(value, bool):
        shown = "TRUE" if value else "FALSE"
        return (
            f'<table:table-cell xmlns:office="{OFFICE}" office:value-type="boolean" '
            f'office:boolean-value="{shown.lower()}"><text:p>{shown}</text:p></table:table-cell>'
        )
    if isinstance(value, (int, float)):
        return (
            f'<table:table-cell xmlns:office="{OFFICE}" office:value-type="float" '
            f'office:value="{value}"><text:p>{value}</text:p></table:table-cell>'
        )
    return (
        f'<table:table-cell xmlns:office="{OFFICE}" office:value-type="string">'
        f"<text:p>{escape(str(value))}</text:p></table:table-cell>"
    )


def sheet_xml(sheet, chart_start):
    name = escape(str(sheet["name"]))
    width = max((len(row) for row in sheet["rows"]), default=1)
    parts = [f'<table:table table:name="{name}">']
    parts.append(f'<table:table-column table:number-columns-repeated="{max(width, 1)}"/>')
    chart_index = chart_start
    for row in sheet["rows"]:
        parts.append("<table:table-row>")
        for value in row:
            parts.append(cell_xml(value, chart_index))
            if isinstance(value, dict) and "chart" in value:
                chart_index += 1
        parts.append("</table:table-row>")
    parts.append("</table:table>")
    return "".join(parts), chart_index


def chart_content(chart):
    title = escape(str(chart.get("title", "Chart")))
    kind = escape(str(chart.get("class", "chart:bar")))
    series = escape(str(chart.get("range", "")))
    return (
        DECLARATION
        + f'<office:document-content xmlns:office="{OFFICE}" xmlns:chart="{CHART}" '
        f'xmlns:text="{TEXT}" xmlns:table="{TABLE}" xmlns:svg="{SVG}" office:version="1.2">'
        f'<office:body><office:chart><chart:chart chart:class="{kind}">'
        f"<chart:title><text:p>{title}</text:p></chart:title>"
        f'<chart:plot-area><chart:series chart:values-cell-range-address="{series}"/>'
        f"</chart:plot-area></chart:chart></office:chart></office:body></office:document-content>"
    )


def content_xml(spec):
    sheets = []
    chart_index = 1
    charts = []
    for sheet in spec["sheets"]:
        xml, chart_index = sheet_xml(sheet, chart_index)
        sheets.append(xml)
    for sheet in spec["sheets"]:
        for row in sheet["rows"]:
            for value in row:
                if isinstance(value, dict) and "chart" in value:
                    charts.append(value["chart"])
    body = (
        DECLARATION
        + f'<office:document-content xmlns:office="{OFFICE}" xmlns:table="{TABLE}" '
        f'xmlns:text="{TEXT}" xmlns:draw="{DRAW}" xmlns:svg="{SVG}" xmlns:xlink="{XLINK}" '
        f'xmlns:of="{OF}" office:version="1.2"><office:body><office:spreadsheet>'
        + "".join(sheets)
        + "</office:spreadsheet></office:body></office:document-content>"
    )
    return body, charts


def manifest_xml(chart_count):
    entries = [
        f'<manifest:file-entry manifest:full-path="/" manifest:media-type="{MIMETYPE}"/>',
        '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>',
    ]
    for index in range(1, chart_count + 1):
        entries.append(
            f'<manifest:file-entry manifest:full-path="Object {index}/" '
            'manifest:media-type="application/vnd.oasis.opendocument.chart"/>'
        )
        entries.append(
            f'<manifest:file-entry manifest:full-path="Object {index}/content.xml" '
            'manifest:media-type="text/xml"/>'
        )
    return (
        DECLARATION
        + f'<manifest:manifest xmlns:manifest="{MANIFEST}" manifest:version="1.2">'
        + "".join(entries)
        + "</manifest:manifest>"
    )


def write_entry(archive, name, data, compress):
    info = zipfile.ZipInfo(name, date_time=FIXED_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED
    archive.writestr(info, data)


def build(spec_path, out_path):
    with open(spec_path, encoding="utf-8") as handle:
        spec = json.load(handle)
    body, charts = content_xml(spec)
    with zipfile.ZipFile(out_path, "w") as archive:
        write_entry(archive, "mimetype", MIMETYPE, False)
        write_entry(archive, "content.xml", body, True)
        for index, chart in enumerate(charts, start=1):
            write_entry(archive, f"Object {index}/content.xml", chart_content(chart), True)
        write_entry(archive, "META-INF/manifest.xml", manifest_xml(len(charts)), True)


def cell_value(cell):
    value_type = cell.get(qname("office", "value-type"))
    text = "".join("".join(paragraph.itertext()) for paragraph in cell.findall(qname("text", "p")))
    out = {"text": text}
    if value_type:
        out["type"] = value_type
    for key, attribute in (
        ("value", "value"),
        ("boolean", "boolean-value"),
        ("date", "date-value"),
        ("string", "string-value"),
    ):
        raw = cell.get(qname("office", attribute))
        if raw is not None:
            out[key] = raw
    formula = cell.get(qname("table", "formula"))
    if formula:
        out["formula"] = formula
    if not text and value_type is None and formula is None:
        return None
    return out


def repeat(attribute, element, prefix="table"):
    raw = element.get(qname(prefix, attribute))
    return int(raw) if raw else 1


def row_cells(row):
    cells = []
    for cell in row:
        tag = cell.tag.split("}")[-1]
        if tag not in ("table-cell", "covered-table-cell"):
            continue
        count = repeat("number-columns-repeated", cell)
        value = cell_value(cell) if tag == "table-cell" else None
        for _ in range(min(count, 128)):
            cells.append(value)
    while cells and cells[-1] is None:
        cells.pop()
    return cells


def read(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("content.xml"))
        names = set(archive.namelist())
    sheets = []
    for table in root.iter(qname("table", "table")):
        rows = []
        for row in table.findall(qname("table", "table-row")):
            cells = row_cells(row)
            count = repeat("number-rows-repeated", row)
            if count > 1024 and not any(cells):
                continue
            for _ in range(min(count, 1024)):
                rows.append(cells)
        while rows and not rows[-1]:
            rows.pop()
        sheets.append({"name": table.get(qname("table", "name")), "rows": rows})
    charts = 0
    for name in names:
        if name.startswith("Object ") and name.endswith("/content.xml"):
            if b"chart:chart" in zipfile.ZipFile(path).read(name):
                charts += 1
    return {"sheets": sheets, "charts": charts}


def main(argv):
    if len(argv) >= 4 and argv[1] == "build":
        build(argv[2], argv[3])
        return
    if len(argv) >= 3 and argv[1] == "read":
        print(json.dumps(read(argv[2])))
        return
    raise SystemExit("usage: ods.py build <spec.json> <out.ods> | ods.py read <file.ods>")


if __name__ == "__main__":
    main(sys.argv)
