const SVG_NS = "http://www.w3.org/2000/svg"

const templates = new Map<string, SVGSVGElement>()

export function glyphNodes(markup: string): Node[] {
  let template = templates.get(markup)
  if (template === undefined) {
    template = document.createElementNS(SVG_NS, "svg")
    template.innerHTML = markup
    templates.set(markup, template)
  }
  return Array.from(template.childNodes, (child) => child.cloneNode(true))
}
