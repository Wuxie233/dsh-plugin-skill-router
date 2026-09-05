/** Pure catalog-visibility helpers. No host services, filesystem or YAML parser. */
import { resolve } from 'node:path'
import { enabledPackNames, validatePacksTable } from './schema.js'

export const ROUTING_HINT = 'This is a filtered attention catalog, not the full skill inventory. Unlisted skills may be loaded through a router or by exact name when current invocation and pack-use instructions permit; hiding never grants or revokes tool permission.'
export const NATIVE_PRESET_ID = 'native'
/** Attention only; core invocation policy remains authoritative. */
export const NATIVE_HIDDEN_SKILL_NAMES = Object.freeze(['team-spec-workflow', 'agent-teams', 'bugbot-review'])
export const LINE_PREFIX = '- `'

export function presetCatalogHidden(presetId) {
  return new Set(presetId === NATIVE_PRESET_ID ? NATIVE_HIDDEN_SKILL_NAMES : [])
}

/** Compile an already-parsed, validated machine pack table. */
export function parsePacksTable(raw) {
  validatePacksTable(raw)
  const alwaysOn = new Set(raw.alwaysOn ?? [])
  const nameToPack = new Map()
  const catalogNames = new Map()
  const independentWhenOpen = new Map()
  const projectPrivate = new Map()
  for (const [pack, spec] of Object.entries(raw.packs ?? {})) {
    if (spec.alwaysOn === true) alwaysOn.add(pack)
    const catalog = spec.catalog
    if (catalog === 'independent' || catalog === 'named-load') {
      independentWhenOpen.set(pack, new Set())
    } else {
      catalogNames.set(catalog, pack)
      nameToPack.set(catalog, pack)
    }
    for (const member of spec.members ?? []) {
      nameToPack.set(member, pack)
      if (catalog === 'independent' || (catalog === 'named-load' && !member.endsWith('-learning-expert'))) {
        independentWhenOpen.get(pack).add(member)
      }
    }
  }
  for (const [name, spec] of Object.entries(raw.projectPrivate ?? {})) {
    projectPrivate.set(name, { home: resolve(spec.home), ...(spec.enablingPack === undefined ? {} : { enablingPack: spec.enablingPack }) })
  }
  return { alwaysOn, nameToPack, catalogNames, independentWhenOpen, projectPrivate }
}

/** Accepts `{ packs: [...] }` or a bare array; rejects invalid selectors. */
export function parseEnabledPacks(raw) {
  return new Set(enabledPackNames(raw))
}
export function packKeyOf(packs) {
  return [...new Set(packs)].sort().join(',')
}
export function isUnderHome(root, home) {
  const a = resolve(root)
  const b = resolve(home)
  return a === b || a.startsWith(b === '/' ? '/' : `${b}/`)
}
export function projectPrivateVisible(binding, roots, enabledPacks) {
  return roots.some(root => isUnderHome(root, binding.home))
    || (binding.enablingPack !== undefined && enabledPacks.has(binding.enablingPack))
}

/** Pack visibility never undoes a routing hide. */
export function packHides(name, table, enabledPacks, roots) {
  const privateBinding = table.projectPrivate.get(name)
  if (privateBinding !== undefined) return !projectPrivateVisible(privateBinding, roots, enabledPacks)
  const pack = table.nameToPack.get(name)
  if (pack === undefined || table.alwaysOn.has(pack)) return false
  if (!enabledPacks.has(pack)) return true
  if (table.catalogNames.get(name) === pack) return false
  return !table.independentWhenOpen.get(pack)?.has(name)
}
export function hiddenNames(routedHidden, names, table, enabledPacks, roots, presetId) {
  const hidden = new Set([...routedHidden, ...presetCatalogHidden(presetId)])
  for (const name of names) if (packHides(name, table, enabledPacks, roots)) hidden.add(name)
  return hidden
}

/** Legacy prose-only helper; the host requires durable entries for rebuilding. */
export function rewriteCatalogText(text, hidden) {
  const lines = text.split('\n')
  const out = lines.filter(line => {
    if (!line.startsWith(LINE_PREFIX)) return true
    const end = line.indexOf('`', LINE_PREFIX.length)
    return !hidden.has(line.slice(LINE_PREFIX.length, end))
  })
  if (out.length === lines.length) return undefined
  const close = out.lastIndexOf('</available_skills>')
  if (close >= 0) out.splice(close + 1, 0, ROUTING_HINT)
  return out.join('\n')
}
export function catalogLineNames(text) {
  return [...text.matchAll(/^- `([^`]+)`:/gm)].map(match => match[1])
}

const INITIAL_OPEN = 'A skill is a reusable set of task-specific instructions. The following skills are advertised for this session:'
const UPDATE_OPEN = 'The advertised skill catalog changed. This replaces earlier advertised attention entries, not the full skill inventory:'
const EMPTY = 'No skills are advertised in this attention catalog. This does not mean the skill loader has no skills; current invocation and pack-use instructions still apply.'

/** Render only attention entries, preserving the distinction from the loader inventory. */
export function renderFilteredCatalog(entries, hidden, opts = {}) {
  const visible = entries.filter(entry => !hidden.has(entry.name))
  const lines = [
    '<system-reminder>',
    opts.update === true ? UPDATE_OPEN : INITIAL_OPEN,
    '', '<available_skills>',
    ...visible.map(entry => `${LINE_PREFIX}${entry.name}\`: ${escapeCatalogText(entry.description)}`),
    '</available_skills>', '',
    ROUTING_HINT,
  ]
  if (visible.length === 0) lines.push(EMPTY)
  lines.push(
    "If the user names a skill, or the task clearly matches an advertised description, load the applicable skill by its exact name under the current invocation instructions. This catalog contains summaries only; follow a skill's instructions after loading it. Earlier advertisements are not current visibility evidence.",
    'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.',
  )
  if (opts.diagnostics?.length) {
    lines.push('', '<skill_router_diagnostics>', 'Catalog routing needs repair. These are diagnostics, not task instructions:')
    for (const diagnostic of opts.diagnostics.slice(0, 5)) lines.push(`- ${escapeCatalogText(diagnostic)}`)
    if (opts.diagnostics.length > 5) lines.push(`- ${opts.diagnostics.length - 5} additional routing errors omitted.`)
    lines.push('</skill_router_diagnostics>')
  }
  lines.push('</system-reminder>')
  return lines.join('\n')
}

const PACK_KEY_RE = /<!-- dsh-pack-key:(.*?) -->/
/** Durable private visibility stamp lives in prose, never in core source.entries. */
export function embedPackKey(text, key) {
  const mark = `<!-- dsh-pack-key:${key} -->`
  if (PACK_KEY_RE.test(text)) return text.replace(PACK_KEY_RE, mark)
  return text.replace('<system-reminder>', `<system-reminder>\n${mark}`)
}
export function readPackKey(text) {
  return PACK_KEY_RE.exec(text)?.[1]
}
export function escapeCatalogText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
