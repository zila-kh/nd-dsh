/**
 * Minimal JSON Schema validation for benchmark result kinds.
 *
 * The schemas in `benchmarks/schema/` are the authority for what a result may
 * contain; this walks a document against one so a malformed or silently empty
 * result fails loudly instead of being aggregated into a claim. It supports the
 * subset the ND schemas use (type, const, enum, required, properties,
 * additionalProperties, items, minLength, minimum, maxLength) and rejects
 * unknown keywords rather than ignoring them.
 */
const SUPPORTED = new Set([
  '$schema', 'title', 'description', 'type', 'const', 'enum', 'required',
  'properties', 'additionalProperties', 'items', 'minLength', 'maxLength',
  'minimum', 'maximum', 'minItems', 'default', 'examples',
])

export function validateJsonSchema(document, schema, path = '$') {
  const errors = []
  visit(document, schema, path, errors)
  return errors
}

export function assertJsonSchema(document, schema, label = 'document') {
  const errors = validateJsonSchema(document, schema)
  if (errors.length) throw new Error(`${label} does not satisfy its schema:\n- ` + errors.join('\n- '))
}

function visit(value, schema, path, errors) {
  if (!schema || typeof schema !== 'object') return
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED.has(keyword)) errors.push(`${path}: schema uses unsupported keyword "${keyword}"`)
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected ${JSON.stringify(schema.const)}, received ${describe(value)}`)
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`)
  }
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path}: expected ${String(schema.type)}, received ${describe(value)}`)
    return
  }
  if (schema.type === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than minLength ${schema.minLength}`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than maxLength ${schema.maxLength}`)
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`)
  }
  if (schema.type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than minItems ${schema.minItems}`)
    for (const [index, item] of value.entries()) {
      if (schema.items) visit(item, schema.items, `${path}[${index}]`, errors)
    }
  }
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) errors.push(`${path}: missing required property "${key}"`)
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key]
      if (childSchema) visit(child, childSchema, `${path}.${key}`, errors)
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${key}"`)
    }
  }
}

function matchesType(value, type) {
  if (Array.isArray(type)) return type.some((entry) => matchesType(value, entry))
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'null') return value === null
  return typeof value === type
}

function describe(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `array(${value.length})`
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') return `string(${JSON.stringify(value.slice(0, 40))})`
  return `${typeof value}(${String(value)})`
}
