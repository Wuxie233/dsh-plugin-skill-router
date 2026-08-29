/**
 * Pure catalog-visibility helpers for skill-router.
 * No Cordis, no fs, no crypto. Tests import this file directly.
 */

/** Extra hint appended when at least one catalog line is hidden. */
export const ROUTING_HINT =
  'Some skills are not listed here; load them through the listed router skills or by their exact name.'

/** Agent preset whose model-visible catalog drops Team-only skills. */
export const NATIVE_PRESET_ID = 'native'

/**
 * Team-only skill names hidden from the Native catalog. Slash / named load
 * still works; other presets (team, standard, …) keep them listed.
 */
export const NATIVE_HIDDEN_SKILL_NAMES = Object.freeze([
  'team-spec-workflow',
  'agent-teams',
])

/**
 * Extra catalog-hide names for a session preset. Only `native` adds names;
 * missing / other ids return an empty set so Team skills stay listed.
 * @param {string | null | undefined} presetId
 * @returns {Set<string>}
 */
export function presetCatalogHidden(presetId) {
  if (presetId === NATIVE_PRESET_ID) return new Set(NATIVE_HIDDEN_SKILL_NAMES)
  return new Set()
}

/** Rendered catalog-line prefix produced by tool-skill. */
export const LINE_PREFIX = '- `'

/**
 * Parse a YAML-ish packs.yml object into lookup tables.
 * @param {unknown} raw
 * @returns {{ alwaysOn: Set<string>, nameToPack: Map<string, string>, catalogNames: Map<string, string>, independentWhenOpen: Map<string, Set<string>>, projectPrivate: Map<string, { home: string, enablingPack?: string }> }}
 */
export function parsePacksTable(raw) {
  const alwaysOn = new Set()
  const nameToPack = new Map()
  const catalogNames = new Map()
  const independentWhenOpen = new Map()
  const projectPrivate = new Map()
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { alwaysOn, nameToPack, catalogNames, independentWhenOpen, projectPrivate }
  }
  const packs = raw.packs
  if (packs !== undefined && packs !== null && typeof packs === 'object' && !Array.isArray(packs)) {
    for (const [pack, spec] of Object.entries(packs)) {
      if (spec === undefined || spec === null || typeof spec !== 'object' || Array.isArray(spec)) continue
      if (spec.alwaysOn === true) alwaysOn.add(pack)
      const catalog = typeof spec.catalog === 'string' ? spec.catalog : ''
      if (catalog === 'independent' || catalog === 'named-load') {
        independentWhenOpen.set(pack, new Set())
      } else if (catalog.length > 0) {
        catalogNames.set(catalog, pack)
        nameToPack.set(catalog, pack)
      }
      const members = Array.isArray(spec.members) ? spec.members : []
      for (const member of members) {
        if (typeof member !== 'string' || member.length === 0) continue
        nameToPack.set(member, pack)
        const openSet = independentWhenOpen.get(pack)
        if (openSet !== undefined && (catalog === 'independent' || catalog === 'named-load')) {
          if (catalog === 'named-load') {
            if (!member.endsWith('-learning-expert')) openSet.add(member)
          } else {
            openSet.add(member)
          }
        }
      }
    }
  }
  const listedAlways = Array.isArray(raw.alwaysOn) ? raw.alwaysOn : []
  for (const pack of listedAlways) {
    if (typeof pack === 'string' && pack.length > 0) alwaysOn.add(pack)
  }
  const privateSpec = raw.projectPrivate
  if (privateSpec !== undefined && privateSpec !== null && typeof privateSpec === 'object' && !Array.isArray(privateSpec)) {
    for (const [name, spec] of Object.entries(privateSpec)) {
      if (spec === undefined || spec === null || typeof spec !== 'object' || Array.isArray(spec)) continue
      if (typeof spec.home !== 'string' || spec.home.length === 0) continue
      projectPrivate.set(name, {
        home: spec.home,
        ...typeof spec.enablingPack === 'string' && spec.enablingPack.length > 0
          ? { enablingPack: spec.enablingPack }
          : {},
      })
    }
  }
  return { alwaysOn, nameToPack, catalogNames, independentWhenOpen, projectPrivate }
}

/**
 * Parse `.dsh/skill-packs.yml` content into pack names.
 * Accepts `{ packs: [...] }` or a bare string array.
 * @param {unknown} raw
 * @returns {Set<string>}
 */
export function parseEnabledPacks(raw) {
  const names = new Set()
  const list = Array.isArray(raw)
    ? raw
    : (raw !== undefined && raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.packs)
      ? raw.packs
      : [])
  for (const item of list) {
    if (typeof item === 'string' && item.length > 0) names.add(item)
  }
  return names
}

/**
 * Stable identity of the currently enabled pack set.
 * @param {Iterable<string>} packs
 * @returns {string}
 */
export function packKeyOf(packs) {
  return [...new Set(packs)].sort().join(',')
}

/**
 * Whether `root` is `home` or a descendant of `home`.
 * @param {string} root
 * @param {string} home
 */
export function isUnderHome(root, home) {
  const a = root.replace(/\/+$/, '')
  const b = home.replace(/\/+$/, '')
  return a === b || a.startsWith(`${b}/`)
}

/**
 * Whether a project-private skill may render for these session roots / packs.
 * @param {{ home: string, enablingPack?: string }} binding
 * @param {string[]} roots
 * @param {Set<string>} enabledPacks
 */
export function projectPrivateVisible(binding, roots, enabledPacks) {
  for (const root of roots) {
    if (isUnderHome(root, binding.home)) return true
  }
  return binding.enablingPack !== undefined && enabledPacks.has(binding.enablingPack)
}

/**
 * Pack-layer hide decision. Routing (`exposure` / `routers`) is applied first
 * by the caller; this function never unhides a routed child.
 * @param {string} name
 * @param {{ alwaysOn: Set<string>, nameToPack: Map<string, string>, catalogNames: Map<string, string>, independentWhenOpen: Map<string, Set<string>>, projectPrivate: Map<string, { home: string, enablingPack?: string }> }} table
 * @param {Set<string>} enabledPacks
 * @param {string[]} roots
 */
export function packHides(name, table, enabledPacks, roots) {
  const privateBinding = table.projectPrivate.get(name)
  if (privateBinding !== undefined) {
    return !projectPrivateVisible(privateBinding, roots, enabledPacks)
  }
  const pack = table.nameToPack.get(name)
  if (pack === undefined) {
    // Main-chain and other unclassified names: keep visible. Topology still
    // asks operators to classify auxiliary names; hiding every unknown would
    // also hide grill-with-docs / agent-teams.
    return false
  }
  if (table.alwaysOn.has(pack)) return false
  if (!enabledPacks.has(pack)) return true
  if (table.catalogNames.get(name) === pack) return false
  const independent = table.independentWhenOpen.get(pack)
  if (independent !== undefined && independent.has(name)) return false
  // Opened pack, but this name is a routed child (or learning expert).
  return true
}

/**
 * Combine routing + pack + Native-preset hide sets.
 * @param {Set<string>} routedHidden
 * @param {string[]} names
 * @param {Parameters<typeof packHides>[1]} table
 * @param {Set<string>} enabledPacks
 * @param {string[]} roots
 * @param {string | null | undefined} [presetId]
 */
export function hiddenNames(routedHidden, names, table, enabledPacks, roots, presetId) {
  const hidden = new Set(routedHidden)
  for (const name of presetCatalogHidden(presetId)) hidden.add(name)
  for (const name of names) {
    if (hidden.has(name)) continue
    if (packHides(name, table, enabledPacks, roots)) hidden.add(name)
  }
  return hidden
}

/**
 * Rewrite one catalog text block, dropping hidden entries and appending the
 * routing hint when anything was dropped.
 * @param {string} text
 * @param {Set<string>} hidden
 * @returns {string | undefined}
 */
export function rewriteCatalogText(text, hidden) {
  const lines = text.split('\n')
  const out = []
  let dropped = false
  for (const line of lines) {
    if (line.startsWith(LINE_PREFIX)) {
      const end = line.indexOf('`', LINE_PREFIX.length)
      const name = end > 0 ? line.slice(LINE_PREFIX.length, end) : ''
      if (name !== '' && hidden.has(name)) {
        dropped = true
        continue
      }
    }
    out.push(line)
  }
  if (!dropped) return undefined
  const closeIndex = out.lastIndexOf('</available_skills>')
  const hintIndex = out.findIndex(line => line.startsWith('A user may also invoke a skill directly'))
  const insertAt = hintIndex > 0 ? hintIndex : (closeIndex > 0 ? closeIndex + 1 : -1)
  if (insertAt > 0) out.splice(insertAt, 0, ROUTING_HINT)
  return out.join('\n')
}

/**
 * Names present as catalog lines in rendered text.
 * @param {string} text
 * @returns {string[]}
 */
export function catalogLineNames(text) {
  const names = []
  for (const line of text.split('\n')) {
    if (!line.startsWith(LINE_PREFIX)) continue
    const end = line.indexOf('`', LINE_PREFIX.length)
    if (end > 0) names.push(line.slice(LINE_PREFIX.length, end))
  }
  return names
}

const INITIAL_OPEN = 'A skill is a reusable set of task-specific instructions. The following skills are available in this session:'
const UPDATE_OPEN = 'The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:'
const EMPTY_UPDATE = 'No skills are currently available through the `skill` tool. Do not use names from earlier skill catalogs.'

/**
 * Render catalog prose from durable entries (full list) after hide filtering.
 * Used on pack-set changes so a previously-filtered text is never re-filtered.
 * @param {readonly { name: string, description: string }[]} entries
 * @param {Set<string>} hidden
 * @param {{ update?: boolean }} [opts]
 */
export function renderFilteredCatalog(entries, hidden, opts = {}) {
  const visible = entries.filter(entry => !hidden.has(entry.name))
  const dropped = visible.length !== entries.length
  const update = opts.update === true
  if (!update && visible.length === 0 && entries.length === 0) return undefined
  const availability = visible.length === 0 && update
    ? [
      EMPTY_UPDATE,
      'A user may still invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool for it.',
    ]
    : update
      ? [
        'Use only names in this replacement catalog. If the user names a listed skill, or the task clearly matches its description, call the `skill` tool with the exact name before acting.',
        'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
      ]
      : [
        "If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.",
        'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
      ]
  const lines = [
    '<system-reminder>',
    update ? UPDATE_OPEN : INITIAL_OPEN,
    '',
    '<available_skills>',
    ...visible.map(entry => `${LINE_PREFIX}${entry.name}\`: ${escapeCatalogText(entry.description)}`),
    '</available_skills>',
    '',
  ]
  if (dropped) lines.push(ROUTING_HINT)
  lines.push(...availability, '</system-reminder>')
  return lines.join('\n')
}

const PACK_KEY_RE = /<!-- dsh-pack-key:(.*?) -->/

/**
 * Embed the current pack-set identity in rendered catalog prose so a later
 * step (or a restarted process) can detect rehome without touching
 * source.entries.
 * @param {string} text
 * @param {string} key
 */
export function embedPackKey(text, key) {
  const mark = `<!-- dsh-pack-key:${key} -->`
  if (PACK_KEY_RE.test(text)) return text.replace(PACK_KEY_RE, mark)
  return text.replace('<system-reminder>', `<system-reminder>\n${mark}`)
}

/**
 * @param {string} text
 * @returns {string | undefined}
 */
export function readPackKey(text) {
  const match = PACK_KEY_RE.exec(text)
  return match === null ? undefined : match[1]
}

/**
 * Minimal YAML subset: comments, maps, booleans, nested maps, string arrays.
 * Covers packs.yml and `.dsh/skill-packs.yml`. Not a general YAML parser.
 * @param {string} text
 * @returns {unknown}
 */
export function parseLooseYaml(text) {
  const lines = text.replace(/\t/g, '  ').split('\n')
  let i = 0

  const peek = () => {
    while (i < lines.length) {
      const raw = lines[i]
      const trimmed = raw.trim()
      if (trimmed === '' || trimmed.startsWith('#')) {
        i += 1
        continue
      }
      const indent = raw.match(/^ */)[0].length
      return { indent, trimmed, raw }
    }
    return undefined
  }

  const parseValue = (indent) => {
    const first = peek()
    if (first === undefined) return {}
    if (first.indent < indent) return {}
    if (first.trimmed.startsWith('- ')) {
      const list = []
      while (true) {
        const row = peek()
        if (row === undefined || row.indent < indent || !row.trimmed.startsWith('- ')) break
        i += 1
        list.push(unquoteScalar(row.trimmed.slice(2).trim()))
      }
      return list
    }
    const map = {}
    while (true) {
      const row = peek()
      if (row === undefined || row.indent < indent) break
      if (row.indent > indent) break
      i += 1
      const colon = row.trimmed.indexOf(':')
      if (colon < 0) continue
      const key = unquoteScalar(row.trimmed.slice(0, colon).trim())
      const rest = row.trimmed.slice(colon + 1).trim()
      if (rest === '' || rest === '|' || rest === '>' || rest === '>-' || rest === '|-') {
        map[key] = parseValue(indent + 2)
      } else {
        map[key] = parseScalar(rest)
      }
    }
    return map
  }

  const result = parseValue(0)
  return result
}

function parseScalar(value) {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  return unquoteScalar(value)
}

function unquoteScalar(value) {
  if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
    return value.slice(1, -1)
  }
  const comment = value.indexOf(' #')
  return (comment >= 0 ? value.slice(0, comment) : value).trim()
}

/** Same XML escape tool-skill applies to catalog descriptions. */
export function escapeCatalogText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
