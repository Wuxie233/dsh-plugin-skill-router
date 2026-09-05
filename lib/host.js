import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { embedPackKey, hiddenNames, packKeyOf, parseEnabledPacks, parsePacksTable, readPackKey, renderFilteredCatalog } from './logic.js'
import { routingDeclaration, routingFrontmatter } from './schema.js'
export { catalogLineNames, hiddenNames, packKeyOf, parseEnabledPacks, parsePacksTable, renderFilteredCatalog, rewriteCatalogText, NATIVE_HIDDEN_SKILL_NAMES, NATIVE_PRESET_ID, presetCatalogHidden } from './logic.js'

const DEFAULT_PACKS = join(homedir(), 'CODE/agent-habits/skills/skill-topology/packs.yml')
const TTL = 10_000
const CACHE_LIMIT = 512
const safeLabel = text => String(text).replace(/[\r\n\t]/g, ' ').slice(0, 240)

/** Content-free provider errors; filesystem/parser diagnostics have controlled wording. */
function readError(error) {
  if (typeof error?.code === 'string') return safeLabel(error.code)
  if (error instanceof TypeError || error instanceof SyntaxError) return safeLabel(error.message)
  return 'read failed'
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
function ancestors(start) {
  const out = []
  for (let dir = resolve(start);; dir = dirname(dir)) {
    out.push(dir)
    if (dirname(dir) === dir) return out
  }
}
function entriesOf(message) {
  const entries = message.source?.entries
  if (!Array.isArray(entries) || entries.some(entry => typeof entry?.name !== 'string' || typeof entry?.description !== 'string')) {
    throw new Error('skill-router requires durable skill-catalog source.entries; run the adapter candidate compatibility gate')
  }
  return entries
}
function textOf(message) {
  return message.content?.find(block => block.type === 'text')?.text ?? ''
}
function withText(message, text) {
  return { ...message, content: message.content.map(block => block.type === 'text' ? { ...block, text } : block) }
}
function latestCatalog(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type === 'user/message' && event.data?.source?.kind === 'skill-catalog') return event.data
  }
}

/** Factory receives private utilities only after standard admission. */
export default function createHost(api) {
  if (typeof api?.parseYaml !== 'function') {
    throw new Error('skill-router requires adapter api.parseYaml; build/deploy the compatible @dsh-std/adapter-dsh before this plugin and run the candidate gate')
  }
  const { parseYaml, snapshotSessionEvents, createUserMessage, sessionWorkingDirectory, z } = api
  const Config = z.object({
    // Accepted for configuration migration only. Providers, not this plugin, own roots.
    skillRoot: z.string().default(join(homedir(), '.dsh', 'skills')),
    extraRoots: z.array(z.string()).default([]),
    packsFile: z.string().default(DEFAULT_PACKS),
  })
  // Current Cordis inject is an array or service->intercept map, not the legacy
  // { required, optional } shape. Optional services use supported ctx.get reads.
  const inject = ['skills']

  function apply(ctx, config = {}) {
    const skills = ctx.get('skills')
    if (typeof skills?.snapshot !== 'function' || typeof skills?.get !== 'function') {
      throw new Error('skill-router requires scoped skills.snapshot/get; run the adapter candidate compatibility gate')
    }
    const packsFile = config.packsFile ?? DEFAULT_PACKS
    // Cache parsed metadata, not registry winners. Always resolve the winner again.
    const files = new Map()
    function cachedFile(key, path, parse) {
      const now = Date.now()
      const previous = files.get(key)
      if (previous && now - previous.at < TTL) return previous
      let result
      try { result = { value: parse(readFileSync(path, 'utf8')), at: now } }
      catch (error) { result = { error: readError(error), at: now } }
      files.delete(key)
      files.set(key, result)
      if (files.size > CACHE_LIMIT) files.delete(files.keys().next().value)
      return result
    }

    ctx.on('agent/pre-step', async (payload, next) => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const agent = payload.agent
      const events = agent === undefined ? [] : snapshotSessionEvents(agent.session)
      const inBatch = decision.messages.filter(message => message.source?.kind === 'skill-catalog')
      const latest = inBatch.length ? undefined : latestCatalog(events)
      if (!inBatch.length && latest === undefined) return decision
      const catalogs = inBatch.length ? inBatch : [latest]
      const names = [...new Set(catalogs.flatMap(message => entriesOf(message).map(entry => entry.name)))].sort()
      // Same scope/cwd/additional roots as core tool-skill. Never fall back to birth cwd.
      const cwd = agent === undefined ? undefined : sessionWorkingDirectory({ header: agent.session.header, events })
      const extraRoots = agent === undefined ? [] : (ctx.get('sandboxPolicy')?.foldersOf(agent.session).additional ?? [])
        .filter(folder => !folder.missing).map(folder => folder.path)
      const roots = [...(cwd === undefined ? [] : [cwd]), ...extraRoots].map(root => resolve(root))
      const projected = agent === undefined ? undefined : ctx.get('sessionProjections')?.stateOf(agent.session, 'agentPreset')
      const presetId = typeof projected === 'string' && projected ? projected : agent?.session.header?.agentPreset ?? ''
      const lookup = { cwd, ...(extraRoots.length ? { extraRoots } : {}), scope: agent, signal: payload.signal }
      const diagnostics = []
      const routed = new Set()
      let rawTable = {}
      let table = parsePacksTable(rawTable)
      let configInvalid = false
      if (packsFile !== '') {
        const loaded = cachedFile(`packs:${packsFile}`, packsFile, raw => {
          const value = parseYaml(raw)
          parsePacksTable(value)
          return value
        })
        if (loaded.error) {
          configInvalid = true
          diagnostics.push(`Pack table ${safeLabel(packsFile)}: ${loaded.error}. Repair this file or explicitly set packsFile to an empty string; attention entries are withheld.`)
        } else {
          rawTable = loaded.value
          table = parsePacksTable(rawTable)
        }
      }
      const enabled = new Set(table.alwaysOn)
      const visited = new Set()
      for (const root of packsFile === '' ? [] : roots) for (const dir of ancestors(root)) {
        const file = join(dir, '.dsh/skill-packs.yml')
        if (visited.has(file)) continue
        visited.add(file)
        if (!existsSync(file)) continue
        // Project selection is small and must notice a newly opened/closed pack immediately.
        try {
          for (const pack of parseEnabledPacks(parseYaml(readFileSync(file, 'utf8')))) {
            if (packsFile !== '' && !Object.hasOwn(rawTable.packs ?? {}, pack)) throw new TypeError('Selection references an undefined pack; check the machine pack table')
            enabled.add(pack)
          }
        } catch (error) {
          configInvalid = true
          diagnostics.push(`Project packs ${safeLabel(file)}: ${readError(error)}. Repair this selection; attention entries are withheld.`)
        }
      }

      const resources = []
      let snapshot
      try { snapshot = await skills.snapshot(lookup) }
      catch { diagnostics.push('Skill registry discovery failed. Refresh the provider or run the candidate compatibility gate; attention entries are withheld.') }
      payload.signal?.throwIfAborted()
      if (!snapshot?.complete) {
        configInvalid = true
        if (snapshot) diagnostics.push('Skill registry discovery is incomplete. Retry after the provider recovers; attention entries are withheld.')
      } else {
        const summaries = new Map(snapshot.skills.map(skill => [skill.name, skill]))
        for (const name of names) {
          const summary = summaries.get(name)
          if (!summary || summary.invocation?.modelInvocable !== true) {
            routed.add(name)
            resources.push({ name, available: false })
            if (!summary) diagnostics.push(`Skill ${safeLabel(name)} is no longer in the registry. Refresh its provider; this stale attention entry is withheld.`)
            continue
          }
          let definition
          try { definition = await skills.get(name, lookup) }
          catch { /* Never surface arbitrary provider/body text in diagnostics. */ }
          payload.signal?.throwIfAborted()
          if (!definition || definition.name !== name) {
            routed.add(name)
            resources.push({ name, available: false })
            diagnostics.push(`Skill ${safeLabel(name)}: winning provider resource is missing or stale. Refresh or repair that provider; this entry is withheld.`)
            continue
          }
          const identity = { name, provider: definition.provider, source: definition.source, resourceBase: definition.resourceBase, path: definition.path, invocation: definition.invocation }
          resources.push(identity)
          if (definition.invocation?.modelInvocable !== true) {
            routed.add(name)
            continue
          }
          try {
            let routing
            if (definition.path !== undefined) {
              if (typeof definition.path !== 'string' || !isAbsolute(definition.path)) throw new TypeError('Provider body path must be absolute')
              const key = `routing:${digest(identity)}`
              const result = cachedFile(key, definition.path, raw => routingFrontmatter(raw, name, parseYaml))
              if (result.error) throw new TypeError(result.error)
              routing = result.value
            } else {
              // URL/opaque/runtime providers own their bodies. A directory resourceBase
              // is only a relative-resource hint, never proof of a SKILL.md location.
              routing = routingDeclaration(definition.metadata ?? {})
            }
            identity.routing = routing
            if (routing.exposure !== 'root' && (routing.exposure === 'explicit' || routing.routers?.length)) routed.add(name)
          } catch (error) {
            routed.add(name)
            diagnostics.push(`Skill ${safeLabel(name)} (${safeLabel(definition.path ?? definition.provider)}): ${readError(error)}. Repair winning routing metadata; this entry is withheld.`)
          }
        }
      }
      if (configInvalid) for (const name of names) routed.add(name)
      diagnostics.sort()
      const hidden = hiddenNames(routed, names, table, enabled, roots, presetId)
      // Canonical inputs include provenance, private-home context and parsed data.
      // A TTL rescan alone never causes a replacement; semantic changes do.
      const key = `${packKeyOf(enabled)}|${presetId}|v2:${digest({ roots, presetId, rawTable, resources, enabled: [...enabled].sort(), hidden: [...hidden].sort(), diagnostics })}`
      const render = (message, update) => embedPackKey(renderFilteredCatalog(entriesOf(message), hidden, { update, diagnostics }), key)
      if (inBatch.length) {
        return { ...decision, messages: decision.messages.map(message => inBatch.includes(message) ? withText(message, render(message, message.source.update === true)) : message) }
      }
      if (readPackKey(textOf(latest)) === key) return decision
      const replacement = createUserMessage({
        content: [{ type: 'text', text: render(latest, true) }],
        // Preserve every original entry/description and all core-owned source fields.
        source: { ...latest.source, update: true },
      })
      return { ...decision, messages: [...decision.messages, replacement] }
    })
  }
  return { name: 'skill-router', inject, Config, apply }
}
