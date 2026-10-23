import type { Context } from "@earendil-works/pi-ai"

type Schema = Record<string, unknown>

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const SCHEMA_LISTS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"])
const SCHEMA_MAPS = new Set(["properties", "patternProperties", "$defs", "dependentSchemas"])

const DROPPED = new Set(["$schema", "additionalItems", "definitions", "dependencies"])
const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"])

const validType = (type: unknown): boolean =>
  typeof type === "string" ? TYPES.has(type) : Array.isArray(type) && type.length > 0 && type.every(validType)

const convertMap = (map: Schema): Schema =>
  Object.fromEntries(Object.entries(map).map(([name, s]) => [name, convert(s)]))

function convertEntry(out: Schema, key: string, child: unknown, parent: Schema): void {
  if (DROPPED.has(key)) return
  if (key === "required" && !Array.isArray(child)) return
  if (key === "type" && !validType(child)) return
  if (key === "$ref" && typeof child === "string") out.$ref = child.replace("#/definitions/", "#/$defs/")
  else if (SCHEMA_MAPS.has(key) && isSchema(child)) out[key] = convertMap(child)
  else if (SCHEMA_LISTS.has(key) && Array.isArray(child)) out[key] = child.map(convert)
  else if (key === "items" && Array.isArray(child)) {
    out.prefixItems = child.map(convert)
    const rest = parent.additionalItems
    if (rest === false || isSchema(rest)) out.items = convert(rest)
  } else out[key] = convert(child)
}

function exclusiveBound(out: Schema, parent: Schema, flag: "exclusiveMinimum" | "exclusiveMaximum"): void {
  if (typeof parent[flag] !== "boolean") return
  delete out[flag]
  const bound = flag === "exclusiveMinimum" ? "minimum" : "maximum"
  if (parent[flag] && typeof parent[bound] === "number") {
    out[flag] = parent[bound]
    delete out[bound]
  }
}

function convert(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(convert)
  if (!isSchema(value)) return value
  const out: Schema = {}
  for (const [key, child] of Object.entries(value)) convertEntry(out, key, child, value)
  if (isSchema(value.definitions)) out.$defs = convertMap(value.definitions)
  exclusiveBound(out, value, "exclusiveMinimum")
  exclusiveBound(out, value, "exclusiveMaximum")
  return out
}

export function withDraft2020Tools<C extends Context>(context: C): C {
  if (!context.tools?.length) return context
  return {
    ...context,
    tools: context.tools.map((tool) => ({ ...tool, parameters: convert(tool.parameters) as typeof tool.parameters })),
  }
}
