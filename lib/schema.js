/** Product routing/config schemas. YAML syntax is owned by the private adapter. */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function object(value, at) {
  if (Object.prototype.toString.call(value) !== '[object Object]') throw new TypeError(`${at} must be a mapping`)
  return value
}
function keys(value, allowed, at) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError(`${at} has an unknown field; expected ${allowed.join(', ')}`)
}
function name(value, at) {
  if (typeof value !== 'string' || !NAME.test(value)) throw new TypeError(`${at} must be a nonempty kebab-case name`)
  return value
}
function names(value, at) {
  if (!Array.isArray(value)) throw new TypeError(`${at} must be an array of names`)
  value.forEach(item => name(item, at))
  if (new Set(value).size !== value.length) throw new TypeError(`${at} must not contain duplicate names`)
  return value
}

export function validatePacksTable(raw) {
  const table = object(raw, 'pack table')
  keys(table, ['packs', 'alwaysOn', 'projectPrivate'], 'pack table')
  const packs = object(table.packs === undefined ? {} : table.packs, 'packs')
  const membership = new Map()
  const claim = (skill, pack) => {
    if (membership.has(skill) && membership.get(skill) !== pack) throw new TypeError('A skill must not belong to multiple packs')
    membership.set(skill, pack)
  }
  for (const [pack, spec] of Object.entries(packs)) {
    name(pack, 'pack name')
    object(spec, 'pack definition')
    keys(spec, ['alwaysOn', 'catalog', 'members'], 'pack definition')
    if (spec.alwaysOn !== undefined && typeof spec.alwaysOn !== 'boolean') throw new TypeError('alwaysOn must be a boolean')
    const catalog = name(spec.catalog, 'pack catalog')
    if (!['independent', 'named-load'].includes(catalog)) claim(catalog, pack)
    for (const member of names(spec.members === undefined ? [] : spec.members, 'pack members')) claim(member, pack)
  }
  for (const pack of names(table.alwaysOn === undefined ? [] : table.alwaysOn, 'alwaysOn')) {
    if (!Object.hasOwn(packs, pack)) throw new TypeError('alwaysOn references an undefined pack')
  }
  for (const [skill, spec] of Object.entries(object(table.projectPrivate === undefined ? {} : table.projectPrivate, 'projectPrivate'))) {
    name(skill, 'project-private skill name')
    object(spec, 'project-private definition')
    keys(spec, ['home', 'enablingPack'], 'project-private definition')
    if (typeof spec.home !== 'string' || !spec.home.startsWith('/') || spec.home.includes('\0')) throw new TypeError('project-private home must be an absolute path')
    if (spec.enablingPack !== undefined && !Object.hasOwn(packs, name(spec.enablingPack, 'enablingPack'))) throw new TypeError('enablingPack references an undefined pack')
  }
  return table
}

export function enabledPackNames(raw) {
  if (Array.isArray(raw)) return names(raw, 'enabled packs')
  object(raw, 'project pack selection')
  keys(raw, ['packs'], 'project pack selection')
  return names(raw.packs, 'enabled packs')
}

/** Other core/provider metadata is intentionally outside this schema. */
export function routingDeclaration(raw) {
  object(raw, 'skill metadata')
  const out = {}
  if (Object.hasOwn(raw, 'exposure')) {
    if (!['root', 'explicit'].includes(raw.exposure)) throw new TypeError('exposure must be root or explicit')
    out.exposure = raw.exposure
  }
  if (Object.hasOwn(raw, 'routers')) out.routers = names(raw.routers, 'routers')
  return out
}

/** Require a complete header from the resource explicitly returned by its provider. */
export function routingFrontmatter(raw, expectedName, parseYaml) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
  if (!match) throw new TypeError('Winning skill resource needs a complete YAML frontmatter header')
  const data = object(parseYaml(match[1]), 'skill frontmatter')
  if (data.name !== expectedName) throw new TypeError('Winning skill resource name changed; refresh its provider catalog')
  return routingDeclaration(data)
}
