import type { Context } from "@earendil-works/pi-ai"

type Schema = Record<string, unknown>

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"])

const isString = (value: unknown): value is string => typeof value === "string"
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

const validType = (type: unknown): boolean =>
  isString(type)
    ? TYPES.has(type)
    : Array.isArray(type) && type.length > 0 && type.every((t) => isString(t) && TYPES.has(t))

const validPattern = (pattern: unknown): boolean => {
  if (!isString(pattern)) return false
  try {
    return new RegExp(pattern, "u") instanceof RegExp
  } catch {
    return false
  }
}

const KEEP: Record<string, (value: unknown) => boolean> = {
  type: validType,
  description: isString,
  title: isString,
  format: isString,
  pattern: validPattern,
  enum: (v) => Array.isArray(v) && v.length > 0,
  const: () => true,
  default: () => true,
  examples: Array.isArray,
  minimum: isNumber,
  maximum: isNumber,
  exclusiveMinimum: isNumber,
  exclusiveMaximum: isNumber,
  multipleOf: (v) => isNumber(v) && v > 0,
  minLength: isCount,
  maxLength: isCount,
  minItems: isCount,
  maxItems: isCount,
  minProperties: isCount,
  maxProperties: isCount,
  uniqueItems: (v) => typeof v === "boolean",
  required: (v) => Array.isArray(v) && v.every(isString),
}

const SUBSCHEMA = new Set(["additionalProperties", "items", "not", "contains", "propertyNames", "if", "then", "else"])
const SCHEMA_LISTS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"])
const SCHEMA_MAPS = new Set(["properties", "patternProperties"])

function legacyBound(out: Schema, value: Schema, flag: "exclusiveMinimum" | "exclusiveMaximum"): void {
  const bound = flag === "exclusiveMinimum" ? "minimum" : "maximum"
  if (value[flag] === true && isNumber(value[bound])) {
    out[flag] = value[bound]
    delete out[bound]
  }
}

function keyword(out: Schema, key: string, child: unknown, value: Schema): void {
  if (KEEP[key]?.(child)) out[key] = child
  else if (SUBSCHEMA.has(key) && (typeof child === "boolean" || isSchema(child))) out[key] = clean(child)
  else if (key === "items" && Array.isArray(child)) {
    out.prefixItems = child.map(clean)
    if (value.additionalItems === false || isSchema(value.additionalItems)) out.items = clean(value.additionalItems)
  } else if (SCHEMA_LISTS.has(key) && Array.isArray(child) && child.length > 0) out[key] = child.map(clean)
  else if (SCHEMA_MAPS.has(key) && isSchema(child)) out[key] = cleanMap(child)
}

function cleanMap(map: Schema): Schema {
  return Object.fromEntries(Object.entries(map).map(([name, s]) => [name, clean(s)]))
}

function clean(value: unknown): unknown {
  if (typeof value === "boolean") return value
  if (!isSchema(value)) return {}
  const out: Schema = {}
  for (const [key, child] of Object.entries(value)) keyword(out, key, child, value)
  legacyBound(out, value, "exclusiveMinimum")
  legacyBound(out, value, "exclusiveMaximum")
  return out
}

const MAX_REF_DEPTH = 6

function definitionsOf(root: Schema): Schema {
  return { ...(isSchema(root.definitions) ? root.definitions : {}), ...(isSchema(root.$defs) ? root.$defs : {}) }
}

function target(defs: Schema, ref: string): unknown {
  const name = /^#\/(?:\$defs|definitions)\/([^/]+)$/.exec(ref)?.[1]
  return name === undefined ? undefined : defs[decodeURIComponent(name).replaceAll("~1", "/").replaceAll("~0", "~")]
}

function inline(value: unknown, defs: Schema, depth: number): unknown {
  if (Array.isArray(value)) return value.map((item) => inline(item, defs, depth))
  if (!isSchema(value)) return value
  const { $ref, $defs: _defs, definitions: _definitions, ...rest } = value
  const resolved = isString($ref) && depth < MAX_REF_DEPTH ? target(defs, $ref) : undefined
  const base = isSchema(resolved) ? inline(resolved, defs, depth + 1) : {}
  const own = Object.fromEntries(Object.entries(rest).map(([key, child]) => [key, inline(child, defs, depth)]))
  return { ...(isSchema(base) ? base : {}), ...own }
}

function toolParameters(parameters: unknown): Schema {
  const root = isSchema(parameters) ? parameters : {}
  const out = clean(inline(root, definitionsOf(root), 0))
  const { allOf: _all, anyOf: _any, oneOf: _one, ...schema } = isSchema(out) ? out : {}
  return { ...schema, type: "object", properties: isSchema(schema.properties) ? schema.properties : {} }
}

const cleanTools = <T extends { parameters: unknown }>(tools: readonly T[]): T[] =>
  tools.map((tool) => ({ ...tool, parameters: toolParameters(tool.parameters) as T["parameters"] }))

export function withDraft2020Tools<C extends Context>(context: C): C {
  return {
    ...context,
    ...(context.tools?.length ? { tools: cleanTools(context.tools) } : {}),
    messages: context.messages.map((message) =>
      "toolsAdded" in message && message.toolsAdded?.length
        ? { ...message, toolsAdded: cleanTools(message.toolsAdded) }
        : message,
    ),
  }
}
