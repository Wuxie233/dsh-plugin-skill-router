/**
 * Two-level skill routing for the session skill catalog.
 *
 * Scans the user skill root (~/.dsh/skills by default) for SKILL.md
 * frontmatter `exposure` and `routers` declarations, then rewrites the
 * model-visible catalog text published by tool-skill so only router and
 * standalone summaries render. Routed sub-skills stay loadable through the
 * `skill` tool and `/name` gestures; the durable catalog `entries` recorded
 * by tool-skill are left untouched, so its digest-based republish logic never
 * fights this rewrite.
 *
 * Visibility rules (opencode two-level routing parity):
 *   exposure: root      -> publish in the catalog
 *   exposure: explicit  -> hide from the catalog (explicit load only)
 *   routers: [names]    -> hide from the catalog (load via router or name)
 *   neither declared    -> publish as a standalone specialist
 *
 * @module @wuxie/dsh-skill-router
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'

export const name = 'skill-router'
export const inject = []

/** Extra hint appended when at least one sub-skill is hidden. */
const ROUTING_HINT =
  'Some skills are not listed here; load them through the listed router skills or by their exact name.'

/** Rendered catalog-line prefix produced by tool-skill. */
const LINE_PREFIX = '- `'

/** Plugin configuration. */
export const Config = z.object({
  /** User skill root to scan for routing frontmatter. */
  skillRoot: z.string().default(join(homedir(), '.dsh', 'skills')),
  /** Extra roots scanned before the user root (same SKILL.md convention). */
  extraRoots: z.array(z.string()).default([]),
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
 * Collect hidden skill names from every configured root.
 * @param {string[]} roots skill roots to scan
 * @returns {Set<string>} names that must not render in the catalog
 */
function scanHiddenNames(roots) {
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

/**
 * Rewrite one catalog text block, dropping hidden entries and appending the
 * routing hint when anything was dropped.
 * @param {string} text rendered catalog text from tool-skill
 * @param {Set<string>} hidden names to drop
 * @returns {string | undefined} rewritten text, or undefined when unchanged
 */
function rewriteCatalogText(text, hidden) {
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

/** Apply: register the catalog rewrite listener on agent/pre-step. */
export function apply(ctx, config = {}) {
  const roots = [ ...(config.extraRoots ?? []), config.skillRoot ?? join(homedir(), '.dsh', 'skills') ]
    .map(root => resolve(root))

  let cached
  let scannedAt = 0
  const hiddenNames = () => {
    // Cheap TTL cache: frontmatter rarely changes and this runs per step.
    const now = Date.now()
    if (cached === undefined || now - scannedAt > 10_000) {
      cached = scanHiddenNames(roots)
      scannedAt = now
    }
    return cached
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const hidden = hiddenNames()
    if (hidden.size === 0) return decision
    const messages = decision.messages.map((message) => {
      if ((message.source ?? {}).kind !== 'skill-catalog') return message
      const blocks = message.content.map((block) => {
        if (block.type !== 'text') return block
        const rewritten = rewriteCatalogText(block.text, hidden)
        return rewritten === undefined ? block : { ...block, text: rewritten }
      })
      // source.entries stay untouched: tool-skill digests them, not the prose.
      return { ...message, content: blocks }
    })
    return { ...decision, messages }
  })
}
