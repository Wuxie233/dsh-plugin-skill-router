/**
 * Two-level skill routing plus pack-filtered catalog attention.
 *
 * Scans the user skill root (~/.dsh/skills by default) for SKILL.md
 * frontmatter `exposure` and `routers` declarations, then rewrites the
 * model-visible catalog text published by tool-skill so only router /
 * standalone / currently-opened pack summaries render. Routed and
 * pack-hidden skills stay loadable through the `skill` tool and `/name`
 * gestures. Durable catalog `source.entries` stay the full list so
 * tool-skill's digest never fights this rewrite.
 *
 * Visibility (AND):
 *   1. Routing: exposure:explicit / routers:[...] hide; exposure:root or
 *      neither declared stay (until pack filtering).
 *   2. Packs: main-chain + always-on packs stay; domain packs render only
 *      when a session root (or ancestor) lists them in `.dsh/skill-packs.yml`.
 *   3. Native preset: `team-spec-workflow` and `agent-teams` drop from the
 *      rendered catalog only. Slash / named load still works. Other presets
 *      keep them listed.
 *
 * Pack-set changes (rehome) append a replacement catalog rebuilt from
 * source.entries. The packKey stamp lives in an HTML comment in the
 * rendered prose, not on the durable source object.
 *
 * @module @wuxie/dsh-skill-router
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { sessionWorkingDirectory } from '@deepseek-ai/dsh-sandbox-policy'
import z from '@deepseek-ai/schemastery'
import {
  catalogLineNames,
  embedPackKey,
  hiddenNames as combineHidden,
  packKeyOf,
  parseEnabledPacks,
  parseLooseYaml,
  parsePacksTable,
  readPackKey,
  renderFilteredCatalog,
  rewriteCatalogText,
} from './logic.js'

export const name = 'skill-router'
export const inject = []

export {
  catalogLineNames,
  combineHidden as hiddenNames,
  packKeyOf,
  parseEnabledPacks,
  parsePacksTable,
  renderFilteredCatalog,
  rewriteCatalogText,
}

export {
  NATIVE_HIDDEN_SKILL_NAMES,
  NATIVE_PRESET_ID,
  presetCatalogHidden,
} from './logic.js'

/** Plugin configuration. */
export const Config = z.object({
  /** User skill root to scan for routing frontmatter. */
  skillRoot: z.string().default(join(homedir(), '.dsh', 'skills')),
  /** Extra roots scanned before the user root (same SKILL.md convention). */
  extraRoots: z.array(z.string()).default([]),
  /** Machine-readable pack table. Empty string disables pack filtering. */
  packsFile: z.string().default(join(homedir(), 'CODE/agent-habits/skills/skill-topology/packs.yml')),
})

/**
 * Parse the frontmatter of one SKILL.md into a routing declaration.
 * @param {string} raw file text
 * @returns {{ exposure?: string, routers?: string[] } | undefined} parsed fields
 */
function parseFrontmatter(raw) {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  let lineStart = firstLineEnd + 1
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') !== '---') {
      if (nextNewline < 0) return undefined
      lineStart = nextNewline + 1
      continue
    }
    return parseSimpleYaml(raw.slice(firstLineEnd + 1, lineStart))
  }
  return undefined
}

/**
 * Extract only `exposure` and `routers` from frontmatter text. Handles block
 * scalars (>- / |-) so descriptions with colons cannot desync line numbers.
 * @param {string} text frontmatter body
 * @returns {{ exposure?: string, routers?: string[] }} parsed fields
 */
function parseSimpleYaml(text) {
  const out = {}
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const exposure = /^exposure:\s*(.+?)\s*$/.exec(line)
    if (exposure) {
      const value = unquote(exposure[1])
      if (value === 'root' || value === 'explicit') out.exposure = value
      continue
    }
    const routersFlow = /^routers:\s*\[(.*)\]\s*$/.exec(line)
    if (routersFlow) {
      const names = routersFlow[1].split(',').map(s => unquote(s.trim())).filter(s => s.length > 0)
      if (names.length > 0) out.routers = names
      continue
    }
    if (/^routers:\s*$/.test(line)) {
      const names = []
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^\s+-\s*(.+?)\s*$/.exec(lines[j])
        if (!item) break
        names.push(unquote(item[1]))
        i = j
      }
      if (names.length > 0) out.routers = names
      continue
    }
  }
  return out
}

/** Strip one level of matching quotes. */
function unquote(value) {
  if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Collect routing-hidden skill names from every configured skill root.
 * @param {string[]} roots skill roots to scan
 * @returns {Set<string>}
 */
function scanRoutedHidden(roots) {
  const hidden = new Set()
  for (const root of roots) {
    let entries
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const dir = join(root, entry.name)
      if (!isDirectory(dir)) continue
      const skillPath = join(dir, 'SKILL.md')
      let raw
      try {
        raw = readFileSync(skillPath, 'utf8')
      } catch {
        continue
      }
      const declared = parseFrontmatter(raw)
      if (declared === undefined) continue
      const isVisible = declared.exposure === 'root'
        || (declared.exposure === undefined && (declared.routers ?? []).length === 0)
      if (!isVisible) hidden.add(entry.name)
    }
  }
  return hidden
}

/** Whether a path is a directory, following symlinks. */
function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function loadYamlObject(path) {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = parseLooseYaml(raw)
    if (parsed !== undefined && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
  } catch {
    // missing or invalid: treat as empty
  }
  return {}
}

function walkAncestors(start) {
  const out = []
  let current = resolve(start)
  while (true) {
    out.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return out
}

/**
 * Current session agent-preset id. Projection wins (covers mid-session
 * `agent-preset/selected`); header is the creation-time fallback.
 * Missing both means we do not hide Native-only names.
 * @param {object} ctx
 * @param {{ session?: { header?: { agentPreset?: string } } } | undefined} agent
 * @returns {string | undefined}
 */
function sessionPresetId(ctx, agent) {
  const session = agent?.session
  if (session === undefined) return undefined
  try {
    const projected = ctx.get('sessionProjections')?.stateOf(session, 'agentPreset')
    if (typeof projected === 'string' && projected.length > 0) return projected
  } catch {
    // thin composition / projection unit not mounted
  }
  const header = session.header?.agentPreset
  return typeof header === 'string' && header.length > 0 ? header : undefined
}

function sessionLookupRoots(ctx, agent) {
  const roots = []
  if (agent !== undefined) {
    try {
      const cwd = sessionWorkingDirectory(agent.session)
      if (typeof cwd === 'string' && cwd.length > 0) roots.push(cwd)
    } catch {
      const cwd = agent.session?.header?.cwd
      if (typeof cwd === 'string' && cwd.length > 0) roots.push(cwd)
    }
    try {
      const extra = ctx.get('sandboxPolicy')?.foldersOf(agent.session).additional
        .filter(folder => !folder.missing)
        .map(folder => folder.path) ?? []
      for (const path of extra) {
        if (typeof path === 'string' && path.length > 0) roots.push(path)
      }
    } catch {
      // thin composition
    }
  }
  return roots
}

function collectEnabledPacks(lookupRoots, alwaysOn) {
  const enabled = new Set(alwaysOn)
  const seen = new Set()
  for (const start of lookupRoots) {
    for (const dir of walkAncestors(start)) {
      if (seen.has(dir)) continue
      seen.add(dir)
      if (!existsSync(join(dir, '.dsh/skill-packs.yml'))) continue
      const listed = parseEnabledPacks(loadYamlObject(join(dir, '.dsh/skill-packs.yml')))
      for (const pack of listed) enabled.add(pack)
    }
  }
  return { enabled, projectRoots: lookupRoots }
}

function catalogEntries(source) {
  const entries = source?.entries
  if (!Array.isArray(entries)) return []
  const out = []
  for (const entry of entries) {
    if (typeof entry?.name === 'string' && typeof entry?.description === 'string') {
      out.push({ name: entry.name, description: entry.description })
    }
  }
  return out
}

function messageText(message) {
  const block = message.content?.find(item => item.type === 'text')
  return typeof block?.text === 'string' ? block.text : ''
}

function withText(message, text) {
  const blocks = message.content.map((block) => {
    if (block.type !== 'text') return block
    return { ...block, text }
  })
  return { ...message, content: blocks }
}

function latestCatalogRecord(agent) {
  const events = agent?.session?.events
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'skill-catalog') continue
    return event.data
  }
  return undefined
}

/** Apply: register the catalog rewrite listener on agent/pre-step. */
export function apply(ctx, config = {}) {
  const skillRoots = [ ...(config.extraRoots ?? []), config.skillRoot ?? join(homedir(), '.dsh', 'skills') ]
    .map(root => resolve(root))
  const packsFile = config.packsFile ?? join(homedir(), 'CODE/agent-habits/skills/skill-topology/packs.yml')

  let routedCached
  let routedAt = 0
  const routedHidden = () => {
    const now = Date.now()
    if (routedCached === undefined || now - routedAt > 10_000) {
      routedCached = scanRoutedHidden(skillRoots)
      routedAt = now
    }
    return routedCached
  }

  let packsCached
  let packsAt = 0
  const packsTable = () => {
    const now = Date.now()
    if (packsCached === undefined || now - packsAt > 10_000) {
      packsCached = packsFile === ''
        ? parsePacksTable({})
        : parsePacksTable(loadYamlObject(packsFile))
      packsAt = now
    }
    return packsCached
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const agent = payload.agent
    const table = packsTable()
    const lookupRoots = sessionLookupRoots(ctx, agent)
    const { enabled, projectRoots } = collectEnabledPacks(lookupRoots, table.alwaysOn)
    const routed = routedHidden()
    const presetId = sessionPresetId(ctx, agent)
    // Stamp includes preset so Native hide (and a late-arriving projection)
    // rebuilds rendered catalog without touching source.entries.
    const key = `${packKeyOf(enabled)}|${presetId ?? ''}`

    const filterMessage = (message, update) => {
      const entries = catalogEntries(message.source)
      const existing = messageText(message)
      const names = entries.length > 0 ? entries.map(entry => entry.name) : catalogLineNames(existing)
      const hidden = combineHidden(routed, names, table, enabled, projectRoots, presetId)
      let text
      if (entries.length > 0) {
        text = renderFilteredCatalog(entries, hidden, { update }) ?? existing
      } else {
        text = rewriteCatalogText(existing, hidden) ?? existing
      }
      return withText(message, embedPackKey(text, key))
    }

    const inBatch = decision.messages.find(message => (message.source ?? {}).kind === 'skill-catalog')
    if (inBatch !== undefined) {
      const rewritten = filterMessage(inBatch, inBatch.source?.update === true)
      const messages = decision.messages.map(message => message === inBatch ? rewritten : message)
      return { ...decision, messages }
    }

    const latest = latestCatalogRecord(agent)
    if (latest === undefined) return decision
    const previous = readPackKey(messageText(latest))
    if (previous === key) return decision

    const entries = catalogEntries(latest.source)
    if (entries.length === 0) return decision
    const names = entries.map(entry => entry.name)
    const hidden = combineHidden(routed, names, table, enabled, projectRoots, presetId)
    const rebuilt = renderFilteredCatalog(entries, hidden, { update: true })
    if (rebuilt === undefined) return decision
    const replacement = createUserMessage({
      content: [{ type: 'text', text: embedPackKey(rebuilt, key) }],
      source: {
        kind: 'skill-catalog',
        form: 'catalog',
        update: true,
        entries,
      },
    })
    return { ...decision, messages: [...decision.messages, replacement] }
  })
}
